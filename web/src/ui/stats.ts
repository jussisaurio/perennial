import { DAY_MS, startOfDay } from "../core/day";
import { knownAt, readMemory, wordState } from "../core/memory";
import { perLearnerDay, type Learner } from "../data/learner";

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
  // An item is a word and a skill, so each word's reviews are looked at on their own.
  let pass = 0;
  let total = 0;
  const days = Array.from({ length: 30 }, (_, i) => ({ day: startOfToday - (29 - i) * DAY_MS, reviews: 0 }));
  for (const list of l.reviewsByWord.values()) {
    const ts = list.map((r) => Date.parse(r.reviewed_at));
    list.forEach((r, i) => {
      if (ts[i] <= now - 30 * DAY_MS) return;
      const idx = 29 - Math.floor((startOfToday + DAY_MS - 1 - ts[i]) / DAY_MS);
      if (idx >= 0 && idx < 30) days[idx].reviews++;
      if (r.kind === "known") return;
      // The item's latest review before this one.
      let prior = -Infinity;
      list.forEach((x, j) => {
        if (x.skill === r.skill && ts[j] < ts[i] && ts[j] > prior) prior = ts[j];
      });
      if (prior > -Infinity && ts[i] - prior > 12 * 3_600_000) {
        total++;
        if (r.grade > 1) pass++;
      }
    });
  }
  return { known, knownToday, learning, seeds: l.fresh().length, retention30: total >= 20 ? pass / total : null, days };
}
