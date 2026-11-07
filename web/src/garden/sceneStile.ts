// The way out of the back fence (#714, #749, #770). A thicket of brambles
// taller than the walker stands behind the whole fence, and rings the hill's
// top. In the fence stands the stile: wooden steps up one side and down the
// other, a top board over the fence, and a handrail down each side. Until the
// note that tells of the hill, brambles have grown through the fence over it,
// into the garden. Once it is unlocked, they are cut back, and a way is cut
// through the thicket along the old path, up the hill to the lookout on its
// top (#722, lookout.ts). The stile notes lie on the ground in front of it, a
// stone on them, until they are read (stile.ts placeNotes). Static meshes,
// built once: the words are never drawn in the world.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng } from "../lib/seed";
import { SUN_AT } from "./bench";
import { CUT, HILL, HILLTOP_R, hillY, PATH_TURN, type Lookout } from "./lookout";
import { rayBox, type Ray } from "./scenery";
import { shadeUp, tiledBox } from "./sceneHedge";
import { still, type BuildCtx } from "./sceneSprites";
import { BRAMBLES_IN, STILE_REACH, STEP, TOP, type StileSpot } from "./stile";
import * as T from "./textures";

/** A note on the ground: the paper's size (m), as on the shed's nails. */
const PAPER = { w: 0.15, h: 0.175 };
/** The old path past the fence: its width, and how far past the hill's top it fades out (m). */
const TRACK = { w: 1.5, past: 0.8 };
/** The flat ground's height (scene.ts buildGround). The hill sits a little below it, so the ground hides its foot; the path a little above the hill. */
const GROUND_Y = -0.06;
const HILL_SINK = 0.02;
const TRACK_LIFT = 0.035;
/** The bramble thicket behind the back fence: from how far out to how far (m), and how high it stands. The walker's eye is at 1.05. */
const THICKET = { near: 0.15, far: 3.2, h: 2.1 };
/** The brambles round the hill's top: out to the hill's foot, where they meet the thicket (m). Low enough on the slope that from the top you see over them. */
const RING = { far: HILL.r + 0.4, h: 1.9 };
/** How high the handrails stand over the steps (m). */
const RAIL_H = 0.8;

/** Toward the day's sun: the same shading at every time of day, as the tint does the rest. */
const SUN = new THREE.Vector3(...SUN_AT.day).normalize();

/** How light a face with normal `n` is drawn, shaded by hand: the garden is lit by tint alone. 1 for flat ground. */
function sunShade(n: THREE.Vector3): number {
  return 1 + 0.7 * (n.dot(SUN) - SUN.y);
}

