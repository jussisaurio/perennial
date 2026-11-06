// Today's garden visitors for the signed-in learner, from review dates and
// known words. Visitor words are never reviews, stats or Words list entries.

import { knownAt, readMemory, reviewedAt, wordState, type MemoryRow } from "../core/memory";
import type { Learner, Word } from "../data/learner";
import { dayNumber, startOfDay } from "../core/day";
import { basket, bowlNow, FRUIT_KINDS, NO_LEFT, ROWS, walked, type Fruit, type FruitKind, type Guest, type LeaveFacts, type LeaveWalk } from "../garden/leave";
import {
  learnerFacts,
  milestoneLine,
  moleVisits,
  NO_FACTS,
  STRIP_VISITORS,
  VISITORS,
  visitorsFor,
  visitorViews,
  welcomeBack,
  type LearnerFacts,
  type StripVisitorId,
  type TodayVisitors,
  type VisitorId,
  type VisitorOverride,
  type VisitorView,
} from "../garden/visitors";
import { sceneryViews, type SceneryViews } from "../garden/scenery";
import type { BoatWord } from "../garden/toys";
import type { GardenWord } from "../deck/schema";

/** Dev builds only: `?visitors=all` or `?visitors=cat,bird` shows those visitors, for screenshots and tests. */
function devVisitorOverride(): VisitorOverride {
  if (!import.meta.env.DEV) return null;
  const v = new URLSearchParams(location.search).get("visitors");
  if (!v) return null;
  if (v === "all") return "all";
  return v.split(",").filter((id): id is VisitorId | StripVisitorId => VISITORS.some((d) => d.id === id) || id in STRIP_VISITORS);
}

export interface LearnerVisitors {
  facts: LearnerFacts;
  today: TodayVisitors;
  views: VisitorView[];
  /** The Today screen line after a break, or null. */
  welcome: string | null;
  /** The Today screen line on the day a known-word milestone is crossed, or null. */
  milestone: string | null;
  /** Words the learner knows (lemmas) for the frog to croak: nouns once there are a few. */
  known: string[];
  /** The mole looks up at the far right end of the strip today. */
  mole: boolean;
  /** Words for the garden itself (#74), shown in the walk when you tap the sunflower, a tree, the pond... */
  scenery: SceneryViews;
}

/**
 * The learner's known words: how many (all of them, for unlocks and
 * milestones), their lemmas (lower case), and what the frog may croak.
 */
export function knownWords(words: Iterable<Pick<Word, "id" | "lemma" | "pos">>, memory: { get: (key: string) => Pick<MemoryRow, "s" | "reps"> | undefined }): { count: number; lemmas: Set<string>; croaks: string[] } {
  const all: string[] = [];
  const nouns: string[] = [];
  const lemmas = new Set<string>();
  for (const w of words)
    if (wordState(readMemory({ memory }, w.id)) === "known") {
      all.push(w.lemma);
      if (w.pos === "noun") nouns.push(w.lemma);
      lemmas.add(w.lemma.toLowerCase());
    }
  // The frog croaks things: "croac… casa" is a joke, "croac… no" is not. Only its pool is nouns; the count is every known word.
  return { count: all.length, lemmas, croaks: nouns.length >= 5 ? nouns : all };
}

/**
 * A garden word brings its visitor (#209) once it has a good reading answer:
 * a remembered one, or "I knew it". A wrong first answer does not count, so the
 * visitor and its line come with the first good one.
 */
export function broughtVisitor(l: Pick<Learner, "reviewsByWord">, wordId: string): boolean {
  return broughtAt(l, wordId) !== null;
}

/** When a garden word brought its visitor: its first good reading answer (ms), or null while it has none. */
export function broughtAt(l: Pick<Learner, "reviewsByWord">, wordId: string): number | null {
  let at: number | null = null;
  // `?? []`: a word never reviewed has no list.
  for (const r of l.reviewsByWord.get(wordId) ?? []) if (r.skill === "read" && r.grade >= 3 && (at === null || reviewedAt(r) < at)) at = reviewedAt(r);
  return at;
}

/** The garden words (#209) whose visitors the learner has brought. */
export function gardenBrought(l: Pick<Learner, "reviewsByWord" | "deck">): Set<GardenWord> {
  const garden = new Set<GardenWord>();
  for (const w of l.deck.words) if (w.garden && broughtVisitor(l, w.id)) garden.add(w.garden);
  return garden;
}

/** When the learner brought this garden word's visitor (#334: the key, for the help it gets once it has waited): the earliest of its words' broughtAt, or null. */
export function gardenBroughtAt(l: Pick<Learner, "reviewsByWord" | "deck">, g: GardenWord): number | null {
  let at: number | null = null;
  for (const w of l.deck.words) {
    const t = w.garden === g ? broughtAt(l, w.id) : null;
    if (t !== null && (at === null || t < at)) at = t;
  }
  return at;
}

