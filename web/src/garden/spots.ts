// Named places in the walk-in garden that visitors sit at or go round
// (#324). The scene fills one Spots as it builds the static world, before
// the visitors, so a visitor reads where things are from here and never from
// another part's fields, and the build order this needs is plain to see.

import type { TreeVisitorSpot } from "./orchard";

export interface Spots {
  /** The middle of the pond's bench, on the ground. */
  bench: { x: number; z: number };
  /** The lily pads (x, z). */
  pads: readonly [number, number][];
  /** The lanterns (x, z). */
  lanterns: readonly [number, number][];
  /** Where a small bird can sit (x, y, z): the tops of the notice boards and of the fence's rail. */
  perches: readonly [number, number, number][];
  /** Today's spots in the orchard's trees (#315), only when the walk starts with the door open. */
  trees: readonly TreeVisitorSpot[];
}

/** The top of the fence's upper rail (m). */
export const RAIL = 0.53;
