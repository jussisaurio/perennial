// The stile in the back fence (#714): wooden steps up one side and down the
// other, a top board over the fence, and a post to hold. Past it, an old path
// goes on up a small hill, to the lookout on its top (#722, lookout.ts). Until
// the note that tells of the hill, the steps down the far side are broken (#749). The
// stile notes lie under its lowest step, a stone on them, until they are read
// (stile.ts placeNotes). Static meshes, in the shed's wood: the words are never
// drawn in the world.

import * as THREE from "three";
import { SUN_AT } from "./bench";
import { HILL, hillY, PATH_TURN, type Lookout } from "./lookout";
import { rayBox, type Ray } from "./scenery";
import { still, type BuildCtx } from "./sceneSprites";
import { CLIMB_REACH, STEP, TOP, type StileSpot } from "./stile";
import * as T from "./textures";

/** A note on the ground: the paper's size (m), as on the shed's nails. */
const PAPER = { w: 0.15, h: 0.175 };
/** The old path past the fence: its width, and how far past the hill's top it fades out (m). */
const TRACK = { w: 1.5, past: 0.8 };
/** The flat ground's height (scene.ts buildGround). The hill sits a little below it, so the ground hides its foot; the path a little above the hill. */
const GROUND_Y = -0.06;
const HILL_SINK = 0.02;
const TRACK_LIFT = 0.035;

export class StileScene {
  /** Each note under the step: its id, its paper, and whether it was opened this walk. */
  private notes: { id: string; mesh: THREE.Mesh; opened: boolean }[] = [];
  private spot: StileSpot;
  private hill: Lookout;
  private readPaper!: THREE.Material;
  /** Has the learner the note that tells of the hill (lookout.ts HILL_NOTE): are the far steps whole? */
  private open: boolean;

  constructor(spot: StileSpot, hill: Lookout, open: boolean) {
    this.spot = spot;
    this.hill = hill;
    this.open = open;
  }

