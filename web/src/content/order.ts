// The order new words are introduced in. Decks stay in plain frequency order
// (docs/decks.md). Here the kinds of words take turns, so the first sessions
// are not all grammar words and abstract adverbs (de, que, no, el / ich, nicht,
// so, der) but things you can picture and actions: a fixed pattern of parts of
// speech, each kind still in frequency order.
//
// Garden words (#209) are the exception: they come at fixed places, early and
// steadily, so a new learner soon sees that learning a word brings something
// into the garden. Orchard words (#315) come at fixed places too, after the key.

import { GARDEN_WORDS, ORCHARD_WORDS, toPos, type GardenWord, type OrchardWord, type Pos } from "../deck/schema";

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
 * first session shows the idea; the 12th, so it reads as a rule; then with gaps
 * that start at 27 words and shrink by 2 each time, to no fewer than 12. New
 * words slow down as reviews fill the 5 minutes (12 on day one, about 2 a day
 * by day 30), so even gaps in words would be ever longer gaps in days; these
 * keep a new garden word about once a week for the first two months.
 */
export function gardenSlot(n: number): number {
  if (n === 0) return 2;
  let slot = 11;
  for (let i = 1; i < n; i++) slot += Math.max(12, 27 - 2 * (i - 1));
  return slot;
}

/**
 * Where the n-th orchard word goes in the course (0-based): the 70th, a few
 * words after the key (garden word 4, at 64), so the first tree comes soon after
 * the door opens; then one every 48 words, about one every few weeks. Every
 * place is at least 6 words from a garden place (those are 12 apart from 184
 * on, and these are 6 off that beat), so a new learner meets both where they are:
 * nextWords never has to push one back.
 */
export function orchardSlot(n: number): number {
  return 69 + 48 * n;
}

type DeckWord = { id: string; pos?: string | null; rank: number; garden?: GardenWord; orchard?: OrchardWord };

/** Garden and orchard words: the course places them, not their rank. */
const placed = (w: { garden?: GardenWord; orchard?: OrchardWord }) => !!(w.garden || w.orchard);
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
    const orchard = byRank.filter((w) => w.orchard).sort((a, b) => ORCHARD_WORDS.indexOf(a.orchard!) - ORCHARD_WORDS.indexOf(b.orchard!));
    const rest = introOrder(byRank.filter((w) => !placed(w)), deckKind);
    const out: W[] = [];
    let g = 0;
    let o = 0;
    let r = 0;
    // A deck shorter than the slots (a test deck) gets its last garden, then orchard words at the end.
    while (out.length < byRank.length) {
      if (g < garden.length && (out.length === gardenSlot(g) || r === rest.length)) out.push(garden[g++]);
      else if (o < orchard.length && (out.length === orchardSlot(o) || r === rest.length)) out.push(orchard[o++]);
      else out.push(rest[r++]);
    }
    order = out;
    orders.set(deck, order);
  }
  return order as readonly W[];
}

/** A learner behind on garden or orchard words gets one of them in every this many new words. */
const CATCH_UP = 5;

/**
 * Other new words the learner started after their last garden or orchard word,
 * from the time of each word's first review. Sessions take only a few new words
 * at a time, so the spacing below must carry over from one session to the next.
 * Before any such word there is nothing to keep a distance from: Infinity.
 */
export function sincePlaced(started: Iterable<{ garden?: GardenWord; orchard?: OrchardWord; first: number }>): number {
  const words = [...started];
  const last = Math.max(...words.filter(placed).map((w) => w.first));
  if (last === -Infinity) return Infinity;
  return words.filter((w) => !placed(w) && w.first > last).length;
}

/**
 * The words a learner meets next: the course, minus words they can't get now
 * (`open` false). A garden or orchard word comes at its place, but never before
 * CATCH_UP - 1 other new words since the last one (`since`: sincePlaced). A
 * learner who was past their places when such words came to the course gets
 * them one in every CATCH_UP new words, not all in a row, in course order. A new
 * learner gets the course as it is: its places are further apart.
 */
export function nextWords<W extends DeckWord>(course: readonly W[], open: (w: W) => boolean, since: number): W[] {
  const out: W[] = [];
  const due: W[] = [];
  for (const w of course) {
    if (!open(w)) continue;
    if (placed(w)) {
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

type ListWord = { id: string; source: "deck" | "user"; rank: number };

/**
 * The Words list's "New": what comes next, in the order sessions bring it
 * (`upcoming`, learner.ts), then the other words not practised yet (paused ones
 * too). Those come after it, so they never change that order.
 */
export function notStartedWords<W extends ListWord>(l: { upcoming(): W[]; words: Map<string, W>; memories: readonly { wordId: string; reps: number }[]; deck: { words: readonly DeckWord[] } }): W[] {
  const practised = new Set(l.memories.filter((m) => m.reps > 0).map((m) => m.wordId));
  const next = l.upcoming();
  const listed = new Set(next.map((w) => w.id));
  const others = [
    ...courseOrder(l.deck).map((w) => l.words.get(w.id)!),
    ...[...l.words.values()].filter((w) => w.source === "user").sort((a, b) => a.rank - b.rank),
  ].filter((w) => !listed.has(w.id) && !practised.has(w.id));
  // All of them, so a search under "New" finds any word not started yet (#262). The others come after, so a word paused here stays in view.
  return [...next, ...others];
}
