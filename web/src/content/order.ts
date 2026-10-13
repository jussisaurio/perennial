// The order new words are introduced in. Decks stay in plain frequency order
// (docs/decks.md). Here the kinds of words take turns, so the first sessions
// are not all grammar words and abstract adverbs (de, que, no, el / ich, nicht,
// so, der) but things you can picture and actions: a fixed pattern of parts of
// speech, each kind still in frequency order.
//
// Garden words (#209) are the exception: they come at fixed places, early and
// steadily, so a new learner soon sees that learning a word brings something
// into the garden.

import { GARDEN_WORDS, toPos, type GardenWord, type Pos } from "../deck/schema";

export type WordKind = "noun" | "verb" | "other" | "function";

/** Grammar rather than things, actions or qualities. */
const FUNCTION_POS: ReadonlySet<Pos> = new Set<Pos>(["prep", "conj", "det", "pron", "particle", "interj"]);

export function kindOf(pos: string | null | undefined): WordKind {
  const p = toPos(pos);
  if (p === "noun") return "noun";
  if (p === "verb") return "verb";
  if (p && FUNCTION_POS.has(p)) return "function";
  return "other"; // adjectives, adverbs, numbers, phrases
}

/** One turn each, repeated: 2 nouns, a verb, a describing word, a grammar word in every 5. */
const PATTERN: readonly WordKind[] = ["noun", "verb", "noun", "other", "function"];

/**
 * Interleave by kind following PATTERN; within a kind, the given order stays.
 * A kind that has run out gives its turn to the next kind in the pattern.
 */
export function introOrder<T>(items: readonly T[], kind: (item: T) => WordKind): T[] {
  const queues = new Map<WordKind, T[]>();
  for (const k of PATTERN) queues.set(k, []);
  for (const i of items) queues.get(kind(i))!.push(i); // every kind is in PATTERN
  const next = new Map<WordKind, number>([...queues.keys()].map((k) => [k, 0]));
  const out: T[] = [];
  for (let turn = 0; out.length < items.length; turn++) {
    // This turn's kind, or the next one in the pattern that still has words.
    for (let step = 0; step < PATTERN.length; step++) {
      const k = PATTERN[(turn + step) % PATTERN.length];
      const q = queues.get(k)!;
      const at = next.get(k)!;
      if (at < q.length) {
        out.push(q[at]);
        next.set(k, at + 1);
        break;
      }
    }
  }
  return out;
}

/** For deck words (anything with a part of speech). */
export const deckKind = (w: { pos?: string | null }) => kindOf(w.pos);

/**
 * Where the n-th garden word goes in the course (0-based): the 3rd word, so the
 * first session shows the idea; the 12th, so it reads as a rule; then every 27th.
 */
const gardenSlot = (n: number) => (n === 0 ? 2 : 11 + (n - 1) * 27);

type DeckWord = { id: string; pos?: string | null; rank: number; garden?: GardenWord };
const orders = new WeakMap<object, readonly DeckWord[]>();

/**
 * The course: the order learners meet a deck's words in. The one place that
 * decides it (sessions, the Words list's "New", the landing gardens all read
 * it); worked out once per loaded deck.
 */
export function courseOrder<W extends DeckWord>(deck: { words: readonly W[] }): readonly W[] {
  let order = orders.get(deck);
  if (!order) {
    const byRank = [...deck.words].sort((a, b) => a.rank - b.rank);
    const garden = byRank.filter((w) => w.garden).sort((a, b) => GARDEN_WORDS.indexOf(a.garden!) - GARDEN_WORDS.indexOf(b.garden!));
    const rest = introOrder(byRank.filter((w) => !w.garden), deckKind);
    const out: W[] = [];
    let g = 0;
    let r = 0;
    // A deck shorter than the slots (a test deck) gets its last garden words at the end.
    while (out.length < byRank.length) out.push(g < garden.length && (out.length === gardenSlot(g) || r === rest.length) ? garden[g++] : rest[r++]);
    order = out;
    orders.set(deck, order);
  }
  return order as readonly W[];
}

/** A learner behind on garden words gets one of them in every this many new words. */
const CATCH_UP = 5;

/**
 * The words a learner meets next: the course, minus words they can't get now
 * (`open` false). A garden word comes at its place, but never closer than
 * CATCH_UP words after the last one. A learner who was past their places when
 * garden words came to the course gets them one in every CATCH_UP new words,
 * not all in a row. A new learner gets the course as it is: its garden places
 * are further apart.
 */
export function nextWords<W extends DeckWord>(course: readonly W[], open: (w: W) => boolean): W[] {
  const out: W[] = [];
  const due: W[] = [];
  let since = CATCH_UP - 1; // other words since the last garden word
  for (const w of course) {
    if (!open(w)) continue;
    if (w.garden) {
      due.push(w);
      continue;
    }
    if (due.length && since >= CATCH_UP - 1) {
      out.push(due.shift()!);
      since = 0;
    }
    out.push(w);
    since++;
  }
  return [...out, ...due];
}
