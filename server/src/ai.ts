// Perennial AI: task endpoints only, never a raw "complete this prompt" proxy.
//
// Cost model
// - The course itself is static decks: no AI at runtime.
// - Personal extras (words from your own text, fresh sentences) spend credits:
//   one per word, a monthly allowance per learner.
// - Every model call adds to a monthly spend total; past the budget, AI pauses
//   for everyone until the next month. Every call is logged in ai_request.

import { PgClient } from "@effect/sql-pg";
import { Clock, Context, Effect, Exit, Layer, Schema } from "effect";
import type { SqlError } from "effect/sql/SqlError";
import { LIMITS, type Credits, type ExamplesIn, type MineIn, type UserId } from "perennial-contract";
import { AppConfig, PRICES } from "./config";
import { LANGUAGE } from "./course";
import { theRow } from "./db";
import { type ApiError, refuse } from "./http";
import { Model } from "./model";
import { minePrompt, moreExamplesPrompt, PROMPT_VERSION, SENTENCES_PER_WORD, type GenWord } from "./prompts";
import { event, RequestContext } from "./request";
import { Sync } from "./sync";

/** "2026-10": credits and the spend budget reset each calendar month (UTC). */
const period = Effect.map(Clock.currentTimeMillis, (now) => new Date(now).toISOString().slice(0, 7));

// ---------- model output schemas (structured outputs guarantee the shape) ----------

/**
 * A limit the model is told about (in its JSON schema), not one decoding
 * checks: structured outputs can't enforce lengths, and one long note must not
 * fail the whole answer. fitWord/fitSentence then hold every item to the
 * /api/write limits.
 */
const told = <T>(limit: { maxLength: number } | { maxItems: number }) => Schema.makeFilter<T>(() => true, { toJsonSchema: () => limit });
const str = (maxLength: number) => Schema.String.check(told<string>({ maxLength }));
const SentenceOut = Schema.Struct({ text: str(LIMITS.text), translation: str(LIMITS.translation), cloze: str(LIMITS.cloze) });
const WordOut = Schema.Struct({
  lemma: str(LIMITS.lemma),
  gloss: str(LIMITS.gloss),
  pos: str(LIMITS.pos),
  forms: Schema.Array(str(LIMITS.form)).check(told<ReadonlyArray<string>>({ maxItems: LIMITS.forms })),
  notes: str(LIMITS.notes),
  examples: Schema.Array(SentenceOut),
});
const WordsOut = Schema.Struct({ words: Schema.Array(WordOut) });
const SentencesOut = Schema.Struct({ examples: Schema.Array(Schema.Struct({ ...SentenceOut.fields, lemma: str(LIMITS.lemma) })) });

/** Required text that doesn't fit is dropped (null): cutting a gloss or a sentence would change what it says. */
const fits = (s: string, max: number) => {
  const t = s.trim();
  return t && t.length <= max ? t : null;
};

function fitSentence<E extends typeof SentenceOut.Type>(e: E): E | null {
  const text = fits(e.text, LIMITS.text), translation = fits(e.translation, LIMITS.translation), cloze = fits(e.cloze, LIMITS.cloze);
  return text && translation && cloze ? { ...e, text, translation, cloze } : null;
}