/** Shade `geo` by its normals (sunShade), times `k`, as vertex colours. */
function shade(geo: THREE.BufferGeometry, k = 1) {
  const normal = geo.getAttribute("normal");
  const colors = new Float32Array(normal.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < normal.count; i++) {
    // A round thing shows its side turned from the sun: kept from going black.
    const s = k * Math.max(0.7, sunShade(n.fromBufferAttribute(normal, i)));
    colors.set([s, s, s], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

export class StileScene {
  /** Each note under the step: its id, its paper, and whether it was opened this walk. */
  private notes: { id: string; mesh: THREE.Mesh; opened: boolean }[] = [];
  private spot: StileSpot;
  private hill: Lookout;
  private readPaper!: THREE.Material;
  /** Has the learner the note that tells of the hill (lookout.ts HILL_NOTE): is the way open? */
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

  /** How far (m) the point (x, z) is to the right of the old path's line, facing out. */
  private side(x: number, z: number): number {
    return (x - this.spot.x) * Math.cos(PATH_TURN) - (z - this.spot.z) * Math.sin(PATH_TURN);
  }

  /** How far (x, z) is out along the old path from the stile (m). */
  private along(x: number, z: number): number {
    return -(x - this.spot.x) * Math.sin(PATH_TURN) - (z - this.spot.z) * Math.cos(PATH_TURN);
  }

  /**
   * A bramble cane from `a` arching over `b` to `c`, with thorns along it, pushed onto `out`.
   * `k`: how light (a cut cane, withered, is darker).
   */
  private cane(out: THREE.BufferGeometry[], a: THREE.Vector3, b: THREE.Vector3, end: THREE.Vector3, r: () => number, k = 1) {
    const curve = new THREE.QuadraticBezierCurve3(a, b, end);
    const tube = new THREE.TubeGeometry(curve, 12, 0.032, 5, false);
    shade(tube, 0.9 * k);
    out.push(tube);
    const len = curve.getLength();
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    for (let t = 0.12; t < 0.97; t += 0.11 / len) {
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      // Out from the cane, square to it, round a different side each time.
      const dir = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).cross(tan).normalize();
      const thorn = new THREE.ConeGeometry(0.028, 0.12, 4);
      thorn.translate(0, 0.06 + 0.025, 0);
      thorn.applyQuaternion(q.setFromUnitVectors(up, dir)).translate(p.x, p.y, p.z);
      // Pale thorn tips, so they show against the dark leaves.
      shade(thorn, 2.4 * k);
      out.push(thorn);
    }
  }

  /**
   * A thicket of brambles behind the whole back fence (#749), taller than the
   * walker and some metres deep, its canes arching up out of it and over the
   * fence. Once the hill's note is unlocked, a way is cut through it along the
   * old path, the cut canes heaped beside it. A solid middle (no gap to see
   * through), its clumps one instanced mesh, its canes one merged mesh.
   */
  private buildThicket(c: BuildCtx) {
    const r = rng(749);
    const [sx, sz] = [this.spot.x, this.spot.z];
    const [x0, x1] = [c.b.minX - 0.6, c.b.maxX + 0.6];
    const tex = T.pixelTexture(T.bramble(), true);
    // The way stops at the hilltop: the ring past it, on the far side, stays whole.
    const cut = (x: number, z: number, wide = 0) => this.open && Math.abs(this.side(x, z)) < CUT + wide && this.along(x, z) < HILL.out;
    // The solid middle: one box, or two either side of the way cut through.
    const [zn, zf] = [sz - THICKET.near - 0.25, sz - THICKET.far + 0.35];
    const mid = sx - Math.sin(PATH_TURN) * ((THICKET.near + THICKET.far) / 2);
    const spans: [number, number][] = this.open ? [[x0, mid - CUT - 0.35], [mid + CUT + 0.35, x1]] : [[x0, x1]];
    const coreMat = c.mat(tex, { vertexColors: true });
    for (const [a, b] of spans) {
      const h = THICKET.h - 0.45;
      const geo = tiledBox(b - a, h, zn - zf, 1);
      shadeUp(geo, 0.3, 0.55);
      geo.translate((a + b) / 2, h / 2, (zn + zf) / 2);
      c.scene.add(still(new THREE.Mesh(geo, coreMat)));
    }
    // Clumps of leaves: stacked up the face toward the garden, and over the top further back. [x, y, z, rx, ry, rz, light]
    const clumps: number[][] = [];
    for (let x = x0; x < x1; x += 0.42) {
      const top = THICKET.h * (0.85 + 0.3 * r());
      for (const [k, back] of [[0, THICKET.near + 0.5], [1, 1.2], [2, 1.9], [3, 2.7]]) {
        const cx = x + (r() - 0.5) * 0.3;
        const cz = sz - back + (r() - 0.5) * 0.3;
        // Clear of the way by more than a clump's reach: walking into its side, your eye stays out of them.
        if (cut(cx, cz, 0.5)) continue;
        const ys = k === 0 ? [0.4, 0.95, 1.5, top - 0.3] : [top - 0.35 - r() * 0.3];
        for (const y of ys) {
          const rad = 0.38 + r() * 0.2;
          clumps.push([cx + (r() - 0.5) * 0.15, y, cz, rad * 1.15, rad * 0.85, rad, 0.55 + (0.45 * y) / THICKET.h]);
        }
      }
    }
    // Round the hilltop's grass, out to the hill's foot, standing on its slope: a face of clumps at the grass's edge, and tops further out.
    const [tx, tz] = this.hill.top;
    for (let rr = HILLTOP_R + 0.45; rr < RING.far; rr += 0.6) {
      const inner = rr < HILLTOP_R + 0.5;
      for (let a = 0; a < Math.PI * 2; a += 0.42 / rr) {
        const cx = tx + Math.sin(a) * rr + (r() - 0.5) * 0.15;
        const cz = tz + Math.cos(a) * rr + (r() - 0.5) * 0.15;
        // The thicket behind the fence covers the ground nearer the fence; none in the garden.
        if (cz > sz - THICKET.far + 0.4 || cut(cx, cz, 0.5)) continue;
        const ground = hillY(this.hill, cx, cz);
        const top = RING.h * (0.85 + 0.25 * r());
        for (const y of inner ? [0.35, 0.85, top - 0.3] : [top - 0.35 - r() * 0.3]) {
          // The face, smaller: it reaches in no further than the edge you stop at, so your eye stays out of it.
          const rad = inner ? 0.3 + r() * 0.1 : 0.38 + r() * 0.2;
          clumps.push([cx, ground + y, cz, rad * 1.15, rad * 0.85, rad, 0.55 + (0.45 * y) / RING.h]);
        }
      }
    }
    // Before the hill's note, brambles grown through the fence over the stile's steps, into the garden: what shuts the way.
    if (!this.open)
      // Within the solid block (lookout.ts backWay) less a clump's reach: you stop before your eye is in them.
      for (let x = sx - STEP.w / 2 - 0.05; x < sx + STEP.w / 2 + 0.1; x += 0.3)
        for (let d = 0.1; d < BRAMBLES_IN - 0.3; d += 0.3)
          for (const y of [0.3, 0.75, 1.15]) {
            const rad = 0.24 + r() * 0.1;
            clumps.push([x + (r() - 0.5) * 0.1, y + (r() - 0.5) * 0.15, sz + d, rad * 1.1, rad, rad, 0.55 + 0.3 * y]);
          }
    // Where the way is cut, the thicket's cut sides: clumps on them too, a little darker.
    if (this.open)
      for (let d = THICKET.near + 0.3; d < THICKET.far; d += 0.45)
        for (const s of [-1, 1]) {
          const along = sx - Math.sin(PATH_TURN) * d;
          const cx = along + s * (CUT + 0.25) * Math.cos(PATH_TURN);
          const cz = sz - Math.cos(PATH_TURN) * d - s * (CUT + 0.25) * Math.sin(PATH_TURN);
          for (const y of [0.4, 0.95, 1.5]) clumps.push([cx, y + (r() - 0.5) * 0.2, cz, 0.3, 0.4, 0.4, 0.5 + 0.2 * y]);
        }
    const ball = new THREE.IcosahedronGeometry(1, 1);
    shadeUp(ball, 0.7, 1);
    const uv = ball.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.4, uv.getY(i) * 1.2);
    const mesh = new THREE.InstancedMesh(ball, c.mat(tex, { vertexColors: true }), clumps.length);
    const m4 = new THREE.Matrix4();
    const color = new THREE.Color();
    clumps.forEach(([x, y, z, rx, ry, rz, k], i) => {
      mesh.setMatrixAt(i, m4.makeScale(rx, ry, rz).setPosition(x, y, z));
      mesh.setColorAt(i, color.setScalar(k));
    });
    c.scene.add(still(mesh));

    // Canes: some arch up out of the top; others reach over the fence toward the garden, at the eye's height.
    const canes: THREE.BufferGeometry[] = [];
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    // Over the shut stile, canes arch out of the brambles across its steps, so they read as thorns.
    if (!this.open)
      for (let i = 0; i < 9; i++) {
        const x = sx + (r() - 0.5) * (STEP.w + 0.5);
        this.cane(canes, V(x, 0.2, sz - 0.3), V(x + (r() - 0.5) * 0.6, 1.4 + r() * 0.4, sz + 0.2), V(x + (r() - 0.5) * 0.8, 0.5 + r() * 0.4, sz + BRAMBLES_IN + 0.05), r);
      }
    for (let x = x0 + 0.2; x < x1; x += 0.4) {
      const j = (r() - 0.5) * 0.3;
      if (!cut(x + j, sz - 0.5, 0.3))
        this.cane(canes, V(x + j, 1.0, sz - 1.4 - r()), V(x + j + (r() - 0.5) * 0.6, THICKET.h + 0.3 + r() * 0.4, sz - 0.3), V(x + j + (r() - 0.5) * 0.8, 0.75 + r() * 0.45, sz + 0.2), r);
      const back = 1.0 + r() * 1.8;
      const s = r() < 0.5 ? 1 : -1;
      const span = 0.6 + r() * 0.6;
      if (r() < 0.8 && !cut(x, sz - back, 0.4))
        this.cane(canes, V(x, THICKET.h - 0.4, sz - back), V(x + s * span, THICKET.h + 1.1 + r() * 0.7, sz - back + 0.3), V(x + s * span * 2, THICKET.h - 0.2, sz - back + 0.6), r);
    }
    // The cut canes, heaped beside the way through, on its right.
    if (this.open)
      for (let i = 0; i < 14; i++) {
        const d = 0.7 + r() * 1.6;
        const l = CUT - 0.35 + r() * 0.3;
        const [cx, cz] = [sx - Math.sin(PATH_TURN) * d + Math.cos(PATH_TURN) * l, sz - Math.cos(PATH_TURN) * d - Math.sin(PATH_TURN) * l];
        const turn = r() * Math.PI;
        const half = 0.5 + r() * 0.3;
        const y = 0.05 + r() * 0.3;
        const [dx, dz] = [Math.cos(turn) * half, Math.sin(turn) * half];
        this.cane(canes, V(cx - dx, y, cz - dz), V(cx, y + 0.08, cz), V(cx + dx, y, cz + dz), r, 0.7);
      }
    c.scene.add(still(new THREE.Mesh(mergeGeometries(canes), c.mat(T.pixelTexture(T.cane(), true), { vertexColors: true }))));
  }

  /** The stile: steps up and down, the top board over the fence, and a handrail down each side. */
  private buildStile(c: BuildCtx) {
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
    // A handrail down each side, what stops you stepping off: a post at each foot and at the top board, and a rail over them.
    for (const sx of [-1, 1]) {
      const x = sx * (STEP.w / 2 + 0.04);
      box(0.06, TOP + RAIL_H, 0.06, x, (TOP + RAIL_H) / 2, 0);
      for (const s of [1, -1]) {
        box(0.06, RAIL_H, 0.06, x, RAIL_H / 2, s * STEP.out);
        box(0.05, 0.05, len, x, RAIL_H + TOP / 2, (s * STEP.out) / 2, Math.atan2(s * TOP, STEP.out));
      }
    }
    g.position.set(this.spot.x, 0, this.spot.z);
    c.scene.add(still(g));
  }

  /** The stile, the thicket, and `notes` in front of it (unread ones: read ones hang in the shed). */
  build(c: BuildCtx, notes: readonly string[]) {
    const at = this.spot;
    this.buildStile(c);

    this.buildHill(c);
    this.buildThicket(c);

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

  /** Near enough (and `slack` m more) to the stile's foot, inside the garden, to go over it or read the notes there. Runs every frame: no allocation. */
  inReach(x: number, z: number, slack: number): boolean {
    const [fx, fz] = this.spot.foot;
    return z > this.spot.z && Math.hypot(fx - x, fz - z) < STILE_REACH + slack;
  }
}
