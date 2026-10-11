// Today's garden visitors for the signed-in learner, from review dates and
// known words. Visitor words are never reviews, stats or Words list entries.

import { wordState, type Learner } from "../data/learner";
import { fencePickets, learnerFacts, NO_FACTS, snailFraction, VISITORS, visitorsFor, visitorViews, welcomeBack, type LearnerFacts, type TodayVisitors, type VisitorId, type VisitorOverride, type VisitorView } from "../garden/visitors";
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
}

export function learnerVisitors(l: Learner, now = new Date()): LearnerVisitors {
  let known = 0;
  const lemmas = new Set<string>();
  for (const w of l.words.values())
    if (wordState(l.memory.get(`${w.id}:read`)) === "known") {
      known++;
      lemmas.add(w.lemma.toLowerCase());
    }
  const facts = learnerFacts(
    l.reviews.map((r) => Date.parse(r.reviewed_at)),
    known,
    now,
  );
  const today = visitorsFor(facts, now, devVisitorOverride());
  return { facts, today, views: visitorViews(today.present, l.lang, (noun) => lemmas.has(noun.toLowerCase())), welcome: welcomeBack(facts, now) };
}

/** Visitors for a garden with no learner behind it (the landing page): the snail at the gate, and whoever drops by today. */
export function showcaseVisitors(lang: string, now = new Date()): LearnerVisitors {
  const today = visitorsFor(NO_FACTS, now, devVisitorOverride());
  return { facts: NO_FACTS, today, views: visitorViews(today.present, lang), welcome: null };
}

/** Where the snail is along the whole fence of this garden (0 at the gate), for the 2D strip. */
export function snailAlong(plants: GardenPlant[], snailDay: number | null): number {
  return snailDay === null ? 0 : snailFraction(snailDay, fencePickets(gardenLayout(plants)));
}
