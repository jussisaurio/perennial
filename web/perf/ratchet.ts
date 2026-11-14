// The perf run's ratchet (#985). perf/baseline.json stores, per screen, the median of the
// numbers below on the machine that measured them. A run fails when a number is clearly
// worse than the stored one, and stores the new median when it is clearly better.

/** The numbers held per screen: the two of the bar (docs/performance.md, "The bar") and INP. */
const HELD = ["worst", "overMs", "inp"] as const;
type Held = (typeof HELD)[number];
export type Numbers = Record<Held, number>;
export interface Baseline { machine: string; screens: Record<string, Numbers> }

// On a quiet machine the p90 of 3 runs of Today's cold load was within 5% of the median (#924).
// The margin leaves room for a less quiet one, and the ms for numbers near 0, which move by more
// than their share (an INP under 16 ms reads 0).
const RATIO = 1.25;
const SLACK_MS = 10;
const limit = (stored: number) => Math.round(stored * RATIO + SLACK_MS);

/**
 * Compares a run with the baseline. A number is worse only when even the screen's best run is
 * over the limit: one slow run can be the machine. It is better when the median is so far below
 * that the stored number would be over the new one's limit. `screens` are the scenarios that
 * exist: a screen in the baseline that is not one of them was renamed or removed.
 * `updated` lists what is stored anew: new screens and numbers that got better.
 */
export function ratchet(baseline: Baseline, measured: { screen: string; median: Numbers; best: Numbers }[], screens: readonly string[]): { baseline: Baseline; worse: string[]; updated: string[] } {
  const stored = Object.fromEntries(Object.entries(baseline.screens).filter(([screen]) => screens.includes(screen)));
  const worse: string[] = [];
  const updated: string[] = [];
  for (const { screen, median, best } of measured) {
    const before = stored[screen];
    const now = Object.fromEntries(HELD.map((k) => [k, median[k]])) as Numbers;
    if (!before) {
      stored[screen] = now;
      updated.push(`${screen}: new screen, stored ${HELD.map((k) => `${k} ${now[k]}`).join(", ")}`);
      continue;
    }
    const next = { ...before };
    for (const k of HELD) {
      if (best[k] > limit(before[k])) worse.push(`${screen}: ${k} ${before[k]} → ${median[k]} ms (best run ${best[k]}, limit ${limit(before[k])})`);
      else if (before[k] > limit(median[k])) {
        next[k] = median[k];
        updated.push(`${screen}: ${k} ${before[k]} → ${median[k]} ms`);
      }
    }
    stored[screen] = next;
  }
  return { baseline: { machine: baseline.machine, screens: stored }, worse, updated };
}
