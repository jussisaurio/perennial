// Sometimes a visitor comes to watch a session (#210): at most once per chunk,
// in about one chunk in two, one of the visitors the learner has already
// brought (#209) peeks in for a few cards and leaves. Never a reward, never tied
// to an answer. Seeded by the day and the chunk, so it is the same on a replay
// and a test can pin it.

import { hash01 } from "../lib/seed";
import type { VisitorId } from "./visitors";

/** How many cards it stays. */
export const WATCH_CARDS = 4;

export interface SessionVisit {
  id: VisitorId;
  /** The card (1-based, in this chunk) it arrives at, and the one it leaves before. */
  from: number;
  to: number;
}

/**
 * The visit for one chunk, or null. `day` is the calendar day ("2026-10-13"),
 * `chunk` tells this chunk apart from the day's others (how many answers came
 * before it today), `brought` the visitors the learner has, in a fixed order.
 */
export function sessionVisit(day: string, chunk: number, brought: readonly VisitorId[]): SessionVisit | null {
  if (!brought.length) return null;
  const key = `${day}:${chunk}`;
  if (hash01(key, 0x5e55) >= 0.5) return null;
  const id = brought[Math.floor(hash01(key, 0x5e56) * brought.length)];
  // Not on the first cards, while the learner settles in: somewhere from the 3rd to the 7th.
  const from = 3 + Math.floor(hash01(key, 0x5e57) * 5);
  return { id, from, to: from + WATCH_CARDS };
}
