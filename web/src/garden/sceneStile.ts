// The stile in the back fence (#714): wooden steps up one side and down the
// other, a top board over the fence, and a post to hold. Past it, an old path
// goes on up a small hill, to the lookout on its top (#722, lookout.ts). Until
// the note that tells of the hill, a fallen tree lies across it (#749). The
// stile notes lie under its lowest step, a stone on them, until they are read
// (stile.ts placeNotes). Static meshes, in the shed's wood: the words are never
// drawn in the world.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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

/** Toward the day's sun: the same shading at every time of day, as the tint does the rest. */
const SUN = new THREE.Vector3(...SUN_AT.day).normalize();

/** How light a face with normal `n` is drawn, shaded by hand: the garden is lit by tint alone. 1 for flat ground. */
function sunShade(n: THREE.Vector3): number {
  return 1 + 0.7 * (n.dot(SUN) - SUN.y);
}

/** Shade `geo` by its normals (sunShade), as vertex colours. */
function shade(geo: THREE.BufferGeometry) {
  const normal = geo.getAttribute("normal");
  const colors = new Float32Array(normal.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < normal.count; i++) {
    // Unlike the hill, a round thing shows its side turned from the sun: kept from going black.
    const k = Math.max(0.7, sunShade(n.fromBufferAttribute(normal, i)));
    colors.set([k, k, k], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

export class StileScene {
  /** Each note under the step: its id, its paper, and whether it was opened this walk. */
  private notes: { id: string; mesh: THREE.Mesh; opened: boolean }[] = [];
  private spot: StileSpot;
  private hill: Lookout;
  private readPaper!: THREE.Material;
  /** Has the learner the note that tells of the hill (lookout.ts HILL_NOTE): is the fallen tree sawn and cleared? */
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
    const n = new THREE.Vector3();
    const e = 0.05;
    for (let i = 0; i < pos.count; i++) {
      const [x, z] = [pos.getX(i), pos.getZ(i)];
      const y = hillY(this.hill, x, z);
      pos.setY(i, GROUND_Y - HILL_SINK + y);
      // The grass's pixels line up with the flat ground's: one texture every 2 m.
      uv.setXY(i, x / 2, -z / 2);
      n.set(hillY(this.hill, x - e, z) - hillY(this.hill, x + e, z), 2 * e, hillY(this.hill, x, z - e) - hillY(this.hill, x, z + e)).normalize();
      const k = sunShade(n);
      shade.set([k, k, k], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(shade, 3));
    c.scene.add(still(new THREE.Mesh(geo, c.mat(T.pixelTexture(T.grass(), true), { vertexColors: true }))));
  }

  /**
   * A tree fallen across the old path (#749), a few steps past the fence, where
   * the eye on the top board sees it: its roots torn up on the left, its crown
   * on the right. Once the note that tells of the hill is unlocked, someone has
   * sawn it: the root end lies off the path, and the logs are stacked on the
   * right. Merged into one mesh per texture, built once.
   */
  private buildTree(c: BuildCtx) {
    const [sx, sz] = [this.spot.x, this.spot.z];
    // Along the path, and to its right as you face out.
    const [ox, oz] = [-Math.sin(PATH_TURN), -Math.cos(PATH_TURN)];
    const [rx, rz] = [-oz, ox];
    const ground = (d: number, l: number) => GROUND_Y + TRACK_LIFT + hillY(this.hill, sx + ox * d + rx * l, sz + oz * d + rz * l);
    const bark: THREE.BufferGeometry[] = [];
    const ends: THREE.BufferGeometry[] = [];
    const roots: THREE.BufferGeometry[] = [];
    const leaves: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4();
    const turn = new THREE.Matrix4();
    // A piece of trunk `len` long, lying with its middle at (d along the path, l to its right, y above the ground there), turned `yaw` from across the path. `sawn`: a sawn end at each end.
    const log = (r0: number, r1: number, len: number, d: number, l: number, y: number, yaw: number, along: boolean, sawn: [boolean, boolean]) => {
      const geo = new THREE.CylinderGeometry(r1, r0, len, 8, 1, true);
      // The bark's pixels 32 to the metre, round the trunk and along it.
      const uv = geo.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * (r0 + r1), uv.getY(i) * 2 * len);
      // Laid down along y's turn: across the path (x), or along it (z).
      turn.makeRotationFromEuler(along ? new THREE.Euler(Math.PI / 2, PATH_TURN + yaw, 0, "YXZ") : new THREE.Euler(0, PATH_TURN + yaw, -Math.PI / 2, "YXZ"));
      m.makeTranslation(sx + ox * d + rx * l, ground(d, l) + y, sz + oz * d + rz * l).multiply(turn);
      bark.push(geo.applyMatrix4(m));
      for (const [k, end] of [[1, sawn[1]], [-1, sawn[0]]] as const) {
        if (!end) continue;
        const cap = new THREE.CircleGeometry(k > 0 ? r1 : r0, 8).rotateX(-k * (Math.PI / 2)).translate(0, (k * len) / 2, 0);
        ends.push(cap.applyMatrix4(m));
      }
    };
    // The trunk's middle, how far along the path; it lies turned SKEW from straight across, its right end further out.
    // The trunk: its middle MID to the left of the path, D along it, and turned SKEW from straight across, its crown end further out.
    // Its crown lies over the path's right half, so a phone's narrow view sees trunk and leaves both.
    const [D, MID, SKEW, LEN, R0, R1] = [3.2, -0.9, 0.15, 4.6, 0.32, 0.2];
    // `t` metres along the trunk from its middle, toward the crown: [d, l].
    const on = (t: number): [number, number] => [D + Math.sin(SKEW) * t, MID + Math.cos(SKEW) * t];
    // The root end: a disc of torn-up earth, standing on its edge.
    const plate = new THREE.CylinderGeometry(0.85, 0.85, 0.28, 7);
    const [pd, pl] = on(-LEN / 2 - 0.1);
    turn.makeRotationFromEuler(new THREE.Euler(0, PATH_TURN + SKEW, -Math.PI / 2, "YXZ"));
    m.makeTranslation(sx + ox * pd + rx * pl, ground(pd, pl) + 0.6, sz + oz * pd + rz * pl).multiply(turn);
    roots.push(plate.applyMatrix4(m));
    if (!this.open) {
      log(R0, R1, LEN, D, MID, 0.27, SKEW, false, [false, false]);
      // Its crown: clumps of leaves on the last two metres, over the path's right half.
      for (const [t, up, out, r] of [[1.2, 0.5, 0, 0.5], [1.8, 0.75, -0.2, 0.6], [2.5, 0.6, 0.15, 0.6], [2.0, 1.15, 0.3, 0.45], [1.5, 0.95, 0.5, 0.4]]) {
        const [d, l] = on(t);
        leaves.push(new THREE.IcosahedronGeometry(r, 1).translate(sx + ox * (d + out) + rx * l, ground(d, l) + up, sz + oz * (d + out) + rz * l));
      }
    } else {
      // Sawn off just left of the path: the root end stays, its cut end to the path.
      const cut = (-0.85 - MID) / Math.cos(SKEW);
      const [cd, cl] = on((cut - LEN / 2) / 2);
      log(R0, R0 + ((R1 - R0) * (cut + LEN / 2)) / LEN, cut + LEN / 2, cd, cl, 0.27, SKEW, false, [false, true]);
      // The logs stacked on the right of the path, a little further out, their cut ends to it: three, two, one.
      const r = 0.2;
      for (const [row, n] of [[0, 3], [1, 2], [2, 1]])
        for (let i = 0; i < n; i++) log(r, r, 0.7, D + 0.8, 1.0 + r * row + 2 * r * i, r + row * r * 1.73, 0, true, [true, true]);
    }
    const shaded = (geos: THREE.BufferGeometry[], tex: THREE.Texture) => {
      const geo = mergeGeometries(geos);
      shade(geo);
      c.scene.add(still(new THREE.Mesh(geo, c.mat(tex, { vertexColors: true }))));
    };
    shaded(bark, T.pixelTexture(T.bark(), true));
    shaded(roots, T.pixelTexture(T.soil(), true));
    // The sawn ends unshaded: they face the stile, away from the sun, but fresh-cut wood is what should catch the eye.
    if (ends.length) c.scene.add(still(new THREE.Mesh(mergeGeometries(ends), c.mat(T.pixelTexture(T.logEnd())))));
    if (leaves.length) shaded(leaves, T.pixelTexture(T.hedge(), true));
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

    this.buildHill(c);
    this.buildTree(c);

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
