// The mouse door at the foot of the hedge (#364), and the last note (#882)
// on its mat once it opens. Pure: where the mat lies, and when you stand by
// it. sceneJokes.ts draws it.

import type { NotePlace } from "./stile";
import { HEDGE, type Layout } from "./world";

/**
 * The mouse door, from the middle of the big door (along the hedge, just past
 * its frame, where the fence has its gap), and its size (m). Once open (#882):
 * how far it swings out (rad), the size of the last note on its mat, and how
 * near the mat's middle you stand to read it. That reach ends before the big
 * door's middle and the lantern by the gate, so a step aside gives them back
 * the button.
 */
export const MOUSE_DOOR = { dx: -0.9, w: 0.13, h: 0.17, swing: 1.9, paper: { w: 0.1, h: 0.12 }, reach: 0.75 };

export class MouseMat {
  /** The hedge's face, where the door is. */
  readonly z0: number;
  /** The middle of the mat. */
  readonly x: number;
  readonly z: number;
  /** The last note on the mat, and whether it is still unread; null while the door is shut. */
  readonly note: NotePlace | null;

  constructor(l: Layout, note: NotePlace | null) {
    // Our own copy: reading it changes `unread`.
    this.note = note && { ...note };
    this.z0 = l.bounds.maxZ + HEDGE.gap;
    this.x = l.gate.x + MOUSE_DOOR.dx;
    this.z = this.z0 - 0.08;
  }

  /** Is `id` the last note, on the mat? */
  has(id: string): boolean {
    return this.note?.id === id;
  }

  /** The last note, if you stand by the mat (and `slack` m more); null while the door is shut. Runs every frame: no allocation. */
  noteInReach(x: number, z: number, slack: number): string | null {
    if (!this.note) return null;
    return Math.hypot(x - this.x, z - this.z) < MOUSE_DOOR.reach + slack ? this.note.id : null;
  }

  /** Where a walk to the last note stops: in front of the mat, in reach of it. */
  standByNote(): { x: number; z: number } {
    return { x: this.x, z: this.z - MOUSE_DOOR.reach / 2 };
  }

  /** Where the cat sits while the last note waits: on the grass beside the mat, on the side away from the big door, looking at the doorway. */
  besideMouseDoor(): { at: [number, number, number]; looks: { x: number; z: number } } {
    // Along the hedge on the side away from the big door, far enough that its long body never hides the doorway or the paper from the path.
    return { at: [this.x - 0.6, 0, this.z - 0.1], looks: { x: this.x, z: this.z + 0.08 } };
  }

  /** The last note was opened: from now on it lies on the paper of a read one. */
  read() {
    if (!this.note) throw new Error("no note on the mouse door's mat");
    this.note.unread = false;
  }
}
