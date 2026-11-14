// The shed and the gardener's notes (#654) on its nails: scraps of paper, one
// for each note the learner has unlocked. Which hang where, and from where
// you read one, is shed.ts; this draws them. The words themselves are never
// drawn in the world (GardenWalk.tsx shows the text).

import * as THREE from "three";
import { rayBox, type Ray } from "./scenery";
import { woodBox, type BuildCtx } from "./sceneSprites";
import { SHED, shedAt, type ShedWall } from "./shed";
import * as T from "./textures";
import type { Layout } from "./world";

/** A note's size on the wall (m): the paper's 12 × 14 pixels. */
const PAPER = { w: 0.15, h: 0.175 };
/** The note the action button opens: this far off the wall (m), and this much bigger. */
const LIFT = { out: 0.04, scale: 1.08 };

/** How crooked the `i`th note hangs (radians, about the nail): a few degrees, by its place on the wall. */
const crooked = (i: number) => (((i * 7) % 5) - 2) * 0.05;

/** The shed's boards, in one group for the scene to add. */
export function buildShed(c: BuildCtx, l: Layout): THREE.Group {
  const root = new THREE.Group();
  const s = shedAt(l);
  const wood = c.mat(c.woodTex, { vertexColors: true });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(woodBox(w, h, d), wood);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  const { h, half, depth } = SHED;
  box(0.06, h, half * 2, s.x, h / 2, s.z);
  for (const sz of [-1, 1]) box(depth, h, 0.05, s.x - depth / 2, h / 2, s.z + sz * half);
  const roof = box(depth + 0.25, 0.05, half * 2 + 0.2, s.x - depth / 2, h + 0.06, s.z);
  roof.rotation.z = -SHED.tilt;
  box(0.4, SHED.step, half * 2, s.x - depth - 0.1, SHED.step / 2, s.z);
  return root;
}

export class ShedNotes {
  private meshes: THREE.Mesh[] = [];
  private readPaper: THREE.Material | null = null;

  private wall: ShedWall;

  constructor(wall: ShedWall) {
    this.wall = wall;
  }

  /**
   * A paper on a nail for each note, in the wall's order. Each hangs a little crooked, the same way every visit.
   * One not read yet is on fresher paper (#673) until it is opened (`read`).
   */
  build(c: BuildCtx) {
    const notes = this.wall.notes;
    if (notes.length === 0) return;
    const paper = (unread: boolean) => c.mat(T.paperTexture(T.notePaper(unread)), { alphaTest: 0.5 });
    const [read, fresh] = [paper(false), paper(true)];
    this.readPaper = read;
    const geo = new THREE.PlaneGeometry(PAPER.w, PAPER.h);
    // Hung from the nail at the top, so a crooked one turns about it.
    geo.translate(0, -PAPER.h / 2, 0);
    notes.forEach(({ at: [x, y, z], unread }, i) => {
      const m = new THREE.Mesh(geo, unread ? fresh : read);
      m.rotation.set(0, -Math.PI / 2, crooked(i));
      m.position.set(x, y + PAPER.h / 2, z);
      c.scene.add(m);
      this.meshes.push(m);
    });
  }

  /** Note `id` was opened: from now on it hangs on the paper of a read one. */
  read(id: string) {
    this.meshes[this.wall.notes.findIndex((n) => n.id === id)].material = this.readPaper!;
  }

  /** The note a ray meets first, and how far along it (the host checks nothing stands in front). */
  pick(r: Ray): { id: string; t: number } | null {
    let best: string | null = null;
    let near = Infinity;
    for (const { id, at } of this.wall.notes) {
      const [x, y, z] = at;
      const t = rayBox(r, [x - 0.02, y - PAPER.h / 2, z - PAPER.w / 2], [x + 0.01, y + PAPER.h / 2, z + PAPER.w / 2]);
      if (t < near) [best, near] = [id, t];
    }
    return best === null ? null : { id: best, t: near };
  }

  /**
   * Show which note the action button opens (#673): it comes off the wall a little toward you and hangs straight,
   * where the others hang crooked. Not a glint (#689): on a wall of notes a flash reads as "this one is new".
   * Null puts the last one back.
   */
  lift(id: string | null) {
    for (const [i, n] of this.wall.notes.entries()) {
      const up = n.id === id;
      const m = this.meshes[i];
      m.position.x = n.at[0] - (up ? LIFT.out : 0);
      m.rotation.z = up ? 0 : crooked(i);
      m.scale.setScalar(up ? LIFT.scale : 1);
    }
  }
}
