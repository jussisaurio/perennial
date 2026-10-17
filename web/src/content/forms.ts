// How a card names a word: the form it asks about (#259), and the dictionary
// word that form belongs to, with its article (#260).

import type { DeckLang, Gender } from "../deck/schema";
import { formKey, locate } from "./text";

/** Text before a word that starts a sentence: nothing, or an end mark (. ! ? … or a dialogue dash), then only spaces, quotes and opening marks. */
const SENTENCE_START = /(?:^|[.!?…–—])[\s"'„“”‚‘’«»¡¿(]*$/u;

/**
 * The form a card asks about: the word as its sentence has it, without the
 * capital it has only because it starts a sentence ("Soy" → "soy"). A word
 * whose dictionary form has a capital keeps it: German nouns ("Fass", a
 * barrel, and "fass", grab, differ). A card without a sentence asks about the
 * dictionary word itself.
 */
export function askedForm(word: { lemma: string }, s: { text: string; cloze: string } | undefined): string {
  if (!s?.cloze) return word.lemma;
  const { text, cloze } = s;
  const at = locate(text, cloze);
  const startsSentence = at >= 0 && SENTENCE_START.test(text.slice(0, at));
  const lower = (w: string) => w.charAt(0).toLocaleLowerCase() + w.slice(1);
  return startsSentence && lower(word.lemma) === word.lemma ? lower(cloze) : cloze;
}

/** The asked form, when it is not the dictionary word itself: then the answer says whose form it is. */
export function otherForm(word: { lemma: string }, asked: string): string | null {
  return formKey(asked) === formKey(word.lemma) ? null : asked;
}

/**
 * German nouns with their article: the article is part of the word to learn.
 * Not Spanish yet (#289): there a feminine noun with a stressed a- takes "el"
 * (el agua), and the deck says so only in its notes. "mf" (el/la colega) is a
 * Spanish case: no German noun has it, so it gets no article.
 */
const ARTICLES: Partial<Record<DeckLang, Partial<Record<Gender, string>>>> = { de: { m: "der", f: "die", n: "das" } };

/** The word as the dictionary gives it: "der Mann", "haben". */
export function headword(word: { lemma: string; pos?: string | null; gender?: Gender }, lang: string): string {
  const article = word.pos === "noun" && word.gender ? ARTICLES[lang as DeckLang]?.[word.gender] : undefined; // the course code is checked where it enters
  return article ? `${article} ${word.lemma}` : word.lemma;
}
