// Today's garden visitors for the signed-in learner, from review dates and
// known words. Visitor words are never reviews, stats or Words list entries.

import { deriveMemory, wordState, type Learner, type Word } from "../data/learner";
import type { ReviewRow } from "../data/rows";
import type { MemoryRow } from "../model";
import {
  learnerFacts,
  milestoneLine,
  moleVisits,
  NO_FACTS,
  snailLap,
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

/** Dev builds only: `?visitors=all` or `?visitors=cat,bird` shows those visitors, for screenshots and tests. */
export function devVisitorOverride(): VisitorOverride {
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
  for (const m of deriveMemory(before, retention, resolve)) if (m.skill === "read" && words.has(m.lexemeId) && wordState(m) === "known") n++;
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
    if (wordState(memory.get(`${w.id}:read`)) === "known") {
      all.push(w.lemma);
      if (w.pos === "noun") nouns.push(w.lemma);
      lemmas.add(w.lemma.toLowerCase());
    }
  // The frog croaks things: "croac… casa" is a joke, "croac… no" is not. Only its pool is nouns; the count is every known word.
  return { count: all.length, lemmas, croaks: nouns.length >= 5 ? nouns : all };
}

export function learnerVisitors(l: Learner, now = new Date()): LearnerVisitors {
  const { count, lemmas, croaks } = knownWords(l.words.values(), l.memory);
  const times = l.reviews.map((r) => Date.parse(r.reviewed_at));
  const facts = learnerFacts(times, count, now);
  const today = visitorsFor(facts, now, devVisitorOverride());
  // Known at the start of today. Only worth a replay when there are reviews today.
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
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
  const today = visitorsFor(NO_FACTS, now, devVisitorOverride());
  return { facts: NO_FACTS, today, views: visitorViews(today.present, lang), welcome: null, milestone: null, known: [], mole: moleVisits(now, devVisitorOverride()), scenery: sceneryViews(lang) };
}

/** Where the snail is along the whole fence of this garden (0 at the gate), for the 2D strip. */
export function snailAlong(): number {
  return snailLap();
}
