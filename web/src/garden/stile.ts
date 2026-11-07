// The stile in the back fence (#714, a beat of #639): a few wooden steps up
// one side of the fence and down the other, where the garden ends. It stands
// once the learner knows enough words for the first stile note, and the stile
// notes are found under its step, not on the shed's nails. Climb it, and from
// the top board you see an old path go on past the fence into the long grass;
// the walk goes no further. Pure: where things go, and which notes lie where.
// The scene draws it (sceneStile.ts).

import type { Note } from "./notes/note";
import { CELL_W, type Layout } from "./world";

/** Near enough to the stile's foot (m) to climb it or read the note under its step. */
export const CLIMB_REACH = 1.3;

/** The top board's height (m): a hand above the fence's 0.8. */
export const TOP = 0.86;

/** Where the stile's things stand: its middle on the fence line, its foot inside, and the note under its lowest step, each as [x, z]. */
export interface StileSpot {
  x: number;
  /** The back fence's line. Inside the garden is +z from it; the old path goes on toward −z. */
  z: number;
  foot: [number, number];
  note: [number, number];
}

export function stileAt(l: Layout): StileSpot {
  // At the back end of the path left of the first bed's column.
  const x = l.gate.x - CELL_W / 2;
  const z = l.bounds.minZ;
  return { x, z, foot: [x, z + 0.95], note: [x + 0.12, z + 0.66] };
}

/**
 * Where each unlocked note is found as the walk opens (`unlocked`: in the
 * order they came, `read`: the ids opened before). A stile note not read yet
 * lies under the stile's step; every other hangs on the shed's nails, a stile
 * note too once read. `stile` is null until the first stile note is unlocked:
 * until then there is no stile.
 */
export function placeNotes(unlocked: readonly Note[], read: readonly string[]): { nails: { id: string; unread: boolean }[]; stile: string[] | null } {
  const nails: { id: string; unread: boolean }[] = [];
  const step: string[] = [];
  for (const n of unlocked) {
    const unread = !read.includes(n.id);
    if (n.beat === "stile" && unread) step.push(n.id);
    else nails.push({ id: n.id, unread });
  }
  return { nails, stile: unlocked.some((n) => n.beat === "stile") ? step : null };
}
