// POST /api/write: a batch of mutations to the learner's rows, and the answer.
// The server checks, scopes and applies them (server/src/sync.ts).

import { Effect, Schema, SchemaTransformation } from "effect";
import { Lang } from "./course";
import { WordId } from "./ids";

/** Text limits for learner rows. Perennial AI output is held to the same ones (server/src/ai.ts). */
export const LIMITS = { lemma: 60, gloss: 120, pos: 20, form: 60, forms: 40, notes: 300, text: 400, translation: 400, cloze: 60 };

const max = (n: number) => Schema.String.check(Schema.isMaxLength(n));
/** Trimmed first, then 1 to `n` characters. */
const trimmed = (n: number) => Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(n));
const uuid = Schema.String.check(Schema.isUUID());
/** A time as an ISO string or epoch milliseconds (what `new Date()` reads); an invalid date is refused. */
const time = Schema.Union([Schema.String, Schema.Finite]).pipe(
  Schema.decodeTo(Schema.Date, SchemaTransformation.transform({ decode: (v) => new Date(v), encode: (d) => d.toISOString() })),
);
/** May be missing or null. */
const nullish = <S extends Schema.Top>(s: S) => Schema.optional(Schema.NullOr(s));
const int = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }));

export const Mutation = Schema.Union([
  Schema.Struct({
    type: Schema.tag("review.insert"),
    row: Schema.Struct({
      id: uuid,
      lang: Lang,
      word_id: WordId,
      skill: Schema.Literals(["read", "listen", "write"]),
      grade: int(1, 4),
      kind: Schema.Literals(["review", "known"]).pipe(Schema.withDecodingDefaultKey(Effect.succeed("review" as const))),
      reviewed_at: time,
      duration_ms: int(0, 3_600_000),
      sentence_id: nullish(max(120)),
    }),
  }),
  Schema.Struct({ type: Schema.tag("review.delete"), id: uuid }), // Undo
  Schema.Struct({
    type: Schema.tag("course.upsert"),
    row: Schema.Struct({
      lang: Lang,
      minutes: Schema.optionalKey(int(1, 120)),
      retention: Schema.optionalKey(Schema.Finite.check(Schema.isBetween({ minimum: 0.7, maximum: 0.99 }))),
      // The orchard door (#315). A new course row sends false; only true changes anything.
      door_open: Schema.optionalKey(Schema.Boolean),
      // The gardener's notes read (#654), by id. The server adds them to what it has: the list only grows.
      notes_read: Schema.optionalKey(Schema.Array(max(8)).check(Schema.isMaxLength(64))),
    }),
  }),
  Schema.Struct({
    type: Schema.tag("word_state.upsert"),
    row: Schema.Struct({ word_id: WordId, status: Schema.Literals(["queued", "paused", "ignored"]), queued_at: nullish(time), updated_at: time }),
  }),
  Schema.Struct({ type: Schema.tag("word_state.delete"), word_id: WordId, updated_at: time }),
  Schema.Struct({
    type: Schema.tag("user_word.upsert"),
    row: Schema.Struct({
      id: uuid,
      lang: Lang,
      lemma: trimmed(LIMITS.lemma),
      gloss: trimmed(LIMITS.gloss),
      pos: nullish(max(LIMITS.pos)),
      forms: Schema.Array(max(LIMITS.form)).check(Schema.isMaxLength(LIMITS.forms)),
      notes: nullish(max(LIMITS.notes)),
      deck_id: nullish(max(120)),
    }),
  }),
  Schema.Struct({ type: Schema.tag("user_word.delete"), id: uuid }),
  Schema.Struct({
    type: Schema.tag("user_sentence.insert"),
    row: Schema.Struct({
      id: uuid,
      word_id: WordId,
      text: trimmed(LIMITS.text),
      translation: trimmed(LIMITS.translation),
      cloze: trimmed(LIMITS.cloze),
      origin: Schema.Literals(["own-text", "ai"]),
      model: nullish(max(80)),
    }),
  }),
  Schema.Struct({ type: Schema.tag("user_sentence.delete"), id: uuid }),
]).pipe(Schema.toTaggedUnion("type"));
export type Mutation = typeof Mutation.Type;

/** Most mutations in one batch. */
export const MAX_BATCH = 500;

export const WriteBatch = Schema.Struct({
  mutations: Schema.Array(Mutation).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_BATCH)),
  /**
   * The app's own writes: the tab that made them, and for each mutation the
   * number of its write. A tab numbers its writes in order, and the server
   * applies each number once (server/src/sync.ts). A one-off write has none.
   */
  from: Schema.optionalKey(Schema.Struct({ tab: uuid, seq: Schema.Array(int(0, 2 ** 31 - 1)) })),
});
export type WriteBatch = typeof WriteBatch.Type;

const Rows = Schema.Array(Schema.Record(Schema.String, Schema.Unknown));

/**
 * Whether any row changed (a retried insert or an older state changes none),
 * and the rows the server now has for each course and word state in the batch.
 * The server merges those (the door, the newer word state), so they
 * can differ from the device's. A word state that is not there was deleted.
 */
export const WriteResult = Schema.Struct({ changed: Schema.Boolean, stored: Schema.Struct({ course: Rows, word_state: Rows }) });
export type WriteResult = typeof WriteResult.Type;
