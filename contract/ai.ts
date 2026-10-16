// Perennial AI requests (POST /api/ai/mine and /api/ai/examples) and their
// answers. The request bodies are untrusted input from the app; the server
// checks them with these. The app checks the answers.

import { Schema } from "effect";
import { Credits } from "./api";
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

/** A sentence Perennial AI wrote, with the part to hide (`cloze`). */
export const GenSentence = Schema.Struct({ text: Schema.String, translation: Schema.String, cloze: Schema.String });
export type GenSentence = typeof GenSentence.Type;

/** A word Perennial AI made a card for. */
export const GenWord = Schema.Struct({
  lemma: Schema.String,
  gloss: Schema.String,
  pos: Schema.String,
  forms: Schema.Array(Schema.String),
  notes: Schema.optionalKey(Schema.String),
  examples: Schema.Array(GenSentence),
});
export type GenWord = typeof GenWord.Type;

/** The answer to /api/ai/mine: the words, the credits left, and the model that wrote them. */
export const MineOut = Schema.Struct({ words: Schema.Array(GenWord), credits: Credits, model: Schema.String });
export type MineOut = typeof MineOut.Type;

/** The answer to /api/ai/examples. Each sentence says which word it is for. */
export const ExamplesOut = Schema.Struct({ examples: Schema.Array(Schema.Struct({ ...GenSentence.fields, lemma: Schema.String })), credits: Credits, model: Schema.String });
export type ExamplesOut = typeof ExamplesOut.Type;
