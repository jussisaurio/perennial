// Loading a language's static deck. Decks are bundled as lazy, content-hashed
// chunks (so browsers and the CDN keep them for good). They ship with the code
// that reads them, and CI decodes each one with the full schema and checks its
// invariants (scripts/deck/check.ts), so the app trusts their shape: decoding
// every entry again here cost about 150 ms of main thread at CPU 10× on each
// launch (#461).
//
// A deck comes in two parts (#608, vite.config.ts): its words, which Today and
// the plan need, then its sentences, about 3/4 of the bytes, which cards,
// reading and the word page need.

import type { DeckSentence, DeckWord } from "../deck/schema";

type WordsPart = { lang: string; words: DeckWord[] };
type SentencesPart = { lang: string; sentences: DeckSentence[] };
const wordParts = import.meta.glob<WordsPart>("../../../decks/*/deck.json", { query: "?part=words", import: "default" });
const sentenceParts = import.meta.glob<SentencesPart>("../../../decks/*/deck.json", { query: "?part=sentences", import: "default" });

export interface LoadedDeck {
  lang: string;
  /** Live words in frequency order (no retired words, no aliases). */
  words: DeckWord[];
  byId: Map<string, DeckWord>;
  /** Resolves aliases; returns the word even if retired, or undefined. */
  resolve(id: string): DeckWord | undefined;
}

/** A deck's live sentences, by word. Every live word has at least 3 (deckProblems). */
export type DeckSentences = ReadonlyMap<string, DeckSentence[]>;

function indexWords(d: WordsPart, lang: string): LoadedDeck {
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

function indexSentences(d: SentencesPart, lang: string): DeckSentences {
  if (d.lang !== lang) throw new Error(`deck ${lang}: sentences hold ${d.lang}`);
  const byWord = new Map<string, DeckSentence[]>();
  // The part has live sentences only (vite.config.ts).
  for (const s of d.sentences) {
    const list = byWord.get(s.wordId) ?? [];
    list.push(s);
    byWord.set(s.wordId, list);
  }
  return byWord;
}

/** Loads a part once per language. A failed load is logged and not kept, so the next call tries again. */
function loader<T>(what: string, load: (lang: string) => Promise<T>) {
  const memo = new Map<string, Promise<T>>();
  const loaded = new Map<string, T>();
  return {
    /** Loaded already, or undefined: a screen that opens again draws at once, not after a wait for the promise. */
    now: (lang: string) => loaded.get(lang),
    get(lang: string): Promise<T> {
      let p = memo.get(lang);
      if (!p) {
        p = load(lang);
        memo.set(lang, p);
        p.then(
          (d) => void loaded.set(lang, d),
          (e) => {
            memo.delete(lang);
            console.error(`[deck] ${lang}: could not load ${what}`, e);
          },
        );
      }
      return p;
    },
  };
}

const words = loader("the words", async (lang) => {
  const part = wordParts[`../../../decks/${lang}/deck.json`];
  if (!part) throw new Error(`no deck for ${lang}`);
  return indexWords(await part(), lang);
});

// Only once the words are in: started together, the sentences would take most of the link the words need.
const sentences = loader("the sentences", async (lang) => {
  await words.get(lang);
  const part = sentenceParts[`../../../decks/${lang}/deck.json`];
  if (!part) throw new Error(`no deck for ${lang}`);
  return indexSentences(await part(), lang);
});

export const loadedDeck = words.now;
export const loadDeck = words.get;
export const loadedSentences = sentences.now;
export const loadSentences = sentences.get;
