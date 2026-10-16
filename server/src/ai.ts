// Perennial AI: task endpoints only, never a raw "complete this prompt" proxy.
//
// Cost model
// - The course itself is static decks: no AI at runtime.
// - Personal extras (words from your own text, fresh sentences) spend credits:
//   one per word, a monthly allowance per learner.
// - Every model call adds to a monthly spend total; past the budget, AI pauses
//   for everyone until the next month. Every call is logged in ai_request.

import * as Sentry from "@sentry/bun";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SQL } from "bun";
import { LIMITS, type ExamplesIn, type MineIn, type UserId } from "perennial-contract";
import { z } from "zod";
import { PRICES, type Config } from "./config";
import { LANGUAGE } from "./course";
import { refuse } from "./http";
import { event, log } from "./log";
import { minePrompt, moreExamplesPrompt, PROMPT_VERSION, SENTENCES_PER_WORD, type GenWord } from "./prompts";
import { ensureRoom } from "./sync";

/** "2026-10": credits and the spend budget reset each calendar month (UTC). */
const period = () => new Date().toISOString().slice(0, 7);

// ---------- model output schemas (structured outputs guarantee the shape) ----------

// The model sees the /api/write limits as hints (structured outputs can't
// enforce string lengths, and a zod .max() would fail the whole answer over
// one long note). fitWord/fitSentence then hold every item to them.
const str = (maxLength: number) => z.string().meta({ maxLength });
const SentenceOut = z.object({ text: str(LIMITS.text), translation: str(LIMITS.translation), cloze: str(LIMITS.cloze) });
const WordOut = z.object({
  lemma: str(LIMITS.lemma),
  gloss: str(LIMITS.gloss),
  pos: str(LIMITS.pos),
  forms: z.array(str(LIMITS.form)).meta({ maxItems: LIMITS.forms }),
  notes: str(LIMITS.notes),
  examples: z.array(SentenceOut),
});
const WordsOut = z.object({ words: z.array(WordOut) });
const SentencesOut = z.object({ examples: z.array(SentenceOut.extend({ lemma: str(LIMITS.lemma) })) });

/** Required text that doesn't fit is dropped (null): cutting a gloss or a sentence would change what it says. */
const fits = (s: string, max: number) => {
  const t = s.trim();
  return t && t.length <= max ? t : null;
};

function fitSentence<E extends z.infer<typeof SentenceOut>>(e: E): E | null {
  const text = fits(e.text, LIMITS.text), translation = fits(e.translation, LIMITS.translation), cloze = fits(e.cloze, LIMITS.cloze);
  return text && translation && cloze ? { ...e, text, translation, cloze } : null;
}

/** A word /api/write would refuse, or one with no usable sentence, is dropped (and not charged). Notes and pos are cut short. */
function fitWord(w: z.infer<typeof WordOut>): GenWord | null {
  const lemma = fits(w.lemma, LIMITS.lemma), gloss = fits(w.gloss, LIMITS.gloss);
  const examples = w.examples.map(fitSentence).filter((e) => e !== null).slice(0, SENTENCES_PER_WORD);
  if (!lemma || !gloss || !examples.length) return null;
  const forms = w.forms.map((f) => f.trim()).filter((f) => f && f.length <= LIMITS.form).slice(0, LIMITS.forms);
  const notes = w.notes.trim();
  return {
    lemma,
    gloss,
    pos: w.pos.trim().slice(0, LIMITS.pos),
    forms,
    notes: notes.length > LIMITS.notes ? `${notes.slice(0, LIMITS.notes - 1)}…` : notes || undefined,
    examples,
  };
}

export class AIService {
  private readonly client: Anthropic;
  // Per instance; a burst limit, not accounting (that is in Postgres).
  private readonly recent = new Map<string, number[]>();
  private readonly sql: SQL;
  private readonly config: Config;

