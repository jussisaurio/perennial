// Today's garden visitors for the signed-in learner, from review dates and
// known words. Visitor words are never reviews, stats or Words list entries.

import { deriveMemory, wordState, type Learner } from "../data/learner";
import type { ReviewRow } from "../data/rows";
import {
  fencePickets,
  learnerFacts,
  milestoneLine,
  NO_FACTS,
  snailFraction,
  VISITORS,
  visitorsFor,
  visitorViews,
  welcomeBack,
  type LearnerFacts,
  type TodayVisitors,
  type VisitorId,
  type VisitorOverride,
  type VisitorView,
} from "../garden/visitors";
import { layout as gardenLayout, type GardenPlant } from "../garden/world";

/** Dev builds only: `?visitors=all` or `?visitors=cat,bird` shows those visitors, for screenshots and tests. */
export function devVisitorOverride(): VisitorOverride {
  if (!import.meta.env.DEV) return null;
  const v = new URLSearchParams(location.search).get("visitors");
  if (!v) return null;
  if (v === "all") return "all";
  return v.split(",").filter((id): id is VisitorId => VISITORS.some((d) => d.id === id));
}

export interface LearnerVisitors {
  facts: LearnerFacts;
  today: TodayVisitors;
  views: VisitorView[];
  /** The Today screen line after a break, or null. */
  welcome: string | null;
  /** The Today screen line on the day a known-word milestone is crossed, or null. */
  milestone: string | null;
  /** The words the learner knows (lemmas), for the frog to croak. */
  known: string[];
}

/** How many of `words` were known just before `t` (ms): the reading reviews before `t`, replayed. */
export function knownAt(reviews: readonly ReviewRow[], t: number, retention: number, resolve: (id: string) => string, words: { has: (id: string) => boolean }): number {
  const before = reviews.filter((r) => r.skill === "read" && Date.parse(r.reviewed_at) < t);
  let n = 0;
  for (const m of deriveMemory(before, retention, resolve)) if (m.skill === "read" && words.has(m.lexemeId) && wordState(m) === "known") n++;
  return n;
}

export function learnerVisitors(l: Learner, now = new Date()): LearnerVisitors {
  const known: string[] = [];
  const lemmas = new Set<string>();
  for (const w of l.words.values())
    if (wordState(l.memory.get(`${w.id}:read`)) === "known") {
      known.push(w.lemma);
      lemmas.add(w.lemma.toLowerCase());
    }
  const times = l.reviews.map((r) => Date.parse(r.reviewed_at));
  const facts = learnerFacts(times, known.length, now);
  const today = visitorsFor(facts, now, devVisitorOverride());
  // Known at the start of today. Only worth a replay when there are reviews today.
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const before = times.some((t) => t >= dayStart) ? knownAt(l.reviews, dayStart, l.course.retention, l.resolve, l.words) : known.length;
  return {
    facts,
    today,
    views: visitorViews(today.present, l.lang, (noun) => lemmas.has(noun.toLowerCase())),
    welcome: welcomeBack(facts, now),
    milestone: milestoneLine(before, known.length),
    known,
  };
}

/** Visitors for a garden with no learner behind it (the landing page): the snail at the gate, and whoever drops by today. */
export function showcaseVisitors(lang: string, now = new Date()): LearnerVisitors {
  const today = visitorsFor(NO_FACTS, now, devVisitorOverride());
  return { facts: NO_FACTS, today, views: visitorViews(today.present, lang), welcome: null, milestone: null, known: [] };
}

/** Where the snail is along the whole fence of this garden (0 at the gate), for the 2D strip. */
export function snailAlong(plants: GardenPlant[], snailDay: number | null): number {
  return snailDay === null ? 0 : snailFraction(snailDay, fencePickets(gardenLayout(plants)));
}
