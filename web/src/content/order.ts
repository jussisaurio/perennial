// The order new words are introduced in. Decks stay in plain frequency order
// (docs/decks.md). Here the kinds of words take turns, so the first sessions
// are not all grammar words and abstract adverbs (de, que, no, el / ich, nicht,
// so, der) but things you can picture and actions: a fixed pattern of parts of
// speech, each kind still in frequency order.
//
// Garden words (#209) are the exception: they come at fixed places, early and
// steadily, so a new learner soon sees that learning a word brings something
// into the garden. Orchard words (#315) come at fixed places too, after the key.

import { runAll } from "../lib/yield";
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
 * @internal Exported for tests.
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

/** For deck words (anything with a part of speech). @internal Exported for tests. */
export const deckKind = (w: { pos?: string | null }) => kindOf(w.pos);

/**
 * Where the n-th garden word goes in the course (0-based): the 3rd word, so the
 * first session shows the idea; the 12th, so it reads as a rule; then with gaps
 * that start at 27 words and shrink by 2 each time, to no fewer than 12. New
 * words slow down as reviews fill the 5 minutes, so even gaps in words would be
 * ever longer gaps in days. Since #311 a daily learner gets about 22 new words
 * on day one and 8–9 a day later, so a new garden word comes every 2–3 days.
 * The slots stay: moving them would reorder the course for learners mid-course.
 * @internal Exported for tests.
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
 * place is at least 6 words from a garden place (those are 12 apart from 172
 * on, and these are 6 off that beat), so a new learner meets both where they are:
 * walkCourse never has to push one back.
 * @internal Exported for tests.
 */
export function orchardSlot(n: number): number {
  return 69 + 48 * n;
}

type DeckWord = { id: string; pos?: string | null; rank: number; garden?: GardenWord; orchard?: OrchardWord };

/** Garden and orchard words: the course places them, not their rank. */
export const placed = (w: { garden?: GardenWord; orchard?: OrchardWord }) => !!(w.garden || w.orchard);
const orders = new WeakMap<object, readonly DeckWord[]>();

/**
 * The course: the order learners meet a deck's words in. The one place that
 * decides it (sessions, the Words list's "New", the landing gardens all read
 * it); worked out once per loaded deck.
 */
export function courseOrder<W extends DeckWord>(deck: { words: readonly W[] }): readonly W[] {
  return runAll(courseOrderSteps(deck));
}

/** courseOrder a step at a time, to run in slices: ~10 ms at CPU 10× for a full deck (#569). */
export function* courseOrderSteps<W extends DeckWord>(deck: { words: readonly W[] }): Generator<void, readonly W[]> {
  const known = orders.get(deck);
  if (known) return known as readonly W[];
  const byRank = [...deck.words].sort((a, b) => a.rank - b.rank);
  yield;
  const garden = byRank.filter((w) => w.garden).sort((a, b) => GARDEN_WORDS.indexOf(a.garden!) - GARDEN_WORDS.indexOf(b.garden!));
  const orchard = byRank.filter((w) => w.orchard).sort((a, b) => ORCHARD_WORDS.indexOf(a.orchard!) - ORCHARD_WORDS.indexOf(b.orchard!));
  yield;
  const rest = introOrder(byRank.filter((w) => !placed(w)), deckKind);
  yield;
  const out: W[] = [];
  let g = 0;
  let o = 0;
  let r = 0;
  // A deck shorter than the slots (a test deck) gets its last garden, then orchard words at the end.
  while (out.length < byRank.length) {
    if (g < garden.length && (out.length === gardenSlot(g) || r === rest.length)) out.push(garden[g++]);
    else if (o < orchard.length && (out.length === orchardSlot(o) || r === rest.length)) out.push(orchard[o++]);
    else out.push(rest[r++]);
    yield;
  }
  // One order per deck: a courseOrder that finished while this one was in slices keeps its own.
  const done = orders.get(deck);
  if (done) return done as readonly W[];
  orders.set(deck, out);
  return out;
}

/** A learner behind on garden or orchard words gets one of them in every this many new words. */
const CATCH_UP = 5;

