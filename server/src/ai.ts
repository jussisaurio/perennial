// Hosted AI: task endpoints only, never a raw "complete this prompt" proxy.
// Prompts are the same ones the app uses with a learner's own key.
//
// Cost model
// - Course batches (the shared frequency-list course) are generated once per
//   language pair and position, then served to every learner from the cache.
//   They cost nobody credits; a per-user daily cap stops cursor-skipping abuse.
// - Personal tasks (words from your own text, fresh sentences) spend credits.
// - Every model call adds to a monthly spend total; past the budget, AI pauses.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { frequencyBatchPrompt, minePrompt, moreExamplesPrompt, type GenLexeme } from "../../web/src/ai/prompts";
import type { User } from "./auth";
import { PRICES, type Config } from "./config";
import { day, period } from "./db";

export class AIError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

// ---------- model output schemas (structured outputs guarantee the shape) ----------

const ExampleOut = z.object({ text: z.string(), translation: z.string(), cloze: z.string() });
const LexemeOut = z.object({
  lemma: z.string(),
  gloss: z.string(),
  pos: z.string(),
  forms: z.array(z.string()),
  notes: z.string(),
  examples: z.array(ExampleOut),
});
const WordsOut = z.object({ words: z.array(LexemeOut) });
const ExamplesOut = z.object({ examples: z.array(ExampleOut.extend({ lemma: z.string() })) });

// ---------- request schemas (untrusted input from the app) ----------

const short = (max: number) => z.string().trim().min(1).max(max);
// MVP scope: English speakers learning Spanish or German. Anything else is
// refused, which also bounds the shared course cache and AI spend.
const Common = { lang: z.enum(["es", "de"]), language: z.enum(["Spanish", "German"]), native: z.literal("English") };

export const CourseBatchIn = z.object({
  ...Common,
  cursor: z.number().int().min(0).max(100_000),
  next: z.number().int().min(1).max(100_000),
  forms: z.array(short(60)).min(1).max(30),
});
export const MineIn = z.object({
  ...Common,
  items: z.array(z.object({ form: short(60), sentence: short(400) })).min(1).max(15),
  known: z.array(short(40)).max(400),
});
export const ExamplesIn = z.object({
  ...Common,
  words: z.array(z.object({ lemma: short(60), gloss: short(120), seen: z.array(short(400)).max(8) })).min(1).max(8),
  known: z.array(short(40)).max(400),
});

const toGen = (w: z.infer<typeof LexemeOut>): GenLexeme => ({ ...w, notes: w.notes.trim() || undefined });

export class AIService {
  private readonly client: Anthropic;
  private readonly inflight = new Map<string, Promise<{ words: GenLexeme[]; next: number }>>();
  private readonly recent = new Map<string, number[]>();
  /** Model calls made by this process; for metrics and tests. */
  modelCalls = 0;

  constructor(
    private readonly db: Database,
    private readonly config: Config,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic({ apiKey: config.anthropic.apiKey, baseURL: config.anthropic.baseURL });
  }

  // ---------- accounting ----------

  credits(user: User) {
    const used = this.db.query<{ credits: number }, [string, string]>("SELECT credits FROM usage WHERE user_id = ? AND period = ?").get(user.id, period())?.credits ?? 0;
    const limit = this.config.plans[user.plan]?.credits ?? this.config.plans.free.credits;
    return { used, limit, left: Math.max(0, limit - used), period: period() };
  }

  private charge(user: User, credits: number) {
    this.db
      .query("INSERT INTO usage (user_id, period, credits) VALUES (?, ?, ?) ON CONFLICT(user_id, period) DO UPDATE SET credits = credits + excluded.credits")
      .run(user.id, period(), credits);
  }

  private requireCredits(user: User, cost: number) {
    const c = this.credits(user);
    if (c.left < cost) throw new AIError(402, "out_of_credits", { ...c, needed: cost, plan: user.plan });
  }

  spentThisMonth(): number {
    return this.db.query<{ usd: number }, [string]>("SELECT usd FROM spend WHERE period = ?").get(period())?.usd ?? 0;
  }

  private rateLimit(user: User) {
    const now = Date.now();
    const times = (this.recent.get(user.id) ?? []).filter((t) => now - t < 60_000);
    if (times.length >= this.config.aiRequestsPerMinute) throw new AIError(429, "slow_down");
    times.push(now);
    this.recent.set(user.id, times);
  }