export function learnerVisitors(l: Learner, now = new Date()): LearnerVisitors {
  // A known word has a memory, so it is studied: O(studied), not O(deck), in the same order.
  const { count, lemmas, croaks } = knownWords(l.studied, l.memory);
  const times = l.reviews.map((r) => reviewedAt(r));
  const facts = learnerFacts(times, count, now, gardenBrought(l));
  const today = visitorsFor(facts, now, devVisitorOverride());
  const before = knownAt(l, startOfDay(now)).size;
  return {
    facts,
    today,
    views: visitorViews(today.present, l.lang, (noun) => lemmas.has(noun.toLowerCase())),
    welcome: welcomeBack(facts, now),
    milestone: milestoneLine(before, count),
    known: croaks,
    mole: moleVisits(now, devVisitorOverride()),
    scenery: sceneryViews(l.lang, (lemma) => lemmas.has(lemma.toLowerCase())),
  };
}

/**
 * Leave it out (#351) for this learner today: the synced value, walked today
 * (so what came waits as it is until it is found), the day each row's visitor
 * came, and the basket: the crumbs and the fruits they know, in the orchard's order.
 * `walkedNow`: the value had to be marked as walked today, and must be saved.
 * `dayNow`: today's calendar day whenever it is asked (core/day.ts).
 */
export function learnerLeave(l: Learner, now: number, dayNow: () => number): { walk: LeaveWalk; walkedNow: boolean } {
  const today = dayNumber(now);
  const stored = l.course.garden_left;
  const seen = walked(stored, today);
  const fruits: Fruit[] = [];
  for (const w of l.words.values()) {
    const kind = w.orchard;
    if (kind && kind !== "tree" && wordState(readMemory(l, w.id)) === "known") fruits.push({ id: w.id, lemma: w.lemma, gloss: w.gloss, kind });
  }
  fruits.sort((a, b) => FRUIT_KINDS.indexOf(a.kind) - FRUIT_KINDS.indexOf(b.kind));
  const fruitOf = (id: string): FruitKind | null => {
    const kind = l.words.get(id)?.orchard;
    return kind && kind !== "tree" ? kind : null;
  };
  return { walk: { left: seen ?? stored, today, dayNow, facts: leaveFacts(l), basket: basket(fruits), fruitOf }, walkedNow: seen !== null };
}

/** What the bowl's rows need from the learner's reviews: the calendar day each row's visitor came. */
function leaveFacts(l: Learner): LeaveFacts {
  const brought: LeaveFacts["brought"] = {};
  for (const r of ROWS) {
    const at = r.needs ? gardenBroughtAt(l, r.needs) : null;
    if (r.needs && at !== null) brought[r.needs] = dayNumber(at);
  }
  return { brought };
}

/**
 * The guest who came for what was left in the bowl, while what it left waits
 * to be found, as of `now`; or null (#335: Today's strip shows its prints).
 */
export function waitingGuest(l: Learner, now: number): Guest | null {
  const b = bowlNow(l.course.garden_left, dayNumber(now), leaveFacts(l));
  return b.kind === "came" ? b.outcome.row.guest : null;
}

/**
 * The word on the paper boat (#360): the word practised last, if that was
 * today; else the newest word (the one whose first answer came last). Null
 * with no answers yet.
 */
export function boatWord(l: Pick<Learner, "reviewsByWord" | "words">, now: number): BoatWord | null {
  // Reviews come listed under their word: one look-up per word, not two per review (#479).
  let last: { id: string; t: number } | null = null;
  let newest: { id: string; t: number } | null = null;
  for (const [id, list] of l.reviewsByWord) {
    if (!l.words.has(id)) continue;
    let first = Infinity;
    for (const r of list) {
      const t = reviewedAt(r);
      if (!last || t > last.t) last = { id, t };
      first = Math.min(first, t);
    }
    if (!newest || first > newest.t) newest = { id, t: first };
  }
  if (!last) return null;
  // Both are set together: a word with reviews sets each.
  const w = l.words.get(dayNumber(last.t) === dayNumber(now) ? last.id : newest!.id)!;
  return { lemma: w.lemma, gloss: w.gloss };
}

/** Leave it out on the landing page: nothing left, the crumbs in the basket, and nothing saved. */
export function showcaseLeave(now: number, dayNow: () => number): LeaveWalk {
  return { left: NO_LEFT, today: dayNumber(now), dayNow, facts: { brought: {} }, basket: basket([]), fruitOf: () => null };
}

/** Visitors for a garden with no learner behind it (the landing page): the snail at the gate, and whoever drops by today. */
export function showcaseVisitors(lang: string, now = new Date()): LearnerVisitors {
  // A garden a few months in: its learner knows the words for the garden-word visitors.
  const facts = { ...NO_FACTS, garden: new Set<GardenWord>(VISITORS.flatMap((v) => (v.garden ? [v.garden] : []))) };
  const today = visitorsFor(facts, now, devVisitorOverride());
  return { facts, today, views: visitorViews(today.present, lang), welcome: null, milestone: null, known: [], mole: moleVisits(now, devVisitorOverride()), scenery: sceneryViews(lang) };
}
