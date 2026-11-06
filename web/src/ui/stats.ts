import { DAY_MS, startOfDay } from "../core/day";
import { knownAt, readMemory, reviewedAt, wordState } from "../core/memory";
import { perLearnerDay, type Learner } from "../data/learner";
import type { ReviewRow } from "../data/rows";

interface CourseStats {
  known: number;
  /** Words known now that were not known when today began. */
  knownToday: number;
  learning: number;
  /** Words in the deck not started yet. */
  seeds: number;
  retention30: number | null;
  days: { day: number; reviews: number }[]; // last 30 days
}

/** The course numbers, once per learner and day: Today and Words share them. */
export const statsToday = perLearnerDay(courseStats);

export function courseStats(l: Learner, now = Date.now()): CourseStats {
  const startOfToday = startOfDay(now);
  // Known when today began.
  const knownThen = knownAt(l, startOfToday);
  let known = 0;
  let knownToday = 0;
  let learning = 0;
  for (const w of l.words.values()) {
    const st = wordState(readMemory(l, w.id));
    if (st === "known") {
      known++;
      if (!knownThen.has(w.id)) knownToday++;
    } else if (st === "learning") learning++;
  }
  // Retention = pass rate on reviews of items that had already been seen on an earlier day.
  let pass = 0;
  let total = 0;
  const days = Array.from({ length: 30 }, (_, i) => ({ day: startOfToday - (29 - i) * DAY_MS, reviews: 0 }));
  for (const list of l.reviewsByWord.values()) {
    const { last, reviews } = timedReviews(list);
    if (last <= now - 30 * DAY_MS) continue;
    for (const { ts, passed } of reviews) {
      if (ts <= now - 30 * DAY_MS) continue;
      const idx = 29 - Math.floor((startOfToday + DAY_MS - 1 - ts) / DAY_MS);
      if (idx >= 0 && idx < 30) days[idx].reviews++;
      if (passed === null) continue;
      total++;
      if (passed) pass++;
    }
  }
  return { known, knownToday, learning, seeds: l.fresh().length, retention30: total >= 20 ? pass / total : null, days };
}

interface TimedReview {
  ts: number;
  /** Whether it passed, for a review that counts toward retention; null for one that does not. */
  passed: boolean | null;
}

const timed = new WeakMap<readonly ReviewRow[], { last: number; reviews: TimedReview[] }>();

/**
 * A word's reviews with their times, and which count toward retention: not
 * "Already know it", and more than 12 hours after the item's latest earlier
 * review (an item is a word and a skill). Worked out once per review list in
 * O(k log k): a word with no new review keeps its list from one learner to the
 * next, so only changed words cost anything (#486).
 */
function timedReviews(list: readonly ReviewRow[]): { last: number; reviews: TimedReview[] } {
  const hit = timed.get(list);
  if (hit) return hit;
  const sorted = list.map((r) => ({ r, ts: reviewedAt(r) })).sort((a, b) => a.ts - b.ts);
  // Per skill: the latest time seen so far, and the latest one before it (for reviews at the same time).
  const seen = new Map<string, { at: number; before: number }>();
  const reviews = sorted.map(({ r, ts }): TimedReview => {
    // `??`: the skill's first review has none before it.
    const s = seen.get(r.skill) ?? { at: -Infinity, before: -Infinity };
    const prior = s.at < ts ? s.at : s.before;
    if (s.at < ts) seen.set(r.skill, { at: ts, before: s.at });
    return { ts, passed: r.kind !== "known" && prior > -Infinity && ts - prior > 12 * 3_600_000 ? r.grade > 1 : null };
  });
  // !: a word is listed only with reviews.
  const value = { last: sorted.at(-1)!.ts, reviews };
  timed.set(list, value);
  return value;
}
