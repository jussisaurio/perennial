// The gardener's notes (#654): scraps of paper on nails inside the shed, one
// for each note the learner has unlocked. A tap on one, or the action button
// in front of it, opens it (GardenWalk.tsx shows the text). Static meshes:
// the words themselves are never drawn in the world.

import * as THREE from "three";
import { rayBox, type Ray } from "./scenery";
import type { BuildCtx } from "./sceneSprites";
import { nailSpots, shedAt } from "./shed";
import * as T from "./textures";

/** A note's size on the wall (m): the paper's 12 × 14 pixels. */
const PAPER = { w: 0.15, h: 0.175 };
/** You read a note from in front of the shed: this near its back wall (m), and this far along it from its middle. */
const READ = { near: 2.4, along: 1.0 };
/**
 * Where a walk to a note stops (m from the back wall): near enough to read, and far enough back that a row of
 * notes (6 × 0.24 m apart, with some wall each side) fits across the view, which on a phone held upright takes 2 m.
 */
const STAND = { near: 1.3, far: 2.2, rowHalf: 0.8 };
/** Facing the wall within this angle's cosine (about 55°). */
const FACING = Math.cos(0.95);
/** The note the action button opens: this far off the wall (m), and this much bigger. */
const LIFT = { out: 0.04, scale: 1.08 };

/** How crooked the `i`th note hangs (radians, about the nail): a few degrees, by its place on the wall. */
const crooked = (i: number) => (((i * 7) % 5) - 2) * 0.05;

export class ShedNotes {
  /** Each note's id, the middle of its paper and its paper, in the order they hang. */
  private notes: { id: string; at: [number, number, number]; mesh: THREE.Mesh }[] = [];
  private wall = { x: 0, z: 0 };
  private readPaper: THREE.Material | null = null;

  /**
   * A paper on a nail for each of `notes`, in that order. Each hangs a little crooked, the same way every visit.
   * One not read yet is on fresher paper (#673) until it is opened (`read`).
   */
  build(c: BuildCtx, notes: readonly { id: string; unread: boolean }[]) {
    this.wall = shedAt(c.L);
    if (notes.length === 0) return;
    const paper = (unread: boolean) => c.mat(T.pixelTexture(T.notePaper(unread)), { alphaTest: 0.5 });
    const [read, fresh] = [paper(false), paper(true)];
    this.readPaper = read;
    const geo = new THREE.PlaneGeometry(PAPER.w, PAPER.h);
    // Hung from the nail at the top, so a crooked one turns about it.
    geo.translate(0, -PAPER.h / 2, 0);
    nailSpots(c.L, notes.length).forEach(([x, y, z], i) => {
      const m = new THREE.Mesh(geo, notes[i].unread ? fresh : read);
      m.rotation.set(0, -Math.PI / 2, crooked(i));
      m.position.set(x, y + PAPER.h / 2, z);
      c.scene.add(m);
      this.notes.push({ id: notes[i].id, at: [x, y, z], mesh: m });
    });
  }

  /** Note `id` was opened: from now on it hangs on the paper of a read one. */
  read(id: string) {
    this.spot(id).mesh.material = this.readPaper!;
  }

  /** The note a ray meets first, and how far along it (the host checks nothing stands in front). */
  pick(r: Ray): { id: string; t: number } | null {
    let best: string | null = null;
    let near = Infinity;
    for (const { id, at } of this.notes) {
      const [x, y, z] = at;
      const t = rayBox(r, [x - 0.02, y - PAPER.h / 2, z - PAPER.w / 2], [x + 0.01, y + PAPER.h / 2, z + PAPER.w / 2]);
      if (t < near) [best, near] = [id, t];
    }
    return best === null ? null : { id: best, t: near };
  }

  /** The note you look at from where you stand (eyes `eye` m up), near enough to read (the action button's "read"), or null. */
  reachAt(x: number, z: number, yaw: number, pitch: number, eye: number): string | null {
    if (this.notes.length === 0 || !this.inFront(x, z)) return null;
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

  /** Is (x, z) in front of the shed, near enough to read its notes? */
  inFront(x: number, z: number): boolean {
    const w = this.wall;
    return x <= w.x && w.x - x <= READ.near && Math.abs(z - w.z) <= READ.along;
  }

  /** Where to stand to read note `id`: in front of the shed, level with it, for a view `halfTan` wide (the tangent of half its width's angle). */
  standAt(id: string, halfTan: number): { x: number; z: number } {
    const n = this.spot(id);
    const back = Math.min(STAND.far, Math.max(STAND.near, STAND.rowHalf / halfTan));
    return { x: this.wall.x - back, z: n.at[2] };
  }

  /**
   * Show which note the action button opens (#673): it comes off the wall a little toward you and hangs straight,
   * where the others hang crooked. Not a glint (#689): on a wall of notes a flash reads as "this one is new".
   * Null puts the last one back.
   */
  lift(id: string | null) {
    for (const [i, n] of this.notes.entries()) {
      const up = n.id === id;
      n.mesh.position.x = n.at[0] - (up ? LIFT.out : 0);
      n.mesh.rotation.z = up ? 0 : crooked(i);
      n.mesh.scale.setScalar(up ? LIFT.scale : 1);
    }
  }

  private spot(id: string) {
    const n = this.notes.find((n) => n.id === id);
    if (!n) throw new Error(`no note "${id}" on the nails`);
    return n;
  }
}
