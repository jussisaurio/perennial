// Ids that are all plain strings on the wire, branded so that code can't mix
// them up (a user id where a word id belongs, say).

import { Schema } from "effect";

/** A learner (Better Auth's user id). */
export const UserId = Schema.String.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

/** A word: a deck word ("es.w.…"), one of the learner's own words (a uuid), or a hidden form ("form:es:…"). */
export const WordId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)).pipe(Schema.brand("WordId"));
export type WordId = typeof WordId.Type;
