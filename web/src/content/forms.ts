// How a card names a word: the form it asks about (#259), and the dictionary
// word that form belongs to.

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
