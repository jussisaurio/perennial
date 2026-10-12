// Garden words: visitors and scenery are nouns in the course language, with
// their article, plus a few per-language extras (a croak, a sign). Every table
// has an entry for each deck language, so a new course cannot forget one.

import type { DeckLang } from "../deck/schema";

/** Something per course language. */
export type PerLang<T> = Record<DeckLang, T>;

/** A noun with its article, per course language, e.g. { es: "el caracol", de: "die Schnecke" }. */
export type NounWords = PerLang<string>;

/** This course's entry, or null for a language without one. */
export function inLang<T>(table: PerLang<T>, lang: string): T | null {
  return (table as Partial<Record<string, T>>)[lang] ?? null;
}

/** The noun without its article: "el caracol" → "caracol". */
export const bareNoun = (word: string): string => word.slice(word.indexOf(" ") + 1);

/** A garden noun: its words, its plain English gloss, and its deck lemma when that is not the noun after the article (a plural). */
export interface NounDef {
  words: NounWords;
  gloss: string;
  lemma?: NounWords;
}

/** The deck lemma behind a garden word: the noun after the article, or the singular for a plural. */
export function nounLemma(def: NounDef, lang: string): string | null {
  const word = inLang(def.words, lang);
  if (!word) return null;
  return (def.lemma && inLang(def.lemma, lang)) ?? bareNoun(word);
}

/** A garden noun as the garden shows it. */
export interface NounView {
  /** Article and noun, e.g. "el caracol". Null for a course with no word for it. */
  word: string | null;
  gloss: string;
  /** The learner knows this noun as one of their own words: it gets plant-label styling. */
  known: boolean;
}

/** `isKnown` gets the bare lemma ("perro", not "el perro"). */
export function nounView(def: NounDef, lang: string, isKnown: (lemma: string) => boolean = () => false): NounView {
  const lemma = nounLemma(def, lang);
  return { word: inLang(def.words, lang), gloss: def.gloss, known: !!lemma && isKnown(lemma) };
}
