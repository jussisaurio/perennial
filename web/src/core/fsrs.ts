// FSRS-6 (Free Spaced Repetition Scheduler), following py-fsrs / fsrs-rs.
// https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
//
// Perennial only uses grades 1 (forgot) and 3 (got it) from the UI, plus 4 for
// "I already know this word". Grade 2 is supported for completeness.

import { hash32 } from "../lib/seed";
import { DAY_MS } from "./day";

export type Grade = 1 | 2 | 3 | 4;

export const DEFAULT_W: readonly number[] = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];

const S_MIN = 0.001;
const S_MAX = 36500;

export interface Memory {
  s: number; // stability, days: time for R to drop from 1 to 0.9
  d: number; // difficulty, 1..10
}

const clampD = (d: number) => Math.min(10, Math.max(1, d));
const clampS = (s: number) => Math.min(S_MAX, Math.max(S_MIN, s));

export class FSRS {
  readonly w: readonly number[];
  private readonly decay: number;
  private readonly factor: number;

  constructor(w: readonly number[] = DEFAULT_W) {
    if (w.length !== 21) throw new Error(`FSRS-6 needs 21 weights, got ${w.length}`);
    this.w = w;
    this.decay = -w[20];
    this.factor = Math.pow(0.9, 1 / this.decay) - 1;
  }

  /** Probability of recall after `t` days at stability `s`. */
  retrievability(t: number, s: number): number {
    return Math.pow(1 + (this.factor * Math.max(0, t)) / s, this.decay);
  }

  /** Days until R falls to `retention`. Fractional; callers decide rounding. */
  interval(s: number, retention: number): number {
    const i = (s / this.factor) * (Math.pow(retention, 1 / this.decay) - 1);
    return Math.min(S_MAX, Math.max(0, i));
  }

  private initD(g: Grade): number {
    return this.w[4] - Math.exp(this.w[5] * (g - 1)) + 1;
  }

  init(g: Grade): Memory {
    return { s: clampS(this.w[g - 1]), d: clampD(this.initD(g)) };
  }

  private nextD(d: number, g: Grade): number {
    const delta = -this.w[6] * (g - 3);
    const damped = d + (delta * (10 - d)) / 9;
    return clampD(this.w[7] * this.initD(4) + (1 - this.w[7]) * damped);
  }

  /** New memory after a review `t` days (fractional) after the previous one. */
  next(m: Memory, t: number, g: Grade): Memory {
    const w = this.w;
    const d = this.nextD(m.d, g);
    let s: number;
    if (t < 1) {
      // Same-day review: short-term stability formula.
      let inc = Math.exp(w[17] * (g - 3 + w[18])) * Math.pow(m.s, -w[19]);
      if (g >= 3) inc = Math.max(inc, 1);
      s = m.s * inc;
    } else {
      const r = this.retrievability(t, m.s);
      if (g === 1) {
        const longTerm =
          w[11] * Math.pow(m.d, -w[12]) * (Math.pow(m.s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
        s = Math.min(longTerm, m.s / Math.exp(w[17] * w[18]));
      } else {
        const hard = g === 2 ? w[15] : 1;
        const easy = g === 4 ? w[16] : 1;
        s =
          m.s *
          (1 + Math.exp(w[8]) * (11 - m.d) * Math.pow(m.s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hard * easy);
      }
    }
    return { s: clampS(s), d };
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
  let m = fsrs.init(sorted[0].grade);
  let lapses = sorted[0].grade === 1 ? 1 : 0;
  for (let i = 1; i < sorted.length; i++) {
    const t = (sorted[i].ts - sorted[i - 1].ts) / DAY_MS;
    m = fsrs.next(m, t, sorted[i].grade);
    if (sorted[i].grade === 1) lapses++;
  }
  const last = sorted[sorted.length - 1];
  const days = fuzz(fsrs.interval(m.s, retention), `${seed}:${sorted.length}`);
  return { ...m, lastTs: last.ts, due: last.ts + days * DAY_MS, reps: sorted.length, lapses };
}
