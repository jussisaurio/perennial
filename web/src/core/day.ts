// Calendar days in the learner's local time, and things that change once a
// day: a line that stays put while you look at it, and rare events that most
// visits never see.

import { hash32 } from "../lib/seed";

export const DAY_MS = 86_400_000;

/**
 * The local calendar day, e.g. "2026-10-11" (unpadded: "2026-1-5"). It seeds
 * daily pools and rare days, so the format must not change.
 */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** Local midnight at the start of the day of `t` (ms). */
export function startOfDay(t: number | Date = Date.now()): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The local calendar day as a whole number, the same all day and safe across clock changes. */
export function dayNumber(t: number | Date): number {
  const d = new Date(t);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** One line from a pool: the same all day for this key, a different one tomorrow. */
export function daily<T>(pool: readonly T[], key: string, now = new Date()): T {
  return pool[hash32(`${today(now)}:${key}`) % pool.length];
}

/** True on roughly one day in `oneIn` for this key (stable for the whole day). */
export function rareDay(oneIn: number, key: string, now = new Date()): boolean {
  return hash32(`rare:${today(now)}:${key}`) % oneIn === 0;
}
