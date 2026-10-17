// The wishing well in the orchard (#335 S6): drop a pebble in, and a moment
// later the echo answers with a word you met long ago, and the day you met it:
// "12 October: casa." It answers "am I getting anywhere?" with your own old
// words, never a test, never a question. Pure: the word comes from when each
// word was first met, the pick from a seeded hash. Nothing is saved.

import { dayNumber } from "../core/day";
import { hash32 } from "../lib/seed";

/** A word in the garden and when it was first met (its first reading review, ms). */
export interface Met {
  lemma: string;
  at: number;
}

/** How far back (calendar days) the echo reaches, oldest first: a year, a month, a week. */
const REACH_BACK = [365, 30, 7];

/**
 * The word the echo says for the `n`th pebble dropped in this visit, which
 * opened at `now`: one met at least a year, a month or a week ago (the oldest
 * of those the learner's words go back to), a different pick for each drop and
 * each visit. With less than a week of words, the very first word. Null with no
 * words at all.
 */
export function echo(met: readonly Met[], now: number, n: number): Met | null {
  if (!met.length) return null;
  // In the order met, so the pick does not hang on the order the words came in.
  const old = [...met].sort((a, b) => a.at - b.at || a.lemma.localeCompare(b.lemma));
  const ago = (m: Met) => dayNumber(now) - dayNumber(m.at);
  const back = REACH_BACK.find((d) => ago(old[0]) >= d);
  if (back === undefined) return old[0];
  const pool = old.filter((m) => ago(m) >= back);
  return pool[hash32(`well:${now}:${n}`) % pool.length];
}

/** The echo's line before the word: "12 October", with the year when it was another year than `now`'s. */
export function echoDate(at: number, now: number): string {
  const d = new Date(at);
  const year = d.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" as const };
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", ...year });
}
