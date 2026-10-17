// "Leave it out" (#351), per course, on the wire: what the learner last left
// in the garden's bowl and on which calendar days, and what they keep on the
// shed shelf. Ids and day numbers only: never the learner's text.

import { Schema } from "effect";

/** A local calendar day as a whole number (web/src/core/day.ts dayNumber). */
const Day = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }));
/** A thing found and kept (a feather, an acorn...): a short id. */
const Kept = Schema.String.check(Schema.isPattern(/^[a-z]{1,24}$/));

/** What a learner can leave in the bowl: the crumbs, or a deck word (a fruit they know). */
export const LeftThing = Schema.String.check(Schema.isPattern(/^(crumbs|[a-z]{2}\.w\.[0-9a-z]{1,40})$/));

export const LEFT_LIMITS = { kept: 32, hooks: 3 } as const;

/**
 * `n` counts the things left so far, and `bowl` is the last one: when it was
 * left (`day`), the first later day the garden was walked (`seen`: the nights
 * away are counted to it), and whether what came for it was found. `kept`:
 * what was found, first find first. `hooks`: what hangs on the shelf's three
 * hooks, and `arranged`: how many times the learner changed them, so the
 * newest arrangement wins. Every change only moves it forward
 * (server/src/garden.ts mergeLeft).
 */
export const GardenLeft = Schema.Struct({
  n: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  bowl: Schema.NullOr(Schema.Struct({ thing: LeftThing, day: Day, seen: Schema.NullOr(Day), found: Schema.Boolean })),
  kept: Schema.Array(Kept).check(Schema.isMaxLength(LEFT_LIMITS.kept)),
  hooks: Schema.Tuple([Schema.NullOr(Kept), Schema.NullOr(Kept), Schema.NullOr(Kept)]),
  arranged: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
});
export type GardenLeft = typeof GardenLeft.Type;

/** Nothing left yet, nothing kept. */
export const NO_LEFT: GardenLeft = { n: 0, bowl: null, kept: [], hooks: [null, null, null], arranged: 0 };

/** A visitor whose word's plant gave a seed for the pot (#387): a short id (web/src/garden/pot.ts PotKind). */
const Seed = Schema.String.check(Schema.isPattern(/^[a-z]{1,24}$/));
const Count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }));

export const POT_LIMITS = { hatched: 100 } as const;

/**
 * Two seeds, one pot (#387), per course, on the wire. `sown` counts every seed
 * put in the clay pot and `out` every creature let out of it, so the pot holds
 * the seeds sown after the last creature's (`seeds`: sown − 2·out of them, 0
 * to 2, first sown first). `day`: the calendar day the second seed went in,
 * null until then; the creature hatches in the night after. `hatched`: the
 * creatures let out, oldest first (only the newest POT_LIMITS.hatched), each
 * the first seed's animal with the second one's trait. Every change moves
 * `sown` or `out` forward, and the newer value wins (server/src/garden.ts mergePot).
 */
export const GardenPot = Schema.Struct({
  sown: Count,
  out: Count,
  seeds: Schema.Array(Seed).check(Schema.isMaxLength(2)),
  day: Schema.NullOr(Day),
  hatched: Schema.Array(Schema.Struct({ base: Seed, trait: Seed })).check(Schema.isMaxLength(POT_LIMITS.hatched)),
});
export type GardenPot = typeof GardenPot.Type;

/** Nothing sown yet, nothing hatched. */
export const NO_POT: GardenPot = { sown: 0, out: 0, seeds: [], day: null, hatched: [] };
