// The order new words are introduced in. Decks stay in plain frequency order
// (docs/decks.md). Here the kinds of words take turns, so the first sessions
// are not all grammar words and abstract adverbs (de, que, no, el / ich, nicht,
// so, der) but things you can picture and actions: a fixed pattern of parts of
// speech, each kind still in frequency order.

import { toPos, type Pos } from "../deck/schema";

export type WordKind = "noun" | "verb" | "other" | "function";

/** Grammar rather than things, actions or qualities. */
export const FUNCTION_POS: ReadonlySet<Pos> = new Set<Pos>(["prep", "conj", "det", "pron", "particle", "interj"]);

export function kindOf(pos: string | null | undefined): WordKind {
  const p = toPos(pos);
  if (p === "noun") return "noun";
  if (p === "verb") return "verb";
  if (p && FUNCTION_POS.has(p)) return "function";
  return "other"; // adjectives, adverbs, numbers, phrases
}

/** One turn each, repeated: 2 nouns, a verb, a describing word, a grammar word in every 5. */
export const PATTERN: readonly WordKind[] = ["noun", "verb", "noun", "other", "function"];

/**
 * Interleave by kind following PATTERN; within a kind, the given order stays.
 * A kind that has run out gives its turn to the next kind in the pattern.
 */
export function introOrder<T>(items: readonly T[], kind: (item: T) => WordKind, pattern: readonly WordKind[] = PATTERN): T[] {
  const queues = new Map<WordKind, T[]>();
  for (const k of pattern) queues.set(k, []);
  for (const i of items) (queues.get(kind(i)) ?? queues.get("other")!).push(i);
  const next = new Map<WordKind, number>([...queues.keys()].map((k) => [k, 0]));
  const out: T[] = [];
  for (let turn = 0; out.length < items.length; turn++) {
    // This turn's kind, or the next one in the pattern that still has words.
    for (let step = 0; step < pattern.length; step++) {
      const k = pattern[(turn + step) % pattern.length];
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

type DeckWord = { id: string; pos?: string | null; rank: number };
const orders = new WeakMap<object, readonly DeckWord[]>();

/**
 * The course: the order learners meet a deck's words in. The one place that
 * decides it (sessions, the Words list's "New", the landing gardens all read
 * it); worked out once per loaded deck.
 */
export function courseOrder<W extends DeckWord>(deck: { words: readonly W[] }): readonly W[] {
  let order = orders.get(deck);
  if (!order) {
    order = introOrder([...deck.words].sort((a, b) => a.rank - b.rank), deckKind);
    orders.set(deck, order);
  }
  return order as readonly W[];
}
