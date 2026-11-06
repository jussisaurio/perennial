// Which words of a sentence the learner has grown: after a card's answer shows,
// they get a faint tint, so the learner sees how much of real text they can read.
// And a whole sentence they can now read, for the summary (#412).

import { kindOf } from "../content/order";
import { formKey, tokenize } from "../content/text";
import { readMemory, wordState } from "../core/memory";
import type { Learner, Word } from "./learner";

/** Each form (lowercase) of `words` and the words it can be a form of. */
function indexOf(words: Iterable<Word>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const w of words) for (const f of new Set([w.lemma, ...w.forms].map(formKey))) index.set(f, [...(index.get(f) ?? []), w.id]);
  return index;
}

// The deck's words, indexed once per deck. Every answer makes a new learner, and
// indexing the whole deck again took 5–12 ms per card at CPU 10× (#457).
const deckIndexes = new WeakMap<Learner["deck"], Map<string, string[]>>();
// The whole index, once per words map: an answer keeps the map, and a list of every word per card made a major GC every few answers (#572).
const formIndexes = new WeakMap<Learner["words"], { get(form: string): string[] | undefined }>();

/** The words a form (lowercase) can be a form of: the deck's, then the learner's own. */
function formIndex(l: Learner): { get(form: string): string[] | undefined } {
  let index = formIndexes.get(l.words);
  if (index) return index;
  const words = [...l.words.values()];
  let deck = deckIndexes.get(l.deck);
  if (!deck) deckIndexes.set(l.deck, (deck = indexOf(words.filter((w) => w.source === "deck"))));
  const deckIndex = deck;
  const mine = indexOf(words.filter((w) => w.source === "user"));
  index = { get: (f) => (mine.has(f) ? [...(deckIndex.get(f) ?? []), ...mine.get(f)!] : deckIndex.get(f)) };
  formIndexes.set(l.words, index);
  return index;
}

/**
 * Where the sentence's grown words are: [start, end) in `text`. Grammar words
 * (de, que, und) are left out: they come first in the course, so they would
 * light up every sentence and say nothing about progress. So is `wordId`, the
 * word the card asks about.
 */
export function grownSpans(l: Learner, text: string, tag: string, wordId: string): [number, number][] {
  const index = formIndex(l);
  const spans: [number, number][] = [];
  for (const t of tokenize(text, tag)) {
    if (!t.word) continue;
    const ids = index.get(formKey(t.text)) ?? [];
    if (ids.includes(wordId)) continue;
    const grown = ids.some((id) => {
      const w = l.words.get(id)!; // !: the index is built from l.words
      return kindOf(w.pos) !== "function" && !!readMemory(l, id)?.reps;
    });
    if (grown) spans.push([t.index, t.index + t.text.length]);
  }
  return spans;
}

/** A sentence this short is not news: "Es mi casa." */
const READ_MIN_WORDS = 5;

export interface ReadNow {
  id: string;
  text: string;
  translation: string;
}

/**
 * A deck sentence the learner can read whole: every word in it is grown (grammar
 * words too), it has at least READ_MIN_WORDS words, it never came on a card
 * (no review names it) and is not in `shown`. Of those, the one with the most
 * words from `practised` (this session's words), so it is about today.
 */
export function readNow(l: Learner, practised: ReadonlySet<string>, shown: ReadonlySet<string>): ReadNow | null {
  const index = formIndex(l);
  const onCards = new Set(l.everyReview().map((r) => r.sentence_id));
  const grown = (id: string) => !!readMemory(l, id)?.reps;
  let best: { s: ReadNow; today: number } | null = null;
  for (const list of l.deck.sentencesByWord.values()) {
    for (const s of list) {
      if (onCards.has(s.id) || shown.has(s.id)) continue;
      if (s.keys.length < READ_MIN_WORDS) continue;
      let today = 0;
      const all = s.keys.every((k) => {
        const ids = (index.get(k) ?? []).filter(grown);
        if (ids.some((id) => practised.has(id))) today++;
        return ids.length > 0;
      });
      if (all && (!best || today > best.today)) best = { s: { id: s.id, text: s.text, translation: s.translation }, today };
    }
  }
  return best?.s ?? null;
}

/**
 * How many of the deck's sentences the learner can read whole: every word in
 * them is known, by the same rule as "You know N words", so the two never disagree.
 * The same text under two words counts once.
 */
export function readableCount(l: Learner): number {
  // Every form of every known word: a sentence word is known when one of them matches it.
  const known = new Set<string>();
  for (const w of l.words.values()) if (wordState(readMemory(l, w.id)) === "known") for (const f of [w.lemma, ...w.forms]) known.add(formKey(f));
  const readable = new Set<string>();
  for (const list of l.deck.sentencesByWord.values()) for (const s of list) if (s.keys.every((k) => known.has(k))) readable.add(s.text);
  return readable.size;
}
