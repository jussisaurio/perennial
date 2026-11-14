// The lanterns where paths cross (#361): lit at dusk and night, and each one
// blown out or lit again by hand while they are lit. Which are out lasts the
// visit only: the next walk finds them all lit again. The lookout's lantern on
// its post (#683), on the hill past the stile (#722), is one more, the last:
// the same lantern, blown out and lit the same way (#858). No three.js:
// sceneLanterns.ts draws them.

import { hillY, type Lookout } from "./lookout";
import { lanternSpots, type Layout } from "./world";

export class Lamps {
  /** Where each lantern in the garden stands (world.ts lanternSpots), in a fixed order: the moth's lantern is one of these. */
  readonly spots: [number, number][];
  /** The lookout's lantern, by its index after the garden's, or -1 while there is none. */
  readonly lookout: number;
  /** Where each lantern stands, by index: [x, y, z]. */
  readonly at: [number, number, number][];
  /** Which lanterns are lit when it is dark, by index: the garden's, then the lookout's. */
  readonly on: boolean[];
  /** Dusk or night: the lanterns are lit. */
  dark = false;

  /** Lanterns where paths cross, two by the door, and the lookout's on the hill (`hill`: null while there is no stile). */
  constructor(l: Layout, hill: Lookout | null) {
    this.spots = lanternSpots(l);
    this.at = this.spots.map(([x, z]) => [x, 0, z]);
    this.lookout = hill ? this.at.length : -1;
    if (hill) this.at.push([hill.post[0], hillY(hill, ...hill.post), hill.post[1]]);
    this.on = this.at.map(() => true);
  }

  /** Blow lantern `i` out, or light it again. Only while they are lit, at dusk and night: is it lit again now? */
  toggle(i: number): boolean {
    if (!this.dark) return false;
    this.on[i] = !this.on[i];
    return this.on[i];
  }

  /** Is lantern `i` lit now? */
  lit(i: number): boolean {
    return this.dark && this.on[i];
  }

  /** It is dark, and every lantern in the garden is out. */
  get allOut(): boolean {
    return this.dark && this.on.every((on, i) => i === this.lookout || !on);
  }
}