  private bumpDaily(user: User, kind: string, max: number) {
    const today = day();
    const row = this.db.query<{ count: number }, [string, string, string]>("SELECT count FROM daily_usage WHERE user_id = ? AND day = ? AND kind = ?").get(user.id, today, kind);
    if ((row?.count ?? 0) >= max) throw new AIError(429, "daily_limit");
    this.db
      .query("INSERT INTO daily_usage (user_id, day, kind, count) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, day, kind) DO UPDATE SET count = count + 1")
      .run(user.id, today, kind);
  }

  // ---------- model call ----------

  private async generate<T extends z.ZodType>(schema: T, system: string, user: string): Promise<z.infer<T>> {
    if (this.spentThisMonth() >= this.config.monthlyBudgetUsd) {
      // A cost stop, not load: say so, and say until when.
      const d = new Date();
      const until = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
      throw new AIError(503, "paused", { until });
    }
    const model = this.config.anthropic.model;
    this.modelCalls++;
    let res;
    try {
      res = await this.client.messages.parse({
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(schema) },
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new AIError(503, "busy");
      if (e instanceof Anthropic.APIConnectionError) throw new AIError(502, "ai_unreachable");
      if (e instanceof Anthropic.APIError) throw new AIError(502, "ai_error", { status: e.status });
      throw e;
    }
    const [pin, pout] = PRICES[model] ?? [5, 25];
    const usd = (res.usage.input_tokens * pin + res.usage.output_tokens * pout) / 1_000_000;
    this.db.query("INSERT INTO spend (period, usd) VALUES (?, ?) ON CONFLICT(period) DO UPDATE SET usd = usd + excluded.usd").run(period(), usd);
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new AIError(502, "bad_output");
    return res.parsed_output;
  }

  // ---------- tasks ----------

  /** A slice of the shared frequency-list course. Cached for every learner of this language pair. */
  async courseBatch(user: User, input: z.infer<typeof CourseBatchIn>): Promise<{ words: GenLexeme[]; next: number; cached: boolean; model: string }> {
    const hit = this.db
      .query<{ words: string; next: number; model: string }, [string, string, number]>(
        "SELECT words, json_extract(forms, '$.next') AS next, model FROM course_batches WHERE lang = ? AND native = ? AND cursor = ?",
      )
      .get(input.lang, input.native, input.cursor);
    if (hit) return { words: JSON.parse(hit.words), next: hit.next, cached: true, model: hit.model };

    const key = `${input.lang}|${input.native}|${input.cursor}`;
    const pending = this.inflight.get(key);
    if (pending) return { ...(await pending), cached: true, model: this.config.anthropic.model };

    this.rateLimit(user);
    this.bumpDaily(user, "course", this.config.courseBatchesPerUserPerDay);
    const job = (async () => {
      // "Known words" are everything earlier in the shared course, so the
      // prompt, and therefore the cache, is the same for every learner.
      const earlier = this.db
        .query<{ words: string }, [string, string, number]>("SELECT words FROM course_batches WHERE lang = ? AND native = ? AND cursor < ? ORDER BY cursor")
        .all(input.lang, input.native, input.cursor)
        .flatMap((r) => (JSON.parse(r.words) as GenLexeme[]).map((w) => w.lemma));
      const p = frequencyBatchPrompt(input.language, input.native, input.forms, earlier.slice(0, 400), earlier);
      const out = await this.generate(WordsOut, p.system, p.user);
      const words = out.words.map(toGen);
      this.db
        .query("INSERT OR IGNORE INTO course_batches (lang, native, cursor, forms, words, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(input.lang, input.native, input.cursor, JSON.stringify({ forms: input.forms, next: input.next }), JSON.stringify(words), this.config.anthropic.model, Date.now());
      return { words, next: input.next };
    })();
    this.inflight.set(key, job);
    try {
      return { ...(await job), cached: false, model: this.config.anthropic.model };
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Words the learner picked from their own text. One credit per word. */
  async mine(user: User, input: z.infer<typeof MineIn>) {
    this.requireCredits(user, input.items.length);
    this.rateLimit(user);
    const p = minePrompt(input.language, input.native, input.items, input.known);
    const out = await this.generate(WordsOut, p.system, p.user);
    this.charge(user, input.items.length);
    return { words: out.words.map(toGen), credits: this.credits(user), model: this.config.anthropic.model };
  }

  /** New sentences for well-practised words. One credit per word. */
  async examples(user: User, input: z.infer<typeof ExamplesIn>) {
    this.requireCredits(user, input.words.length);
    this.rateLimit(user);
    const p = moreExamplesPrompt(input.language, input.native, input.words, input.known);
    const out = await this.generate(ExamplesOut, p.system, p.user);
    this.charge(user, input.words.length);
    return { examples: out.examples, credits: this.credits(user), model: this.config.anthropic.model };
  }
}
