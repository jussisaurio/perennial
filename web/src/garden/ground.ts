// The ground that things walk on (#761): one way to find a way on foot for
// anything that walks, the player's taps and every visitor that walks
// (kinds/). Its obstacles are the player's own (world.ts collide and wayTo,
// the orchard's trunks), read as they are now: the beds the garden has grown,
// the hedge, and the doorway once the door is open.

import { collideTrees, type PlacedTree } from "./orchard";
import { collide, WALKER, wayTo, type Layout } from "./world";

/** The ground as it is now. The door and the trees are read when a way is planned: the door opens during a walk. */
export interface Ground {
  layout: Layout;
  doorOpen(): boolean;
  /** The orchard's trees, for their trunks: none while the door is shut. */
  trees(): readonly PlacedTree[];
}

/** The nearest place to (x, z) where a walker may stand. */
export function standAt(g: Ground, x: number, z: number): { x: number; z: number } {
  const p = collide(g.layout, x, z, WALKER, g.doorOpen());
  return collideTrees(g.trees(), p.x, p.z, WALKER);
}

/**
 * The way on foot from (x, z) round whatever is in the way, to `stop` metres
 * from (toX, toZ). Where nothing may stand at (toX, toZ) (past the hedge
 * while the door is shut), it ends as near as a walker may stand, and no
 * nearer. Corners in order, from (x, z): a single one when it is near enough
 * already. (x, z) may be a hair inside a walker's clearance (a visitor's own
 * spot on the pond's stones, or the bench): the first leg steps off it.
 */
export function wayNear(g: Ground, x: number, z: number, toX: number, toZ: number, stop: number): [number, number][] {
  const from = standAt(g, x, z);
  const to = standAt(g, toX, toZ);
  const way = wayTo(g.layout, from.x, from.z, to.x, to.z, g.doorOpen(), g.trees());
  if (from.x !== x || from.z !== z) way.unshift([x, z]);
  return shorten(way, stop - Math.hypot(to.x - toX, to.z - toZ));
}

/** The way with its last `cut` metres taken off its end. */
function shorten(way: [number, number][], cut: number): [number, number][] {
  while (cut > 0 && way.length > 1) {
    const [bx, bz] = way[way.length - 1];
    const [ax, az] = way[way.length - 2];
    const len = Math.hypot(bx - ax, bz - az);
    if (len <= cut) {
      way.pop();
      cut -= len;
      continue;
    }
    const k = (len - cut) / len;
    way[way.length - 1] = [ax + (bx - ax) * k, az + (bz - az) * k];
    break;
  }
  return way;
}
