// A deck's words, indexed for the app. Kept apart from deck.ts, which loads
// the parts through Vite, so code run outside Vite (the learner simulation,
// web/src/sim) indexes a deck the same way the app does.

import type { DeckWord } from "../deck/schema";

export type WordsPart = { lang: string; words: DeckWord[] };

export interface LoadedDeck {
  lang: string;
  /** Live words in frequency order (no retired words, no aliases). */
  words: DeckWord[];
  byId: Map<string, DeckWord>;
  /** Resolves aliases; returns the word even if retired, or undefined. */
  resolve(id: string): DeckWord | undefined;
}

/**
 * A word id to the id its memory is kept under: a deck alias to its word, and
 * the learner's own word to the deck word it was linked to (user_word.deck_id).
 */
export const wordResolver = (deck: LoadedDeck, linked: ReadonlyMap<string, string>) => (id: string) => deck.resolve(id)?.id ?? linked.get(id) ?? id;

export function indexWords(d: WordsPart, lang: string): LoadedDeck {
  if (d.lang !== lang) throw new Error(`deck ${lang}: holds ${d.lang}`);
  const byId = new Map<string, DeckWord>(d.words.map((w) => [w.id, w]));
  const resolve = (id: string) => {
    const w = byId.get(id);
    return w?.aliasOf ? (byId.get(w.aliasOf) ?? w) : w;
  };
  // Every live word has sentences (CI checks it), so all of them can be practised.
  const words = [...byId.values()].filter((w) => !w.retired && !w.aliasOf).sort((a, b) => a.rank - b.rank);
  return { lang, words, byId, resolve };
}
