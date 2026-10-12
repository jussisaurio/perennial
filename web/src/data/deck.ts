// Loading a language's static deck. Decks are bundled as lazy, content-hashed
// chunks (so the service worker caches them for offline use) and validated
// defensively: a bad entry is skipped, never fatal. If a whole deck fails to
// load, the last good copy kept in the Cache API is used instead.

import { DeckSentence, DeckWord, type Deck } from "../deck/schema";

const loaders = import.meta.glob<unknown>("../../../decks/*/deck.json", { import: "default" });
const CACHE = "perennial-decks";

export interface LoadedDeck {
  lang: string;
  version: number;
  /** Live words in frequency order (no retired words, no aliases). */
  words: DeckWord[];
  byId: Map<string, DeckWord>;
  sentencesByWord: Map<string, DeckSentence[]>;
  /** Resolves aliases; returns the word even if retired, or undefined. */
  resolve(id: string): DeckWord | undefined;
  skipped: number;
}

function index(raw: unknown, lang: string): LoadedDeck {
  const d = raw as Partial<Deck> | null;
  if (!d || d.lang !== lang || !Array.isArray(d.words) || !Array.isArray(d.sentences)) throw new Error(`deck ${lang}: not a deck`);
  const W = DeckWord(lang);
  const S = DeckSentence(lang);
  let skipped = 0;
  const byId = new Map<string, DeckWord>();
  for (const w of d.words) {
    const r = W.safeParse(w);
    if (r.success) byId.set(r.data.id, r.data);
    else skipped++;
  }
  const sentencesByWord = new Map<string, DeckSentence[]>();
  for (const s of d.sentences) {
    const r = S.safeParse(s);
    if (!r.success || !r.data.text.includes(r.data.cloze) || !byId.has(r.data.wordId)) {
      skipped++;
      continue;
    }
    if (r.data.retired) continue;
    const list = sentencesByWord.get(r.data.wordId) ?? [];
    list.push(r.data);
    sentencesByWord.set(r.data.wordId, list);
  }
  const resolve = (id: string) => {
    const w = byId.get(id);
    return w?.aliasOf ? (byId.get(w.aliasOf) ?? w) : w;
  };
  // A word without sentences can't be practised: leave it out of the course.
  const words = [...byId.values()].filter((w) => !w.retired && !w.aliasOf && sentencesByWord.has(w.id)).sort((a, b) => a.rank - b.rank);
  if (skipped) console.warn(`[deck] ${lang}: skipped ${skipped} invalid entries`);
  return { lang, version: d.version ?? 0, words, byId, sentencesByWord, resolve, skipped };
}

const memo = new Map<string, Promise<LoadedDeck>>();

export function loadDeck(lang: string): Promise<LoadedDeck> {
  let p = memo.get(lang);
  if (!p) {
    p = load(lang);
    memo.set(lang, p);
    p.catch(() => memo.delete(lang));
  }
  return p;
}

async function load(lang: string): Promise<LoadedDeck> {
  const key = `../../../decks/${lang}/deck.json`;
  const url = `/__deck/${lang}`;
  try {
    const loader = loaders[key];
    if (!loader) throw new Error(`no deck for ${lang}`);
    const raw = await loader();
    const deck = index(raw, lang);
    // Keep a last good copy, in case a future version fails to load. Best
    // effort: no Cache API (not a secure context) or no space means no copy.
    void caches?.open(CACHE).then((c) => c.put(url, new Response(JSON.stringify(raw)))).catch(() => {});
    return deck;
  } catch (e) {
    const cached = await caches
      ?.open(CACHE)
      .then((c) => c.match(url))
      .catch(() => undefined);
    if (cached) {
      console.error(`[deck] ${lang}: using the last good copy`, e);
      return index(await cached.json(), lang);
    }
    throw e;
  }
}
