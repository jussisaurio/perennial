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
const STILE_REACH = 1.3;

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
 * note too once read. A diary page (#858) is only ever in the diary on the
 * hill. The last note (#882) is only ever on the mat of the mouse door.
 * `stile` is null until the first stile note is unlocked: until then there is
 * no stile. `diary` is null until the first page is unlocked, and `door`
 * until the last note is: until then the mouse door is shut.
 */
export function placeNotes(
  unlocked: readonly Note[],
  read: readonly string[],
): { nails: NotePlace[]; stile: string[] | null; diary: NotePlace[] | null; door: NotePlace | null } {
  const nails: NotePlace[] = [];
  const step: string[] = [];
  const diary: NotePlace[] = [];
  let door: NotePlace | null = null;
  for (const n of unlocked) {
    const unread = !read.includes(n.id);
    if (n.diary) diary.push({ id: n.id, unread });
    else if (n.beat === "door") door = { id: n.id, unread };
    else if (n.beat === "stile" && unread) step.push(n.id);
    else nails.push({ id: n.id, unread });
  }
  return { nails, stile: unlocked.some((n) => n.beat === "stile") ? step : null, diary: diary.length ? diary : null, door };
}

/** A note where it is found, and whether it is new. */
export interface NotePlace {
  id: string;
  unread: boolean;
}

/** How thick a sheet lies (m). */
export const SHEET = 0.004;

/** The notes under the stile's step (placeNotes' `stile`), and which were opened this walk. sceneStile.ts draws them. */
export class StileNotes {
  /** Each note: its id, where its paper lies [x, y, z], and whether it was opened this walk. */
  readonly notes: { id: string; at: [number, number, number]; opened: boolean }[];

  private spot: StileSpot;

  constructor(spot: StileSpot, ids: readonly string[]) {
    this.spot = spot;
    const [nx, nz] = spot.note;
    // Flat on the ground, half under the lowest step; a later one a little askew on top of the first. Each a hair over what it lies on, so they never flicker into each other.
    this.notes = ids.map((id, i) => ({ id, at: [nx - i * 0.06, SHEET * (i + 1), nz + i * 0.03], opened: false }));
  }

  /** Is note `id` one of those under the step? */
  has(id: string): boolean {
    return this.notes.some((n) => n.id === id);
  }

  /** Note `id` was opened: from now on it lies on the paper of a read one. */
  read(id: string) {
    const n = this.notes.find((n) => n.id === id);
    if (!n) throw new Error(`no note "${id}" under the stile's step`);
    n.opened = true;
  }

  /** The first note under the step not opened this walk, for the action button's "read", or null. */
  unopened(): string | null {
    for (const n of this.notes) if (!n.opened) return n.id;
    return null;
  }

  /** Near enough (and `slack` m more) to the stile's foot, inside the garden, to go over it or read the notes there. Runs every frame: no allocation. */
  inReach(x: number, z: number, slack: number): boolean {
    const [fx, fz] = this.spot.foot;
    return z > this.spot.z && Math.hypot(fx - x, fz - z) < STILE_REACH + slack;
  }
}
