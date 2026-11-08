// A learner trace (#928): what one simulated learner (sim/learner.ts) knows,
// day by day. Apart from the simulation, so tools that only read the cached
// traces (sim/traces/) do not load the app's data layer, which loads its decks
// through Vite.

import type { GardenWord } from "../deck/schema";

/**
 * How a learner practises. daily: Today's 5 minutes every day. weekdays: the
 * same, but never on Saturday or Sunday. break: daily, with 14 days off from
 * day 40. more: Today, then one "Practice more" chunk, every day.
 */
export const PATTERNS = ["daily", "weekdays", "break", "more"] as const;
export type Pattern = (typeof PATTERNS)[number];

/** One day the learner practised. A day off changes nothing: wordState does not depend on time. */
export interface TraceDay {
  /** Day 1 is the course's first day. */
  day: number;
  /** Active minutes of practice, to one decimal. */
  minutes: number;
  /** Known words at the end of the day (ui/visitors.ts knownWords, as the notes count them). */
  known: number;
  /** Lower-case lemmas that became known this day. */
  gained?: string[];
  /** Lower-case lemmas that stopped being known this day. */
  lost?: string[];
  /** Garden words whose visitors came this day (ui/visitors.ts broughtAt). */
  brought?: GardenWord[];
}

export interface Trace {
  lang: string;
  pattern: Pattern;
  seed: number;
  /** Day 1, a Monday. */
  start: string;
  /** The course's live words. */
  words: number;
  /** The known count that opens the door: the last note's (garden/notes). */
  door: number;
  /** The day the learner reached the door's count, or null if the run stopped at its day cap first. */
  doorDay: number | null;
  days: TraceDay[];
}

/** The first day the learner of `trace` knows `known` words: the day a note or line gated at that count shows. */
export function dayKnowing(trace: Trace, known: number): number | null {
  // `?? null`: the trace stops at the door, so a count past it is never reached.
  return trace.days.find((d) => d.known >= known)?.day ?? null;
}

/** What the learner of `trace` knows at the end of `day`, and the garden words they have brought: the trace's changes replayed up to it. */
export function onDay(trace: Trace, day: number): { known: number; lemmas: Set<string>; brought: Set<GardenWord> } {
  let known = 0;
  const lemmas = new Set<string>();
  const brought = new Set<GardenWord>();
  for (const d of trace.days) {
    if (d.day > day) break;
    known = d.known;
    // ?? []: a day with no change of that kind leaves its list out (small files).
    for (const w of d.gained ?? []) lemmas.add(w);
    for (const w of d.lost ?? []) lemmas.delete(w);
    for (const g of d.brought ?? []) brought.add(g);
  }
  return { known, lemmas, brought };
}
