// Perennial AI: task endpoints only, never a raw "complete this prompt" proxy.
//
// Cost model
// - The course itself is static decks: no AI at runtime.
// - Personal extras (words from your own text, fresh sentences) spend credits:
//   one per word, a monthly allowance per learner.
// - Every model call adds to a monthly spend total; past the budget, AI pauses
//   for everyone until the next month. Every call is logged in ai_request.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SQL } from "bun";
import { z } from "zod";
import { PRICES, type Config } from "./config";
import { HttpError } from "./http";
import { log } from "./log";
import { minePrompt, moreExamplesPrompt, PROMPT_VERSION, type GenLexeme } from "./prompts";

/** "2026-10": credits and the spend budget reset each calendar month (UTC). */
export const period = (d = new Date()) => d.toISOString().slice(0, 7);

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
// MVP scope: English speakers learning Spanish or German.
const Lang = z.enum(["es", "de"]);
const LANGUAGE = { es: "Spanish", de: "German" } as const;

export const MineIn = z.object({
  lang: Lang,
  items: z.array(z.object({ form: short(60), sentence: short(400) })).min(1).max(15),
  known: z.array(short(40)).max(400),
});
export const ExamplesIn = z.object({
  lang: Lang,
  words: z.array(z.object({ lemma: short(60), gloss: short(120), seen: z.array(short(400)).max(8) })).min(1).max(8),
  known: z.array(short(40)).max(400),
});

const toGen = (w: z.infer<typeof LexemeOut>): GenLexeme => ({ ...w, notes: w.notes.trim() || undefined });

export class AIService {
  private readonly client: Anthropic;
  // Per instance; a burst limit, not accounting (that is in Postgres).
  private readonly recent = new Map<string, number[]>();
  private readonly sql: SQL;
  private readonly config: Config;

  constructor(sql: SQL, config: Config, client?: Anthropic) {
    this.sql = sql;
    this.config = config;
    this.client = client ?? new Anthropic({ apiKey: config.anthropic.apiKey, baseURL: config.anthropic.baseURL });
  }

  get enabled() {
    return !!(this.config.anthropic.apiKey || this.config.anthropic.baseURL);
  }

  // ---------- accounting ----------

  async credits(userId: string) {
    const [row] = await this.sql`select used from ai_usage where user_id = ${userId} and period = ${period()}`;
    const used = Number(row?.used ?? 0);
    const limit = this.config.freeCredits;
    return { used, limit, left: Math.max(0, limit - used), period: period() };
  }

  private async charge(userId: string, credits: number) {
    await this.sql`insert into ai_usage (user_id, period, used) values (${userId}, ${period()}, ${credits})
      on conflict (user_id, period) do update set used = ai_usage.used + excluded.used`;
  }

  private async requireCredits(userId: string, cost: number) {
    const c = await this.credits(userId);
    if (c.left < cost) throw new HttpError(402, "out_of_credits", { ...c, needed: cost });
  }

  async spentThisMonth(): Promise<number> {
    const [row] = await this.sql`select usd from ai_spend where period = ${period()}`;
    return Number(row?.usd ?? 0);
  }

  private rateLimit(userId: string) {
    const now = Date.now();
    const times = (this.recent.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (times.length >= this.config.aiRequestsPerMinute) throw new HttpError(429, "slow_down");
    times.push(now);
    this.recent.set(userId, times);
  }

  // ---------- model call ----------

  private async generate<T extends z.ZodType>(userId: string, task: string, schema: T, system: string, user: string): Promise<z.infer<T>> {
    if (!this.enabled) throw new HttpError(503, "ai_off");
    if ((await this.spentThisMonth()) >= this.config.monthlyBudgetUsd) {
      // A cost stop, not load: say so, and say until when.
      const d = new Date();
      const until = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
      throw new HttpError(503, "paused", { until });
    }
    const model = this.config.anthropic.model;
    const started = performance.now();
    const record = (ok: boolean, usage?: { input_tokens: number; output_tokens: number }, usd = 0) =>
      this.sql`insert into ai_request (user_id, task, model, prompt_version, input_tokens, output_tokens, usd, ms, ok)
        values (${userId}, ${task}, ${model}, ${PROMPT_VERSION}, ${usage?.input_tokens ?? null}, ${usage?.output_tokens ?? null}, ${usd}, ${Math.round(performance.now() - started)}, ${ok})`.catch((err) =>
        log.error("ai_request log failed", { err }),
      );
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
      await record(false);
      if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, "busy");
      if (e instanceof Anthropic.APIConnectionError) throw new HttpError(502, "ai_unreachable");
      if (e instanceof Anthropic.APIError) throw new HttpError(502, "ai_error", { status: e.status });
      throw e;
    }
    const [pin, pout] = PRICES[model] ?? [5, 25];
    const usd = (res.usage.input_tokens * pin + res.usage.output_tokens * pout) / 1_000_000;
    await this.sql`insert into ai_spend (period, usd) values (${period()}, ${usd})
      on conflict (period) do update set usd = ai_spend.usd + excluded.usd`;
    const ok = res.stop_reason !== "refusal" && !!res.parsed_output;
    await record(ok, res.usage, usd);
    log.info("ai call", { task, model, usd, ms: Math.round(performance.now() - started), ok });
    if (!ok) throw new HttpError(502, "bad_output");
    return res.parsed_output as z.infer<T>;
  }

  // ---------- tasks ----------

  /** Words the learner picked from their own text. One credit per word. */
  async mine(userId: string, input: z.infer<typeof MineIn>) {
    await this.requireCredits(userId, input.items.length);
    this.rateLimit(userId);
    const p = minePrompt(LANGUAGE[input.lang], "English", input.items, input.known);
    const out = await this.generate(userId, "mine", WordsOut, p.system, p.user);
    await this.charge(userId, input.items.length);
    return { words: out.words.map(toGen), credits: await this.credits(userId), model: this.config.anthropic.model };
  }

  /** New sentences for words the learner chose. One credit per word. */
  async examples(userId: string, input: z.infer<typeof ExamplesIn>) {
    await this.requireCredits(userId, input.words.length);
    this.rateLimit(userId);
    const p = moreExamplesPrompt(LANGUAGE[input.lang], "English", input.words, input.known);
    const out = await this.generate(userId, "examples", ExamplesOut, p.system, p.user);
    await this.charge(userId, input.words.length);
    return { examples: out.examples, credits: await this.credits(userId), model: this.config.anthropic.model };
  }
}
