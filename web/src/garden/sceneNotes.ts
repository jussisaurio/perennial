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
const READ = { near: 1.9, along: 1.0 };
/** Facing the wall within this angle's cosine (about 55°). */
const FACING = Math.cos(0.95);

export class ShedNotes {
  /** Each note's id and the middle of its paper, in the order they hang. */
  private notes: { id: string; at: [number, number, number] }[] = [];
  private wall = { x: 0, z: 0 };

  /** A paper on a nail for each of `ids`, in that order. Each hangs a little crooked, the same way every visit. */
  build(c: BuildCtx, ids: readonly string[]) {
    this.wall = shedAt(c.L);
    if (ids.length === 0) return;
    const paper = c.mat(T.pixelTexture(T.notePaper()), { alphaTest: 0.5 });
    const geo = new THREE.PlaneGeometry(PAPER.w, PAPER.h);
    // Hung from the nail at the top, so a crooked one turns about it.
    geo.translate(0, -PAPER.h / 2, 0);
    nailSpots(c.L, ids.length).forEach(([x, y, z], i) => {
      const m = new THREE.Mesh(geo, paper);
      // Facing into the shed (−x), turned a few degrees, by its place on the wall.
      m.rotation.set(0, -Math.PI / 2, (((i * 7) % 5) - 2) * 0.05);
      m.position.set(x, y + PAPER.h / 2, z);
      c.scene.add(m);
      this.notes.push({ id: ids[i], at: [x, y, z] });
    });
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

  /** The note you face from where you stand, near enough to read (the action button's "read"), or null. */
  reachAt(x: number, z: number, yaw: number): string | null {
    if (this.notes.length === 0 || !this.inFront(x, z)) return null;
    const w = this.wall;
    // Forward is (−sin yaw, −cos yaw); the wall faces −x, so facing it is forward along +x.
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (fx < FACING) return null;
    // Where the view meets the wall: the note nearest that point along it.
    const along = z + ((w.x - x) / fx) * fz;
    let best: string | null = null;
    let gap = Infinity;
    for (const n of this.notes) {
      const g = Math.abs(n.at[2] - along);
      if (g < gap) [best, gap] = [n.id, g];
    }
    return best;
  }

  /** Is (x, z) in front of the shed, near enough to read its notes? */
  inFront(x: number, z: number): boolean {
    const w = this.wall;
    return x <= w.x && w.x - x <= READ.near && Math.abs(z - w.z) <= READ.along;
  }

  /** Where to stand to read note `id`: in front of the shed, level with it. */
  standAt(id: string): { x: number; z: number } {
    const n = this.spot(id);
    return { x: this.wall.x - 1.3, z: n.at[2] };
  }

  /** Where the action button's glint shows for note `id`: just in front of its paper. */
  cueAt(id: string): [number, number, number] {
    const [x, y, z] = this.spot(id).at;
    return [x - 0.05, y, z];
  }

  private spot(id: string) {
    const n = this.notes.find((n) => n.id === id);
    if (!n) throw new Error(`no note "${id}" on the nails`);
    return n;
  }
}
