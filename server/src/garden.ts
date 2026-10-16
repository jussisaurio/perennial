// Leave it out (#351): the garden's bowl and shelf, per course. Each device
// sends the whole value; the server merges it with what it has, so it only
// moves forward whatever order writes arrive in, and two devices end up the
// same. Pure: the caller reads and writes the row.

import { LEFT_LIMITS, type GardenLeft, type Issue } from "perennial-contract";

const DAY_MS = 86_400_000;

/**
 * The latest local calendar day anywhere now (web/src/core/day.ts dayNumber):
 * the UTC day, plus one for the zones ahead of UTC (up to 14 hours).
 */
export const latestDay = (now: number): number => Math.floor(now / DAY_MS) + 1;

/** Why a value cannot be right, or null: a day in the future, seen before it was left, or a bowl that does not match the count. */
export function leftProblem(v: GardenLeft, now: number): Issue | null {
  const at = (path: string[], message: string): Issue => ({ path: ["garden_left", ...path], message });
  const b = v.bowl;
  if ((v.n === 0) !== (b === null)) return at(["bowl"], "a bowl comes with every thing left, and only then");
  if (!b) return null;
  if (b.day > latestDay(now)) return at(["bowl", "day"], "a day in the future");
  if (b.seen !== null && (b.seen < b.day || b.seen > latestDay(now))) return at(["bowl", "seen"], "seen before it was left, or in the future");
  return null;
}

/**
 * The stored value with a device's merged in. The newest thing left wins
 * (`n`); for the same one, the first day it was seen and whether it was found
 * only move forward. What is kept only grows, in the order first found. The
 * hooks are the learner's own arrangement: the most rearranged one wins (the
 * stored one on a tie), holding only kept things, each on one hook.
 */
export function mergeLeft(stored: GardenLeft, sent: GardenLeft): GardenLeft {
  const newer = sent.n > stored.n ? sent : stored;
  const a = stored.bowl;
  const b = sent.bowl;
  const bowl =
    sent.n === stored.n && a && b && a.thing === b.thing && a.day === b.day
      ? { ...a, seen: a.seen === null ? b.seen : b.seen === null ? a.seen : Math.min(a.seen, b.seen), found: a.found || b.found }
      : newer.bowl;
  const kept = [...stored.kept, ...sent.kept.filter((k, i) => !stored.kept.includes(k) && sent.kept.indexOf(k) === i)].slice(0, LEFT_LIMITS.kept);
  const { hooks, arranged } = sent.arranged > stored.arranged ? sent : stored;
  const hung = (k: string | null, i: number) => (k !== null && kept.includes(k) && hooks.indexOf(k) === i ? k : null);
  return { n: newer.n, bowl, kept, hooks: [hung(hooks[0], 0), hung(hooks[1], 1), hung(hooks[2], 2)], arranged };
}