  constructor(sql: SQL, config: Config) {
    this.sql = sql;
    this.config = config;
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey, baseURL: config.anthropic.baseURL });
  }

  get enabled() {
    return !!(this.config.anthropic.apiKey || this.config.anthropic.baseURL);
  }

  // ---------- accounting ----------

  async credits(userId: UserId) {
    const [row] = await this.sql`select used from ai_usage where user_id = ${userId} and period = ${period()}`;
    const used = Number(row?.used ?? 0);
    const limit = this.config.freeCredits;
    return { used, limit, left: Math.max(0, limit - used), period: period() };
  }

  /**
   * Takes `n` credits up front, in one statement, so parallel requests can't
   * all pass a check and then all spend.
   */
  private async reserve(userId: UserId, n: number, at: string) {
    await this.sql`insert into ai_usage (user_id, period, used) values (${userId}, ${at}, 0) on conflict (user_id, period) do nothing`;
    const ok = await this.sql`update ai_usage set used = used + ${n}
      where user_id = ${userId} and period = ${at} and used + ${n} <= ${this.config.freeCredits} returning used`;
    if (!ok.length) throw refuse({ error: "out_of_credits", ...(await this.credits(userId)), needed: n });
  }

  private async refund(userId: UserId, n: number, at: string) {
    if (n > 0) await this.sql`update ai_usage set used = greatest(0, used - ${n}) where user_id = ${userId} and period = ${at}`;
  }

  /** Reserve `cost`, run the task, keep one credit per item it returned (at most `cost`), give back the rest. */
  private async spend<T>(userId: UserId, cost: number, task: () => Promise<{ value: T; items: number }>): Promise<T> {
    const at = period();
    await this.reserve(userId, cost, at);
    let kept = 0;
    try {
      this.rateLimit(userId);
      const r = await task();
      kept = Math.min(cost, r.items);
      return r.value;
    } finally {
      await this.refund(userId, cost - kept, at);
    }
  }

  async spentThisMonth(): Promise<number> {
    const [row] = await this.sql`select usd from ai_spend where period = ${period()}`;
    return Number(row?.usd ?? 0);
  }

  private rateLimit(userId: UserId) {
    const now = Date.now();
    const times = (this.recent.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (times.length >= this.config.aiRequestsPerMinute) throw refuse({ error: "slow_down" });
    times.push(now);
    this.recent.set(userId, times);
  }

  // ---------- model call ----------

  private async generate<T extends z.ZodType>(userId: UserId, task: string, schema: T, system: string, user: string): Promise<z.infer<T>> {
    if (!this.enabled) throw refuse({ error: "ai_off" });
    if ((await this.spentThisMonth()) >= this.config.monthlyBudgetUsd) {
      // A cost stop, not load: say so, and say until when.
      const d = new Date();
      const until = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
      throw refuse({ error: "paused", until });
    }
    const model = this.config.anthropic.model;
    const started = performance.now();
    const ms = () => Math.round(performance.now() - started);
    const record = (ok: boolean, usage?: { input_tokens: number; output_tokens: number }, usd = 0) =>
      this.sql`insert into ai_request (user_id, task, model, prompt_version, input_tokens, output_tokens, usd, ms, ok)
        values (${userId}, ${task}, ${model}, ${PROMPT_VERSION}, ${usage?.input_tokens ?? null}, ${usage?.output_tokens ?? null}, ${usd}, ${ms()}, ${ok})`.catch((err) =>
        log.error("ai_request log failed", { err }),
      );
    let res;
    try {
      res = await Sentry.startSpan({ name: `ai ${task}`, op: "ai.generate", attributes: { model } }, () => this.client.messages.parse({
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(schema) },
      }));
    } catch (e) {
      await record(false);
      event({ aiTask: task, aiModel: model, aiOk: false, aiMs: ms() });
      if (e instanceof Anthropic.RateLimitError) throw refuse({ error: "busy" });
      if (e instanceof Anthropic.APIConnectionError) throw refuse({ error: "ai_unreachable" });
      if (e instanceof Anthropic.APIError) throw refuse({ error: "ai_error", status: e.status });
      throw e;
    }
    // A model missing from PRICES is billed at the top price, so the budget stop comes early, not late.
    const [pin, pout] = PRICES[model] ?? [5, 25];
    const usd = (res.usage.input_tokens * pin + res.usage.output_tokens * pout) / 1_000_000;
    await this.sql`insert into ai_spend (period, usd) values (${period()}, ${usd})
      on conflict (period) do update set usd = ai_spend.usd + excluded.usd`;
    const ok = res.stop_reason !== "refusal" && !!res.parsed_output;
    await record(ok, res.usage, usd);
    event({ aiTask: task, aiModel: model, aiOk: ok, aiUsd: usd, aiTokensIn: res.usage.input_tokens, aiTokensOut: res.usage.output_tokens, aiMs: ms() });
    if (!ok) throw refuse({ error: "bad_output" });
    return res.parsed_output as z.infer<T>;
  }

  // ---------- tasks ----------

  /** Words the learner picked from their own text. One credit per word returned. */
  async mine(userId: UserId, input: MineIn) {
    // Nothing is charged for words the app could not save (fitWord keeps SENTENCES_PER_WORD each).
    await ensureRoom(this.sql, userId, "user_word", input.items.length);
    await ensureRoom(this.sql, userId, "user_sentence", SENTENCES_PER_WORD * input.items.length);
    const words = await this.spend(userId, input.items.length, async () => {
      const p = minePrompt(LANGUAGE[input.lang], "English", input.items, input.known);
      const out = await this.generate(userId, "mine", WordsOut, p.system, p.user);
      const value = out.words.map(fitWord).filter((w) => w !== null).slice(0, input.items.length);
      return { value, items: value.length };
    });
    return { words, credits: await this.credits(userId), model: this.config.anthropic.model };
  }

  /** New sentences for words the learner chose. One credit per word that got any. */
  async examples(userId: UserId, input: ExamplesIn) {
    await ensureRoom(this.sql, userId, "user_sentence", SENTENCES_PER_WORD * input.words.length);
    const examples = await this.spend(userId, input.words.length, async () => {
      const p = moreExamplesPrompt(LANGUAGE[input.lang], "English", input.words, input.known);
      const out = await this.generate(userId, "examples", SentencesOut, p.system, p.user);
      // Only words that were asked for, SENTENCES_PER_WORD each: what ensureRoom made room for, and what is charged.
      const asked = new Set(input.words.map((w) => w.lemma.trim().toLowerCase()));
      const perWord = new Map<string, number>();
      const value = out.examples
        .map((e) => fitSentence({ ...e, lemma: e.lemma.trim() }))
        .filter((e) => e !== null)
        .filter((e) => {
          const key = e.lemma.toLowerCase();
          const n = perWord.get(key) ?? 0;
          if (!asked.has(key) || n >= SENTENCES_PER_WORD) return false;
          perWord.set(key, n + 1);
          return true;
        });
      return { value, items: new Set(value.map((e) => e.lemma)).size };
    });
    return { examples, credits: await this.credits(userId), model: this.config.anthropic.model };
  }
}
