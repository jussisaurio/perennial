// Which word ids exist: every deck word (retired ones too, so old reviews stay
// valid), per language. Reviews and word states may only point at these or at
// the learner's own words (user_word), so nobody can fill their garden with
// made-up words through the API.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DECKS = process.env.PERENNIAL_DECKS ?? fileURLToPath(new URL("../../decks", import.meta.url));

let byLang: Map<string, Set<string>> | null = null;

/** Deck word ids by language, read once from decks/<lang>/deck.json. */
export function deckWords(): Map<string, Set<string>> {
  if (byLang) return byLang;
  byLang = new Map();
  for (const lang of readdirSync(DECKS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    try {
      const deck = JSON.parse(readFileSync(join(DECKS, lang, "deck.json"), "utf8")) as { words: { id: string }[] };
      byLang.set(lang, new Set(deck.words.map((w) => w.id)));
    } catch {
      // A folder without a built deck: no words for it.
    }
  }
  return byLang;
}

/** A deck word, in `lang` if given (any language otherwise). */
export function isDeckWord(id: string, lang?: string): boolean {
  const decks = deckWords();
  if (lang) return decks.get(lang)?.has(id) ?? false;
  for (const ids of decks.values()) if (ids.has(id)) return true;
  return false;
}
