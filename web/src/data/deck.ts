// Loading a language's static deck. Decks are bundled as lazy, content-hashed
// chunks (so browsers and the CDN keep them for good). They ship with the code
// that reads them, and CI decodes each one with the full schema and checks its
// invariants (scripts/deck/check.ts), so the app trusts their shape: decoding
// every entry again here cost about 150 ms of main thread at CPU 10× on each
// launch (#461).

import type { Deck, DeckSentence, DeckWord } from "../deck/schema";

const loaders = import.meta.glob<Deck>("../../../decks/*/deck.json", { import: "default" });

/** A deck sentence with its word keys, always there once loaded. */
export type CourseSentence = DeckSentence & { keys: readonly string[] };

export interface LoadedDeck {
  lang: string;
  version: number;
  /** Live words in frequency order (no retired words, no aliases). */
  words: DeckWord[];
  byId: Map<string, DeckWord>;
  sentencesByWord: Map<string, CourseSentence[]>;
  /** Resolves aliases; returns the word even if retired, or undefined. */
  resolve(id: string): DeckWord | undefined;
}

function index(d: Deck, lang: string): LoadedDeck {
  if (d.lang !== lang) throw new Error(`deck ${lang}: holds ${d.lang}`);
  const byId = new Map<string, DeckWord>(d.words.map((w) => [w.id, w]));
  const sentencesByWord = new Map<string, CourseSentence[]>();
  for (const s of d.sentences) {
    if (s.retired) continue;
    // The build adds keys (#453), so a sentence without them is a build bug.
    const keys = s.keys;
    if (!keys) throw new Error(`deck ${lang}: sentence ${s.id} has no keys`);
    const list = sentencesByWord.get(s.wordId) ?? [];
    list.push({ ...s, keys });
    sentencesByWord.set(s.wordId, list);
  }
  const resolve = (id: string) => {
    const w = byId.get(id);
    return w?.aliasOf ? (byId.get(w.aliasOf) ?? w) : w;
  };
  // A word without sentences can't be practised: leave it out of the course.
  const words = [...byId.values()].filter((w) => !w.retired && !w.aliasOf && sentencesByWord.has(w.id)).sort((a, b) => a.rank - b.rank);
  return { lang, version: d.version, words, byId, sentencesByWord, resolve };
}

const memo = new Map<string, Promise<LoadedDeck>>();
const loaded = new Map<string, LoadedDeck>();

/** A deck that has loaded already, or undefined: a screen that opens again draws at once, not after a wait for the promise. */
export function loadedDeck(lang: string): LoadedDeck | undefined {
  return loaded.get(lang);
}

export function loadDeck(lang: string): Promise<LoadedDeck> {
  let p = memo.get(lang);
  if (!p) {
    p = load(lang);
    memo.set(lang, p);
    p.then(
      (d) => void loaded.set(lang, d),
      (e) => {
        // Not kept: the next call tries again.
        memo.delete(lang);
        console.error(`[deck] ${lang}: could not load`, e);
      },
    );
  }
  return p;
}

async function load(lang: string): Promise<LoadedDeck> {
  const loader = loaders[`../../../decks/${lang}/deck.json`];
  if (!loader) throw new Error(`no deck for ${lang}`);
  return index(await loader(), lang);
}
