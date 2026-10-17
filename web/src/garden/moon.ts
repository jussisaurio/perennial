// Tonight's moon (#361): the real phase, from the date, so the walk's moon is
// the one outside the window. Pure, so it is tested with a pinned clock.

/** Days from one new moon to the next (the mean synodic month). */
const SYNODIC_DAYS = 29.530588853;
/** A known new moon: 6 January 2000, 18:14 UTC. */
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
/** The moon is drawn in this many phases, from new (0) through full (MOON_PHASES / 2) and back. */
export const MOON_PHASES = 8;
export const FULL_MOON = MOON_PHASES / 2;

/** The phase to draw at `now` (ms): 0 is a new moon, FULL_MOON a full one; waxing before it, waning after. */
export function moonPhase(now: number): number {
  const age = ((now - NEW_MOON_MS) / 86_400_000 / SYNODIC_DAYS) % 1;
  // The nearest drawn phase; just before a new moon rounds up to the new moon (0) again.
  return Math.round((age < 0 ? age + 1 : age) * MOON_PHASES) % MOON_PHASES;
}
