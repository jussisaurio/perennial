import { DAY_MS, startOfDay } from "../core/day";
import { readMemory, wordState } from "../core/memory";
import type { Learner } from "../data/learner";

export interface CourseStats {
  known: number;
  learning: number;
  /** Words in the deck not started yet. */
  seeds: number;
  retention30: number | null;
  days: { day: number; reviews: number }[]; // last 30 days
  minutesToday: number;
}

export function courseStats(l: Learner, now = Date.now()): CourseStats {
  let known = 0;
  let learning = 0;
  for (const w of l.words.values()) {
    const st = wordState(readMemory(l, w.id));
    if (st === "known") known++;
    else if (st === "learning") learning++;
  }
  const startOfToday = startOfDay(now);
  const reviews = l.reviews.map((r) => ({ ...r, ts: Date.parse(r.reviewed_at) })).sort((a, b) => a.ts - b.ts);
  const recent = reviews.filter((r) => r.ts > now - 30 * DAY_MS);
  // Retention = pass rate on reviews of items that had already been seen on an earlier day.
  const byItem = new Map<string, number[]>();
  for (const r of reviews) {
    const k = `${l.resolve(r.word_id)}:${r.skill}`;
    const list = byItem.get(k);
    if (list) list.push(r.ts);
    else byItem.set(k, [r.ts]);
  }
  let pass = 0;
  let total = 0;
  for (const r of recent) {
    if (r.kind === "known") continue;
    const prior = byItem.get(`${l.resolve(r.word_id)}:${r.skill}`)!.filter((t) => t < r.ts);
    if (prior.length && r.ts - prior[prior.length - 1] > 12 * 3_600_000) {
      total++;
      if (r.grade > 1) pass++;
    }
  }
  const days = Array.from({ length: 30 }, (_, i) => ({ day: startOfToday - (29 - i) * DAY_MS, reviews: 0 }));
  for (const r of recent) {
    const idx = 29 - Math.floor((startOfToday + DAY_MS - 1 - r.ts) / DAY_MS);
    if (idx >= 0 && idx < 30) days[idx].reviews++;
  }
  const minutesToday = reviews.filter((r) => r.ts >= startOfToday).reduce((s, r) => s + r.duration_ms, 0) / 60_000;
  return { known, learning, seeds: l.fresh().length, retention30: total >= 20 ? pass / total : null, days, minutesToday };
}
