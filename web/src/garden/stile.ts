// The stile in the back fence (#714, a beat of #639): a few wooden steps up
// one side of the fence and down the other, where the garden ends. Its place
// is known once the learner knows enough words for the first stile note, and
// the stile notes are found there, not on the shed's nails. Brambles shut the
// way until the note that tells of the hill (lookout.ts HILL_NOTE); then they
// are cut back and the stile goes over, up a small hill (#749). Pure: where
// things go, and which notes lie where. The scene draws it (sceneStile.ts).

import type { Note } from "./notes/note";
import { CELL_W, type Layout } from "./world";

/** Near enough to the stile's foot (m) to read the notes there. */
export const STILE_REACH = 1.3;

/** The top board's height (m): a hand above the fence's 0.8. */
export const TOP = 0.86;

/** The steps' width across the fence, as wide as the hedge's door, and how far each side's foot stands out from the fence (m). */
export const STEP = { w: 1.1, out: 0.66 };

/** How far the brambles over the shut stile reach into the garden (m): over its steps, and a little more. */
export const BRAMBLES_IN = STEP.out + 0.1;

/** Where the stile's things stand: its middle on the fence line, its foot inside, and the notes on the ground in front of it, each as [x, z]. */
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
  // The notes just in front of the brambles over the shut stile, and the foot where a walker stands by them.
  return { x, z, foot: [x, z + BRAMBLES_IN + 0.4], note: [x + 0.12, z + BRAMBLES_IN + 0.14] };
}

/** How high the stile lifts you at (x, z) (m): up its steps to the top board, and down the far side. */
export function stepY(s: StileSpot, x: number, z: number): number {
  if (Math.abs(x - s.x) >= STEP.w / 2) return 0;
  return TOP * Math.max(0, 1 - Math.abs(z - s.z) / STEP.out);
}

/**
 * Where each unlocked note is found as the walk opens (`unlocked`: in the
 * order they came, `read`: the ids opened before). A stile note not read yet
 * lies in front of the stile; every other hangs on the shed's nails, a stile
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
