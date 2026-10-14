// How a card names a word: the form it asks about (#259), and the dictionary
// word that form belongs to, with its article (#260).

import { formKey, locate } from "./text";

/**
 * The form a card asks about: the word as its sentence has it, without the
 * capital it has only because it starts the sentence ("Soy" → "soy"). A
 * capital the word always has stays: German nouns, and formal "Sie" in the
 * middle of a sentence.
 */
export function askedForm(word: { forms: string[] }, s: { text: string; cloze: string }): string {
  const { text, cloze } = s;
  const at = locate(text, cloze);
  const startsSentence = at >= 0 && !/[\p{L}\p{N}]/u.test(text.slice(0, at));
  const lower = cloze.charAt(0).toLocaleLowerCase() + cloze.slice(1);
  return startsSentence && !word.forms.includes(cloze) && word.forms.includes(lower) ? lower : cloze;
}

/** The asked form, when it is not the dictionary word itself: then the answer says whose form it is. */
export function otherForm(word: { lemma: string }, asked: string): string | null {
  return formKey(asked) === formKey(word.lemma) ? null : asked;
}

/**
 * German nouns with their article: the article is part of the word to learn.
 * Not Spanish yet: there a feminine noun with a stressed a- takes "el" (el
 * agua), and the deck says so only in its notes.
 */
const ARTICLES: Record<string, Record<string, string>> = { de: { m: "der", f: "die", n: "das" } };

/** The word as the dictionary gives it: "der Mann", "haben". */
export function headword(word: { lemma: string; pos?: string | null; gender?: string }, lang: string): string {
  const article = word.pos === "noun" && word.gender ? ARTICLES[lang]?.[word.gender] : undefined;
  return article ? `${article} ${word.lemma}` : word.lemma;
}
