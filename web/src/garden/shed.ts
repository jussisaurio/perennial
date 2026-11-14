// The little open shed against the right fence: a back wall, two sides, a
// roof that slopes down to the back, and a step in front; and the gardener's
// notes on its nails (#654): where each hangs, and from where you read one.
// No three.js: sceneNotes.ts draws it.

import type { Layout } from "./world";

/** Its back wall is this tall and this long each way from its middle, its sides this deep, its step this high; its roof slopes down to the back by `tilt` (rad). */
export const SHED = { h: 1.7, half: 0.8, depth: 0.7, step: 0.08, tilt: 0.18 };

/** The middle of the shed's back wall; it faces into the garden (−x). */
export function shedAt(l: Layout): { x: number; z: number } {
  return { x: l.bounds.maxX - 0.3, z: l.bounds.maxZ - 2.4 };
}

/** The middle of the shed's step, on top of it (spots.ts shedStep). */
export function shedStep(l: Layout): [number, number, number] {
  const s = shedAt(l);
  return [s.x - SHED.depth - 0.1, SHED.step, s.z];
}

/** A place on the shed's roof, a little toward its front and its near end (#376: the goat stands there). */
export function shedRoof(l: Layout): [number, number, number] {
  const s = shedAt(l);
  // 10 cm in front of the roof's middle, where it is that much higher, on top of its 5 cm board.
  return [s.x - SHED.depth / 2 - 0.1, SHED.h + 0.06 + 0.025 + 0.1 * Math.sin(SHED.tilt), s.z + 0.3];
}

/** The nails for the gardener's notes (#654): rows of this many on the back wall, this far apart (m), the top row this high, the next ones lower. */
const NAILS = { perRow: 6, apart: 0.24, top: 1.24, drop: 0.3 };

/**
 * Where the `n` notes hang (#654): on the inside of the back wall, in rows
 * from the top, each row filled from the left as you face the wall (−z).
 * Each point is the middle of a note, a hair off the wall.
 */
function nailSpots(l: Layout, n: number): [number, number, number][] {
  const s = shedAt(l);
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / NAILS.perRow);
    const inRow = Math.min(NAILS.perRow, n - row * NAILS.perRow);
    const k = i % NAILS.perRow;
    return [s.x - 0.04, NAILS.top - row * NAILS.drop, s.z + (k - (inRow - 1) / 2) * NAILS.apart];
  });
}

/** You read a note from in front of the shed: this near its back wall (m), and this far along it from its middle. */
const READ = { near: 2.4, along: 1.0 };
/**
 * Where a walk to a note stops (m from the back wall): near enough to read, and far enough back that a row of
 * notes (6 × 0.24 m apart, with some wall each side) fits across the view, which on a phone held upright takes 2 m.
 */
const STAND = { near: 1.3, far: 2.2, rowHalf: 0.8 };
/** Facing the wall within this angle's cosine (about 55°). */
const FACING = Math.cos(0.95);

/** The notes on the shed's nails: which hangs where, which are still unread, and from where you read one. */
export class ShedWall {
  /** Each note's id, the middle of its paper and whether it is still unread (#673), in the order they hang. */
  readonly notes: { readonly id: string; readonly at: [number, number, number]; unread: boolean }[];
  private wall: { x: number; z: number };

  constructor(l: Layout, notes: readonly { id: string; unread: boolean }[]) {
    this.wall = shedAt(l);
    const spots = nailSpots(l, notes.length);
    this.notes = notes.map((n, i) => ({ id: n.id, at: spots[i], unread: n.unread }));
  }

  has(id: string): boolean {
    return this.notes.some((n) => n.id === id);
  }

  /** Note `id` was opened: from now on it hangs on the paper of a read one. */
  read(id: string) {
    this.spot(id).unread = false;
  }

  /** The note you look at from where you stand (eyes `eye` m up), near enough to read (the action button's "read"), or null. */
  reachAt(x: number, z: number, yaw: number, pitch: number, eye: number, slack: number): string | null {
    if (this.notes.length === 0 || !this.inFront(x, z, slack)) return null;
    const w = this.wall;
    // Forward is (−sin yaw, −cos yaw); the wall faces −x, so facing it is forward along +x.
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (fx < FACING) return null;
    // Where the middle of the view meets the wall: the note nearest that point, across and up, so each row can be picked.
    const far = (w.x - x) / fx;
    const along = z + far * fz;
    const up = eye + far * Math.tan(pitch);
    let best: string | null = null;
    let gap = Infinity;
    for (const n of this.notes) {
      const g = Math.hypot(n.at[2] - along, n.at[1] - up);
      if (g < gap) [best, gap] = [n.id, g];
    }
    return best;
  }

  /** Is (x, z) in front of the shed, near enough (and `slack` m more) to read its notes? */
  inFront(x: number, z: number, slack: number): boolean {
    const w = this.wall;
    return x <= w.x && w.x - x <= READ.near + slack && Math.abs(z - w.z) <= READ.along + slack;
  }

  /** Where to stand to read note `id`: in front of the shed, level with it, for a view `halfTan` wide (the tangent of half its width's angle). */
  standAt(id: string, halfTan: number): { x: number; z: number } {
    const back = Math.min(STAND.far, Math.max(STAND.near, STAND.rowHalf / halfTan));
    return { x: this.wall.x - back, z: this.spot(id).at[2] };
  }

  private spot(id: string) {
    const n = this.notes.find((n) => n.id === id);
    if (!n) throw new Error(`no note "${id}" on the nails`);
    return n;
  }
}
