import { DAY_MS } from "../core/fsrs";
import { coverage } from "../content/text";
import { db, scheduler } from "../db/db";
import type { MemoryRow } from "../model";

/**
 * A word counts as known once its reading memory is stable for a week and it
 * has been recalled at least twice ("I knew it" alone is not a test).
 */
export const KNOWN_STABILITY = 7;

export type WordState = "new" | "learning" | "known";

export function wordState(read: MemoryRow | undefined): WordState {
  if (!read || read.reps === 0) return "new";
  return read.s >= KNOWN_STABILITY && read.reps >= 2 ? "known" : "learning";
}

export function recall(m: MemoryRow, now = Date.now()): number {
  return m.reps ? scheduler.retrievability((now - m.lastTs) / DAY_MS, m.s) : 0;
}

export interface CourseStats {
  known: number;
  learning: number;
  coverage: number | null;
  retention30: number | null;
  days: { day: number; reviews: number }[]; // last 30 days
  minutesToday: number;
}

export async function courseStats(courseId: string, lang: string): Promise<CourseStats> {
  const [memory, lexemes, reviews, freq] = await Promise.all([
    db.memory.where("courseId").equals(courseId).toArray(),
    db.lexemes.where("courseId").equals(courseId).toArray(),
    db.reviews.where("courseId").equals(courseId).filter((r) => !r.deleted).toArray(),
    db.freq.get(lang),
  ]);
  const read = new Map(memory.filter((m) => m.skill === "read").map((m) => [m.lexemeId, m]));
  let known = 0;
  let learning = 0;
  const knownForms = new Set<string>();
  for (const l of lexemes) {
    if (l.deleted) continue;
    const st = wordState(read.get(l.id));
    if (st === "known") {
      known++;
      l.forms.forEach((f) => knownForms.add(f));
    } else if (st === "learning") learning++;
  }

  const now = Date.now();
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const recent = reviews.filter((r) => r.ts > now - 30 * DAY_MS);
  // Retention = pass rate on reviews of items that had already been seen on an earlier day.
  const byItem = new Map<string, number[]>();
  for (const r of [...reviews].sort((a, b) => a.ts - b.ts)) {
    const k = `${r.lexemeId}:${r.skill}`;
    const list = byItem.get(k);
    if (list) list.push(r.ts);
    else byItem.set(k, [r.ts]);
  }
  let pass = 0;
  let total = 0;
  for (const r of recent) {
    const prior = byItem.get(`${r.lexemeId}:${r.skill}`)!.filter((t) => t < r.ts);
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
  const minutesToday = reviews.filter((r) => r.ts >= startOfToday).reduce((s, r) => s + r.ms, 0) / 60_000;

  return {
    known,
    learning,
    coverage: freq ? coverage(freq.entries, knownForms) : null,
    retention30: total >= 20 ? pass / total : null,
    days,
    minutesToday,
  };
}
