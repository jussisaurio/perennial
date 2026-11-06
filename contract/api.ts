// The server's answers about the learner and about itself.

import { Schema } from "effect";
import { UserId } from "./ids";

/** AI words this month: one credit per word. */
export const Credits = Schema.Struct({ used: Schema.Number, limit: Schema.Number, left: Schema.Number, period: Schema.String });
export type Credits = typeof Credits.Type;

/** GET /api/me: the signed-in learner. */
export const Me = Schema.Struct({ id: UserId, email: Schema.NullOr(Schema.String), anonymous: Schema.Boolean, credits: Credits, ai: Schema.Boolean });
export type Me = typeof Me.Type;

/** GET /api/server: this server's release, the oldest app version it accepts writes from, and what it can do now. Public. */
export const ServerInfo = Schema.Struct({ release: Schema.String, minClientVersion: Schema.String, features: Schema.Struct({ ai: Schema.Boolean }) });
export type ServerInfo = typeof ServerInfo.Type;

/**
 * GET /api/rows: all of the learner's rows, per table, as stored (timestamps as
 * ISO strings). Each row is checked only as an object here: its columns are the
 * table's own (web/src/data/rows.ts). A Record schema would copy every row,
 * key by key: about 10 ms for a year of reviews, on the app's launch (#486).
 */
const isRow = (u: unknown): u is Record<string, unknown> => typeof u === "object" && u !== null && !Array.isArray(u);
// One check for the whole list: Schema.Array runs its decoder per row, ~20 ms at CPU 10× on a cold start (#447).
const Rows = Schema.declare((u: unknown): u is ReadonlyArray<Record<string, unknown>> => Array.isArray(u) && u.every(isRow));
export const LearnerRows = Schema.Struct({
  course: Rows,
  review: Rows,
  word_state: Rows,
  user_word: Rows,
  user_sentence: Rows,
});
export type LearnerRows = typeof LearnerRows.Type;
