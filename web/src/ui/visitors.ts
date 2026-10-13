// Today's garden visitors for the signed-in learner, from review dates and
// known words. Visitor words are never reviews, stats or Words list entries.

import { deriveMemory, readMemory, wordState, type MemoryRow } from "../core/memory";
import type { Learner, Word } from "../data/learner";
import { startOfDay } from "../core/day";
import type { ReviewRow } from "../data/rows";
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

/** How many of `words` were known just before `t` (ms): the reading reviews before `t`, replayed. */
export function knownAt(reviews: readonly ReviewRow[], t: number, retention: number, resolve: (id: string) => string, words: { has: (id: string) => boolean }): number {
  const before = reviews.filter((r) => r.skill === "read" && Date.parse(r.reviewed_at) < t);
  let n = 0;
  for (const m of deriveMemory(before, retention, resolve)) if (m.skill === "read" && words.has(m.wordId) && wordState(m) === "known") n++;
  return n;
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
  return (l.reviewsByWord.get(wordId) ?? []).some((r) => r.skill === "read" && r.grade >= 3);
}

/** The garden words (#209) whose visitors the learner has brought. */
export function gardenBrought(l: Pick<Learner, "reviewsByWord" | "deck">): Set<GardenWord> {
  const garden = new Set<GardenWord>();
  for (const w of l.deck.words) if (w.garden && broughtVisitor(l, w.id)) garden.add(w.garden);
  return garden;
}

export function learnerVisitors(l: Learner, now = new Date()): LearnerVisitors {
  const { count, lemmas, croaks } = knownWords(l.words.values(), l.memory);
  const times = l.reviews.map((r) => Date.parse(r.reviewed_at));
  const facts = learnerFacts(times, count, now, gardenBrought(l));
  const today = visitorsFor(facts, now, devVisitorOverride());
  // Known at the start of today. Only worth a replay when there are reviews today.
  const dayStart = startOfDay(now);
  const before = times.some((t) => t >= dayStart) ? knownAt(l.reviews, dayStart, l.course.retention, l.resolve, l.words) : count;
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

/** Visitors for a garden with no learner behind it (the landing page): the snail at the gate, and whoever drops by today. */
export function showcaseVisitors(lang: string, now = new Date()): LearnerVisitors {
  // A garden a few months in: its learner knows the words for the garden-word visitors.
  const facts = { ...NO_FACTS, garden: new Set<GardenWord>(VISITORS.flatMap((v) => (v.garden ? [v.garden] : []))) };
  const today = visitorsFor(facts, now, devVisitorOverride());
  return { facts, today, views: visitorViews(today.present, lang), welcome: null, milestone: null, known: [], mole: moleVisits(now, devVisitorOverride()), scenery: sceneryViews(lang) };
}
