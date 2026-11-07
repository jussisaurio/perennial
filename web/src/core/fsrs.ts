// FSRS-6 (Free Spaced Repetition Scheduler), from ts-fsrs's FSRS-6 model.
// https://github.com/open-spaced-repetition/ts-fsrs
//
// Perennial only uses grades 1 (forgot) and 3 (got it) from the UI, plus 4 for
// "I already know this word". Grade 2 is supported for completeness.
// The review log is replayed on every device (replay below), so the
// scheduling state, fuzz included, stays our own pure fold.

import { FSRS6Algorithm, FSRS6_DEFAULT_WEIGHTS, FSRS6_MODEL_BOUNDS } from "ts-fsrs/models/fsrs-6";
import { hash32 } from "../lib/seed";
import { DAY_MS } from "./day";

export type Grade = 1 | 2 | 3 | 4;

export interface Memory {
  s: number; // stability, days: time for R to drop from 1 to 0.9
  d: number; // difficulty, 1..10
}

export class FSRS {
  readonly w: readonly number[];
  private readonly algo: FSRS6Algorithm;

  constructor(w: readonly number[] = FSRS6_DEFAULT_WEIGHTS) {
    if (w.length !== 21) throw new Error(`FSRS-6 needs 21 weights, got ${w.length}`);
    this.w = w;
    // Short-term on: a review on the same day uses FSRS's own same-day formula.
    this.algo = new FSRS6Algorithm([...w], true, FSRS6_MODEL_BOUNDS);
  }

  /** Probability of recall after `t` days at stability `s`. */
  retrievability(t: number, s: number): number {
    return this.algo.forgetting_curve(Math.max(0, t), s);
  }

  /** Whole days (at least 1) until R falls to `retention`. */
  interval(s: number, retention: number): number {
    return this.algo.next_interval(s, retention);
  }

  init(g: Grade): Memory {
    const m = this.algo.next_state(null, 0, g);
    return { s: m.stability, d: m.difficulty };
  }

  /** New memory after a review `t` days (fractional) after the previous one. */
  next(m: Memory, t: number, g: Grade): Memory {
    // ts-fsrs counts elapsed time in days and treats 0 as "same day"; our log
    // has ms timestamps, so anything under a day is a same-day review.
    const n = this.algo.next_state({ stability: m.s, difficulty: m.d }, t < 1 ? 0 : t, g);
    return { s: n.stability, d: n.difficulty };
  }
}

export interface ReviewLike {
  ts: number; // ms epoch
  grade: Grade;
}

export interface Scheduled extends Memory {
  lastTs: number;
  due: number; // ms epoch
  reps: number;
  lapses: number;
}

/**
 * Deterministic so fuzz is identical on every device replaying the log. Keep
 * the `% 100000` form: changing it would move every learner's due dates.
 */
function fuzz01(str: string): number {
  return (hash32(str) % 100000) / 100000;
}

/** Spread reviews out a bit so words learned together don't stay clumped. */
export function fuzz(days: number, seed: string): number {
  if (days < 2.5) return days;
  const pct = days < 7 ? 0.15 : days < 20 ? 0.1 : 0.05;
  return days * (1 + (fuzz01(seed) * 2 - 1) * pct);
}

/**
 * Fold a review log (any order) into a scheduling state. This is the only way
 * scheduling state is produced, so merged logs from several devices always
 * converge to the same result.
 */
export function replay(
  fsrs: FSRS,
  reviews: readonly ReviewLike[],
  retention: number,
  seed: string,
): Scheduled | null {
  if (reviews.length === 0) return null;
  const sorted = [...reviews].sort((a, b) => a.ts - b.ts);
  // !: there is at least one review (above).
  let last = sorted[0]!;
  let m = fsrs.init(last.grade);
  let lapses = last.grade === 1 ? 1 : 0;
  for (const r of sorted.slice(1)) {
    m = fsrs.next(m, (r.ts - last.ts) / DAY_MS, r.grade);
    if (r.grade === 1) lapses++;
    last = r;
  }
  const days = fuzz(fsrs.interval(m.s, retention), `${seed}:${sorted.length}`);
  return { ...m, lastTs: last.ts, due: last.ts + days * DAY_MS, reps: sorted.length, lapses };
}
