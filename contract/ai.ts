// Perennial AI requests (POST /api/ai/mine and /api/ai/examples). The bodies
// are untrusted input from the app; the server checks them with these.

import { Schema } from "effect";
import { Lang } from "./course";

/** Trimmed first, then 1 to `max` characters. */
const short = (max: number) => Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const list = <S extends Schema.Top>(item: S, minLength: number, maxLength: number) => Schema.Array(item).check(Schema.isMinLength(minLength), Schema.isMaxLength(maxLength));

/** Words the learner picked from their own text, each with the sentence it came from. */
export const MineIn = Schema.Struct({
  lang: Lang,
  items: list(Schema.Struct({ form: short(60), sentence: short(400) }), 1, 15),
  known: list(short(40), 0, 400),
});
export type MineIn = typeof MineIn.Type;

/** Words that need new example sentences, with the ones the learner has already seen. */
export const ExamplesIn = Schema.Struct({
  lang: Lang,
  words: list(Schema.Struct({ lemma: short(60), gloss: short(120), seen: list(short(400), 0, 8) }), 1, 8),
  known: list(short(40), 0, 400),
});
export type ExamplesIn = typeof ExamplesIn.Type;