/** A word /api/write would refuse, or one with no usable sentence, is dropped (and not charged). Notes and pos are cut short. */
function fitWord(w: typeof WordOut.Type): GenWord | null {
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

type Words = { words: GenWord[]; credits: Credits; model: string };
type Examples = { examples: (typeof SentencesOut.Type)["examples"][number][]; credits: Credits; model: string };

export class Ai extends Context.Service<
  Ai,
  {
    /** A model is configured. */
    readonly enabled: boolean;
    readonly credits: (userId: UserId) => Effect.Effect<Credits>;
    /** USD spent on the model this month, by everyone. */
    readonly spentThisMonth: () => Effect.Effect<number>;
    /** Words the learner picked from their own text. One credit per word returned. */
    readonly mine: (userId: UserId, input: MineIn) => Effect.Effect<Words, ApiError, RequestContext>;
    /** New sentences for words the learner chose. One credit per word that got any. */
    readonly examples: (userId: UserId, input: ExamplesIn) => Effect.Effect<Examples, ApiError, RequestContext>;
  }
>()("perennial/Ai") {}

export const AiLive = Layer.effect(
  Ai,
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const config = yield* AppConfig;
    const models = yield* Model;
    const sync = yield* Sync;
    const enabled = !!(config.anthropic.apiKey || config.anthropic.baseURL);
    // Per instance; a burst limit, not accounting (that is in Postgres).
    const recent = new Map<string, number[]>();

    // A database failure while answering is an outage or a bug: a defect
    // (500, with a Sentry report), as before. Refusals stay typed.

    // ---------- accounting ----------

    const credits = Effect.fn("Ai.credits")(function* (userId: UserId) {
      const at = yield* period;
      const [row] = yield* sql<{ used: number }>`select used from ai_usage where user_id = ${userId} and period = ${at}`;
      const used = row?.used ?? 0; // no row yet: nothing used this month
      const limit = config.freeCredits;
      return { used, limit, left: Math.max(0, limit - used), period: at };
    }, Effect.orDie);

    /**
     * Takes `n` credits up front, in one statement, so parallel requests can't
     * all pass a check and then all spend.
     */
    const reserve = Effect.fnUntraced(function* (userId: UserId, n: number, at: string) {
      yield* sql`insert into ai_usage (user_id, period, used) values (${userId}, ${at}, 0) on conflict (user_id, period) do nothing`;
      const ok = yield* sql`update ai_usage set used = used + ${n}
        where user_id = ${userId} and period = ${at} and used + ${n} <= ${config.freeCredits} returning used`;
      if (!ok.length) return yield* refuse({ error: "out_of_credits", ...(yield* credits(userId)), needed: n });
    });

    const refund = (userId: UserId, n: number, at: string) =>
      n > 0 ? Effect.asVoid(sql`update ai_usage set used = greatest(0, used - ${n}) where user_id = ${userId} and period = ${at}`) : Effect.void;

    /** Reserve `cost`, run the task, keep one credit per item it returned (at most `cost`), give back the rest. */
    const spend = <T>(userId: UserId, cost: number, task: Effect.Effect<{ value: T; items: number }, ApiError | SqlError, RequestContext>) =>
      Effect.flatMap(period, (at) =>
        Effect.acquireUseRelease(
          reserve(userId, cost, at),
          () => Effect.andThen(rateLimit(userId), task),
          // On a refusal or a defect nothing is kept.
          (_, exit) => refund(userId, cost - (Exit.isSuccess(exit) ? Math.min(cost, exit.value.items) : 0), at),
        ),
      ).pipe(Effect.map((r) => r.value));

    const spentThisMonth = Effect.fn("Ai.spentThisMonth")(function* () {
      const at = yield* period;
      const [row] = yield* sql<{ usd: string }>`select usd from ai_spend where period = ${at}`;
      return Number(row?.usd ?? 0); // numeric arrives as text; no row yet: nothing spent this month
    }, Effect.orDie);

    const rateLimit = (userId: UserId) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) => {
        const times = (recent.get(userId) ?? []).filter((t) => now - t < 60_000); // none yet: a first request
        if (times.length >= config.aiRequestsPerMinute) return Effect.fail(refuse({ error: "slow_down" }));
        times.push(now);
        recent.set(userId, times);
        return Effect.void;
      });

    // ---------- model call ----------

    const generate = Effect.fnUntraced(function* <S extends Schema.Top & { readonly DecodingServices: never }>(userId: UserId, task: string, schema: S, prompt: { system: string; user: string }) {
      if (!enabled) return yield* refuse({ error: "ai_off" });
      if ((yield* spentThisMonth()) >= config.monthlyBudgetUsd) {
        // A cost stop, not load: say so, and say until when.
        const d = new Date(yield* Clock.currentTimeMillis);
        const until = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
        return yield* refuse({ error: "paused", until });
      }
      const model = config.anthropic.model;
      const started = performance.now();
      const ms = () => Math.round(performance.now() - started);
      const record = (ok: boolean, usage?: { input_tokens: number; output_tokens: number }, usd = 0) =>
        sql`insert into ai_request (user_id, task, model, prompt_version, input_tokens, output_tokens, usd, ms, ok)
          values (${userId}, ${task}, ${model}, ${PROMPT_VERSION}, ${usage?.input_tokens ?? null}, ${usage?.output_tokens ?? null}, ${usd}, ${ms()}, ${ok})`.pipe(
          Effect.asVoid,
          // The log of calls is for us; a lost row must not fail the learner's request.
          Effect.catchTag("SqlError", (err) => Effect.logError("ai_request log failed").pipe(Effect.annotateLogs({ err }))),
        );
      const res = yield* models.ask(task, schema, prompt).pipe(Effect.tapCause(() => Effect.andThen(record(false), event({ aiTask: task, aiModel: model, aiOk: false, aiMs: ms() }))));
      // A model missing from PRICES is billed at the top price, so the budget stop comes early, not late.
      const [pin, pout] = PRICES[model] ?? [5, 25];
      const usd = (res.usage.input_tokens * pin + res.usage.output_tokens * pout) / 1_000_000;
      yield* sql`insert into ai_spend (period, usd) values (${yield* period}, ${usd})
        on conflict (period) do update set usd = ai_spend.usd + excluded.usd`;
      const output = res.refused ? null : res.output;
      yield* record(output !== null, res.usage, usd);
      yield* event({ aiTask: task, aiModel: model, aiOk: output !== null, aiUsd: usd, aiTokensIn: res.usage.input_tokens, aiTokensOut: res.usage.output_tokens, aiMs: ms() });
      if (output === null) return yield* refuse({ error: "bad_output" });
      return output;
    });

    // ---------- tasks ----------

    const mine = Effect.fn("Ai.mine")(
      function* (userId: UserId, input: MineIn) {
        // Nothing is charged for words the app could not save (fitWord keeps SENTENCES_PER_WORD each).
        yield* sync.ensureRoom(userId, "user_word", input.items.length);
        yield* sync.ensureRoom(userId, "user_sentence", SENTENCES_PER_WORD * input.items.length);
        const words = yield* spend(
          userId,
          input.items.length,
          Effect.gen(function* () {
            const out = yield* generate(userId, "mine", WordsOut, minePrompt(LANGUAGE[input.lang], "English", input.items, input.known));
            const value = out.words.map(fitWord).filter((w) => w !== null).slice(0, input.items.length);
            return { value, items: value.length };
          }),
        );
        return { words, credits: yield* credits(userId), model: config.anthropic.model };
      },
      Effect.catchTag("SqlError", Effect.die),
    );

    const examples = Effect.fn("Ai.examples")(
      function* (userId: UserId, input: ExamplesIn) {
        yield* sync.ensureRoom(userId, "user_sentence", SENTENCES_PER_WORD * input.words.length);
        const examples = yield* spend(
          userId,
          input.words.length,
          Effect.gen(function* () {
            const out = yield* generate(userId, "examples", SentencesOut, moreExamplesPrompt(LANGUAGE[input.lang], "English", input.words, input.known));
            // Only words that were asked for, SENTENCES_PER_WORD each: what ensureRoom made room for, and what is charged.
            const asked = new Set(input.words.map((w) => w.lemma.trim().toLowerCase()));
            const perWord = new Map<string, number>();
            const value = out.examples
              .map((e) => fitSentence({ ...e, lemma: e.lemma.trim() }))
              .filter((e) => e !== null)
              .filter((e) => {
                const key = e.lemma.toLowerCase();
                const n = perWord.get(key) ?? 0; // the word's first sentence
                if (!asked.has(key) || n >= SENTENCES_PER_WORD) return false;
                perWord.set(key, n + 1);
                return true;
              });
            return { value, items: new Set(value.map((e) => e.lemma)).size };
          }),
        );
        return { examples, credits: yield* credits(userId), model: config.anthropic.model };
      },
      Effect.catchTag("SqlError", Effect.die),
    );

    return Ai.of({ enabled, credits, spentThisMonth, mine, examples });
  }),
);