/**
 * `since`: other new words the learner started after their last garden or
 * orchard word, from the time of each word's first review. Sessions take only a
 * few new words at a time, so the spacing below must carry over from one session
 * to the next. Before any such word there is nothing to keep a distance from:
 * Infinity. `last`: that word's first review time (-Infinity for none).
 */
export function sinceLastPlaced(started: Iterable<{ garden?: GardenWord; orchard?: OrchardWord; first: number }>): { since: number; last: number } {
  const words = [...started];
  const last = Math.max(...words.filter(placed).map((w) => w.first));
  if (last === -Infinity) return { since: Infinity, last };
  return { since: words.filter((w) => !placed(w) && w.first > last).length, last };
}

/** walkCourse's walk so far: the words out, the garden and orchard words held back, and `since`. */
class Walker<W extends DeckWord> {
  readonly out: W[] = [];
  readonly due: W[] = [];
  since: number;
  constructor(since: number) {
    this.since = since;
  }
  /** The next open course word. */
  step(w: W) {
    if (placed(w)) {
      this.due.push(w);
      return;
    }
    if (this.due.length && this.since >= CATCH_UP - 1) {
      this.out.push(this.due.shift()!);
      this.since = 0;
    }
    this.out.push(w);
    this.since++;
  }
  /** From here on, the same words give the same list: `since` only matters up to CATCH_UP - 1. */
  same(o: Walker<W>): boolean {
    return Math.min(this.since, CATCH_UP - 1) === Math.min(o.since, CATCH_UP - 1) && this.due.length === o.due.length && this.due.every((w, i) => w === o.due[i]);
  }
}

/** walkCourse's answer, kept so the next walk can go on from it (walkAgain). `head`: the first open course place. */
export interface Walk<W> {
  list: W[];
  since: number;
  head: number;
}

/**
 * The words a learner meets next (`list`): the course, minus words they can't
 * get now (`open` false). A garden or orchard word comes at its place, but never
 * before CATCH_UP - 1 other new words since the last one (`since`:
 * sinceLastPlaced). A learner who was past their places when such words came to
 * the course gets them one in every CATCH_UP new words, not all in a row, in
 * course order. A new learner gets the course as it is: its places are further apart.
 */
export function walkCourse<W extends DeckWord>(course: readonly W[], open: (w: W) => boolean, since: number): Walk<W> {
  const walker = new Walker<W>(since);
  let head = course.length;
  for (let i = 0; i < course.length; i++) {
    if (!open(course[i])) continue;
    head = Math.min(head, i);
    walker.step(course[i]);
  }
  return { list: [...walker.out, ...walker.due], since, head };
}

/**
 * The walk of `prev` after a few words opened or closed (`changed`, their
 * places in the course; `wasOpen` says what they were before) and `since`
 * moved. Equal to walkCourse with `open` and `since` (#486). It walks the
 * old and the new course side by side, from the first open place, until both
 * are past the changed words and in the same state; the rest of the old list
 * is then the rest of the new one. A learner's answer starts a word at the
 * head of the course, so that is a few words, not the whole course.
 */
export function walkAgain<W extends DeckWord>(prev: Walk<W>, course: readonly W[], open: (w: W) => boolean, wasOpen: (w: W) => boolean, since: number, changed: ReadonlySet<number>): Walk<W> {
  // Before the old head, every place was closed, and those not changed still are.
  let from = prev.head;
  let last = -1;
  for (const i of changed) {
    if (i < from && open(course[i])) from = i;
    last = Math.max(last, i);
  }
  const now = new Walker<W>(since);
  const was = new Walker<W>(prev.since);
  let head = course.length;
  for (let i = from; i < course.length; i++) {
    const w = course[i];
    const o = open(w);
    if (o) {
      head = Math.min(head, i);
      now.step(w);
    }
    if (changed.has(i) ? wasOpen(w) : o) was.step(w);
    if (i >= last && now.same(was)) {
      while (head === course.length && ++i < course.length) if (open(course[i])) head = i;
      return { list: [...now.out, ...prev.list.slice(was.out.length)], since, head };
    }
  }
  return { list: [...now.out, ...now.due], since, head };
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
