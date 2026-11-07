// The stile in the back fence (#714): wooden steps up one side and down the
// other, a top board over the fence, and a post to hold. Past it, an old path
// goes on into the long grass. The stile notes lie under its lowest step, a
// stone on them, until they are read (stile.ts placeNotes). Static meshes, in
// the shed's wood: the words are never drawn in the world.

import * as THREE from "three";
import { rayBox, type Ray } from "./scenery";
import { still, type BuildCtx } from "./sceneSprites";
import { CLIMB_REACH, TOP, type StileSpot } from "./stile";
import * as T from "./textures";

/** The steps' width across the fence, and how far each side's foot stands out from the fence (m). */
const STEP = { w: 0.72, out: 0.66 };
/** A note on the ground: the paper's size (m), as on the shed's nails. */
const PAPER = { w: 0.15, h: 0.175 };
/** The old path past the fence: its width and length (m), and its turn off straight out (rad). */
const TRACK = { w: 1.5, len: 9, turn: 0.12 };

export class StileScene {
  /** Each note under the step: its id, its paper, and whether it was opened this walk. */
  private notes: { id: string; mesh: THREE.Mesh; opened: boolean }[] = [];
  private spot: StileSpot;
  private readPaper!: THREE.Material;

  constructor(spot: StileSpot) {
    this.spot = spot;
  }

  /** The stile, and `notes` under its step (unread ones: read ones hang in the shed). Draws no random numbers. */
  build(c: BuildCtx, notes: readonly string[]) {
    const at = this.spot;
    const wood = c.mat(c.woodTex);
    const g = new THREE.Group();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, tilt = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
      m.position.set(x, y, z);
      m.rotation.x = tilt;
      g.add(m);
    };
    // Each side: two stringers from the ground up to the top board, and two treads between them. `s` is +1 inside the garden, −1 past the fence.
    const len = Math.hypot(STEP.out, TOP);
    for (const s of [1, -1]) {
      const tilt = Math.atan2(-s * STEP.out, TOP);
      for (const sx of [-1, 1]) box(0.05, len, 0.07, sx * (STEP.w / 2 - 0.02), TOP / 2, (s * STEP.out) / 2, tilt);
      for (const k of [1 / 3, 2 / 3]) box(STEP.w - 0.08, 0.045, 0.2, 0, TOP * k, s * STEP.out * (1 - k));
    }
    box(STEP.w, 0.05, 0.3, 0, TOP, 0);
    // The post to hold as you go over, on the right as you climb out, a little taller than the eye on the top board.
    box(0.07, 1.45, 0.07, STEP.w / 2 + 0.05, 0.725, 0);
    g.position.set(at.x, 0, at.z);
    c.scene.add(still(g));

    // The old path past the fence, from the far foot outward.
    const track = new THREE.Mesh(new THREE.PlaneGeometry(TRACK.w, TRACK.len), c.mat(T.pixelTexture(T.track()), { alphaTest: 0.5 }));
    // Laid flat, then turned: its top (the texture's far end) points out, away from the fence.
    track.rotation.set(-Math.PI / 2, TRACK.turn, 0, "YXZ");
    const mid = STEP.out + TRACK.len / 2 - 0.2;
    // Between the grass (-0.06) and the yard's path (0.01): some GPUs have a 16-bit depth buffer.
    track.position.set(at.x - Math.sin(TRACK.turn) * mid, -0.025, at.z - Math.cos(TRACK.turn) * mid);
    c.scene.add(still(track));

    if (notes.length === 0) return;
    const paper = (unread: boolean) => c.mat(T.pixelTexture(T.notePaper(unread)), { alphaTest: 0.5 });
    const fresh = paper(true);
    this.readPaper = paper(false);
    const geo = new THREE.PlaneGeometry(PAPER.w, PAPER.h);
    const [nx, nz] = at.note;
    notes.forEach((id, i) => {
      const m = new THREE.Mesh(geo, fresh);
      // Flat on the ground, half under the lowest step; a later one a little askew on top of the first.
      m.rotation.set(-Math.PI / 2, 0.35 - i * 0.5, 0, "YXZ");
      m.position.set(nx - i * 0.06, 0.03 + i * 0.004, nz + i * 0.03);
      c.scene.add(still(m));
      this.notes.push({ id, mesh: m, opened: false });
    });
    // A flat stone on them, so the wind leaves them where they were put.
    const stone = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.055), c.mat(T.pixelTexture(T.stone(), true)));
    stone.position.set(nx + 0.02, 0.05, nz - 0.05);
    stone.rotation.y = 0.4;
    c.scene.add(still(stone));
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
    n.mesh.material = this.readPaper;
  }

  /** The first note under the step not opened this walk, for the action button's "read", or null. */
  unopened(): string | null {
    for (const n of this.notes) if (!n.opened) return n.id;
    return null;
  }

  /** The note a ray meets first, and how far along it. */
  pick(r: Ray): { id: string; t: number } | null {
    let best: string | null = null;
    let near = Infinity;
    for (const { id, mesh } of this.notes) {
      const { x, y, z } = mesh.position;
      const t = rayBox(r, [x - PAPER.h / 2, y - 0.02, z - PAPER.h / 2], [x + PAPER.h / 2, y + 0.02, z + PAPER.h / 2]);
      if (t < near) [best, near] = [id, t];
    }
    return best === null ? null : { id: best, t: near };
  }

  /** Near enough to the stile's foot, inside the garden, to climb it or read what lies under its step. Runs every frame: no allocation. */
  inReach(x: number, z: number): boolean {
    const [fx, fz] = this.spot.foot;
    return z > this.spot.z && Math.hypot(fx - x, fz - z) < CLIMB_REACH;
  }
}