  /**
   * The hill past the fence: a grass mound, its foot under the flat ground.
   * The garden is lit by tint alone, so its slopes are shaded by hand, a little
   * lighter toward the sun's side and darker away, or it would not read as a hill.
   */
  private buildHill(c: BuildCtx) {
    const [tx, tz] = this.hill.top;
    const geo = new THREE.PlaneGeometry(HILL.r * 2, HILL.r * 2, 36, 36);
    geo.rotateX(-Math.PI / 2).translate(tx, 0, tz);
    const pos = geo.getAttribute("position");
    const uv = geo.getAttribute("uv");
    const shade = new Float32Array(pos.count * 3);
    // Toward the day's sun: the same shading at every time of day, as the tint does the rest.
    const light = new THREE.Vector3(...SUN_AT.day).normalize();
    const n = new THREE.Vector3();
    const e = 0.05;
    for (let i = 0; i < pos.count; i++) {
      const [x, z] = [pos.getX(i), pos.getZ(i)];
      const y = hillY(this.hill, x, z);
      pos.setY(i, GROUND_Y - HILL_SINK + y);
      // The grass's pixels line up with the flat ground's: one texture every 2 m.
      uv.setXY(i, x / 2, -z / 2);
      n.set(hillY(this.hill, x - e, z) - hillY(this.hill, x + e, z), 2 * e, hillY(this.hill, x, z - e) - hillY(this.hill, x, z + e)).normalize();
      const k = 1 + 0.7 * (n.dot(light) - light.y);
      shade.set([k, k, k], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(shade, 3));
    c.scene.add(still(new THREE.Mesh(geo, c.mat(T.pixelTexture(T.grass(), true), { vertexColors: true }))));
  }

  /**
   * The far side, broken (#749): a stub of each stringer, one standing up from
   * the ground and one hanging from the top board, and the rest of it and a
   * tread fallen in the grass on the old path, where the eye on the top board
   * sees them. The other tread is gone. `box` takes the stile's own coordinates.
   */
  private buildBroken(box: (w: number, h: number, d: number, x: number, y: number, z: number, tilt?: number, mat?: THREE.Material, turn?: number) => void, len: number) {
    const tilt = Math.atan2(STEP.out, TOP);
    const x = STEP.w / 2 - 0.02;
    // A piece of the stringer `l` long, its middle `f` of the way up from the far foot.
    const stub = (sx: number, l: number, f: number) => box(0.05, l, 0.07, sx * x, TOP * f, -STEP.out * (1 - f), tilt);
    stub(-1, 0.3, 0.15 / len);
    stub(1, 0.22, 1 - 0.11 / len);
    // On the ground past the fence, as the old path lies there.
    const ground = (gx: number, gz: number, h: number) => GROUND_Y + TRACK_LIFT + hillY(this.hill, this.spot.x + gx, this.spot.z + gz) + h / 2;
    box(STEP.w - 0.08, 0.045, 0.2, 0.05, ground(0.05, -1.8, 0.045), -1.8, 0.06, undefined, 0.55);
    box(0.05, len - 0.3, 0.07, 0.35, ground(0.35, -1.5, 0.07), -1.5, Math.PI / 2, undefined, 1.25);
  }

  /** The stile, and `notes` under its step (unread ones: read ones hang in the shed). Draws no random numbers. */
  build(c: BuildCtx, notes: readonly string[]) {
    const at = this.spot;
    const wood = c.mat(c.woodTex);
    const g = new THREE.Group();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, tilt = 0, mat: THREE.Material = wood, turn = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.set(tilt, turn, 0, "YXZ");
      g.add(m);
    };
    // Each side: two stringers from the ground up to the top board, and two treads between them. `s` is +1 inside the garden, −1 past the fence.
    const len = Math.hypot(STEP.out, TOP);
    const side = (s: number, mat: THREE.Material) => {
      const tilt = Math.atan2(-s * STEP.out, TOP);
      for (const sx of [-1, 1]) box(0.05, len, 0.07, sx * (STEP.w / 2 - 0.02), TOP / 2, (s * STEP.out) / 2, tilt, mat);
      for (const k of [1 / 3, 2 / 3]) box(STEP.w - 0.08, 0.045, 0.2, 0, TOP * k, s * STEP.out * (1 - k), 0, mat);
    };
    side(1, wood);
    // Past the fence (#749): mended in new wood once the note that tells of the hill is unlocked; until then broken, so from the top board there is plainly no way down.
    if (this.open) side(-1, c.mat(T.pixelTexture(T.freshWood(), true)));
    else this.buildBroken(box, len);
    box(STEP.w, 0.05, 0.3, 0, TOP, 0);
    // The post to hold as you go over, on the right as you climb out, a little taller than the eye on the top board.
    box(0.07, 1.45, 0.07, STEP.w / 2 + 0.05, 0.725, 0);
    g.position.set(at.x, 0, at.z);
    c.scene.add(still(g));

    this.buildHill(c);

    // The old path past the fence, from the far foot up over the hill's top.
    const run = HILL.out + TRACK.past - STEP.out + 0.2;
    const mid = STEP.out + run / 2 - 0.2;
    const track = new THREE.PlaneGeometry(TRACK.w, run, 1, 48);
    // Laid flat, then turned: its top (the texture's far end) points out, away from the fence. Then each row on the hill's ground.
    track.rotateX(-Math.PI / 2).rotateY(PATH_TURN).translate(at.x - Math.sin(PATH_TURN) * mid, 0, at.z - Math.cos(PATH_TURN) * mid);
    const pos = track.getAttribute("position");
    // Off the hill, between the grass (-0.06) and the yard's path (0.01): some GPUs have a 16-bit depth buffer.
    for (let i = 0; i < pos.count; i++) pos.setY(i, GROUND_Y + TRACK_LIFT + hillY(this.hill, pos.getX(i), pos.getZ(i)));
    c.scene.add(still(new THREE.Mesh(track, c.mat(T.pixelTexture(T.track()), { alphaTest: 0.5 }))));

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
