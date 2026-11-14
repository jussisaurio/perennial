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
import { rng } from "../lib/seed";
import { CUT, HILL, HILLTOP_R, hillMesh, hillY, PATH_TURN, type Lookout } from "./lookout";
import type { Sheet } from "./hedge";
import { rayBox, type Ray } from "./scenery";
import { sheetGeometry } from "./sceneHedge";
import { still, woodBox, type BuildCtx } from "./sceneSprites";
import { BRAMBLE_SHEET, BRAMBLES_IN, SHEET, STEP, TOP, type StileNotes, type StileSpot } from "./stile";
import * as T from "./textures";

/** A note on the ground: the paper's size (m), as on the shed's nails. */
const PAPER = { w: 0.15, h: 0.175 };
/** The old path past the fence: its width, and how far past the hill's top it fades out (m). */
const TRACK = { w: 1.5, past: 0.8 };
/** How far the old path's surface lies over the hill's grass (m): its own triangles cross the grass's. */
const TRACK_LIFT = 0.035;
/** The bramble thicket behind the back fence: from how far out to how far (m), and how high it stands. The walker's eye is at 1.05. */
const THICKET = { near: 0.15, far: 3.2, h: 2.1 };
/** The thicket's rows of flats (#1164), front to back: how far behind the fence each stands (m), and its top as a part of THICKET.h. Each is higher than the one in front, so from the garden it is a bank of leaves rising away. */
const THICKET_ROWS: [number, number][] = [[0.3, 0.52], [0.8, 0.7], [1.4, 0.85], [2.0, 0.95], [2.7, 1.05]];
/** How high the brambles round the hill's top stand over their ground (m). Low enough on the slope that from the top you see over them. */
const RING_H = 1.9;
/**
 * The ring's rows of flats (#1164), from the hilltop's grass out to the hill's foot: how far past the grass's edge
 * (HILLTOP_R) each stands (m), and its top as a part of RING_H. The first is low, so at the edge you see leaves down to the grass.
 */
const RING_ROWS: [number, number][] = [[0.1, 0.45], [0.5, 0.9], [1.2, 0.95], [1.9, 1], [2.7, 1], [3.6, 1]];
/** The way's wings (#1164): flats beside it, each turned to face you as you come up it, as a paper theatre's wings face the seats. How wide each is and how far apart (m), and how far turned from the way's line (radians). */
const WING = { w: 1.1, step: 0.8, turn: 0.7 };
/** The rows of wings on each side, front to back: how far past the way's edge (CUT) each stands (m), its top as a part of THICKET.h, and how light it is (the cut sides are a little darker). */
const WINGS: [number, number, number][] = [[0.05, 0.45, 0.75], [0.35, 0.8, 0.85]];
/** How far past the way's edge (CUT) the thicket's rows and the ring's stop (m): among the wings, so none stands out in front of them. */
const ROWS_CLEAR = 0.45;
/** Over the shut stile, rows of flats across its steps, in the garden (#1164): how far in from the fence each stands (m), and its top as a part of THICKET.h. Low enough that the top board shows among the leaves; the last in front of the steps' feet. */
const STILE_ROWS: [number, number][] = [[0.15, 0.45], [0.45, 0.36], [0.72, 0.24]];
/** How high a row of flats is at its ends, as a part of its top: it ends in a slope of leaves, not a straight cut edge. */
const ROW_END = 0.35;
/** How far a flat's foot goes under the ground (m): on the hill's slope, its straight foot would leave a gap under it. */
const FLAT_SINK = 0.1;
/** How wide a square of the thicket's flats is drawn as one mesh (m): small enough that a view leaves most of them out, few enough to stay a few draw calls. */
const FLAT_SQUARE = 6;
/** How high the handrails stand over the steps (m). */
const RAIL_H = 0.8;

/** A thorn as a cane bears it, before it is turned and moved: point up, its foot on the cane's skin. */
const THORN = new THREE.ConeGeometry(0.028, 0.12, 4).translate(0, 0.06 + 0.025, 0);

/**
 * Every cane of the thicket and its thorns, written straight into one
 * geometry. A geometry per thorn, turned, shaded and merged after, was one
 * task of most of a second at CPU 10× as the walk opened (#885): there are
 * thousands of thorns.
 */
class Canes {
  private position: number[] = [];
  private normal: number[] = [];
  private uv: number[] = [];
  private color: number[] = [];
  private index: number[] = [];
  private v = new THREE.Vector3();

  /** A cane's tube, its colour times `k`. */
  tube(geo: THREE.BufferGeometry, k: number) {
    this.put(geo, k);
  }

  /** A thorn turned by `q`, its foot at `p`, its colour times `k`. */
  thorn(q: THREE.Quaternion, p: THREE.Vector3, k: number) {
    this.put(THORN, k, q, p);
  }

  /** `geo`'s vertices and triangles, its colour times `k`; turned by `q` and moved by `p` when given. */
  private put(geo: THREE.BufferGeometry, k: number, q?: THREE.Quaternion, p?: THREE.Vector3) {
    const pos = geo.getAttribute("position");
    const nor = geo.getAttribute("normal");
    const uv = geo.getAttribute("uv");
    const first = this.position.length / 3;
    const v = this.v;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (q && p) v.applyQuaternion(q).add(p);
      this.position.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, i);
      if (q) v.applyQuaternion(q);
      this.normal.push(v.x, v.y, v.z);
      this.color.push(k, k, k);
      this.uv.push(uv.getX(i), uv.getY(i));
    }
    for (const i of geo.getIndex()!.array) this.index.push(first + i);
  }

  geometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.position, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.normal, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(this.color, 3));
    geo.setIndex(this.index);
    return geo;
  }
}

export class StileScene {
  /** Each note's paper, in stile.ts StileNotes' order. */
  private meshes: THREE.Mesh[] = [];
  private spot: StileSpot;
  private hill: Lookout;
  private readPaper!: THREE.Material;
  /** Has the learner the note that tells of the hill (lookout.ts HILL_NOTE): is the way open? */
  private open: boolean;

  private stileNotes: StileNotes;

  constructor(spot: StileSpot, hill: Lookout, open: boolean, stileNotes: StileNotes) {
    this.spot = spot;
    this.hill = hill;
    this.open = open;
    this.stileNotes = stileNotes;
  }

  /**
   * The hill past the fence: a grass mound, drawn as the ground hillY reads, so
   * what stands on it stands on this grass (#861). Its slopes are lit by the
   * sun by their normals (sceneLight.ts), so it reads as a hill.
   */
  private buildHill(c: BuildCtx) {
    const { position, index } = hillMesh(this.hill);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    // The grass's tufts line up with the flat ground's: one tile every GROUND_TILE metres.
    const uv = new Float32Array((position.length / 3) * 2);
    for (let i = 0; i < uv.length / 2; i++) uv.set([position[i * 3] / T.GROUND_TILE, -position[i * 3 + 2] / T.GROUND_TILE], i * 2);
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    c.scene.add(still(new THREE.Mesh(geo, c.mat(T.paperTexture(T.grass(), true), "handmade"))));
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
   * A bramble cane from `a` arching over `b` to `c`, with thorns along it, added to `out`.
   * `k`: how light (a cut cane, withered, is darker).
   */
  private cane(out: Canes, a: THREE.Vector3, b: THREE.Vector3, end: THREE.Vector3, r: () => number, k = 1) {
    const curve = new THREE.QuadraticBezierCurve3(a, b, end);
    out.tube(new THREE.TubeGeometry(curve, 12, 0.032, 5, false), 0.9 * k);
    const len = curve.getLength();
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    for (let t = 0.12; t < 0.97; t += 0.11 / len) {
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      // Out from the cane, square to it, round a different side each time.
      const dir = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).cross(tan).normalize();
      // Pale thorn tips, so they show against the dark leaves.
      out.thorn(q.setFromUnitVectors(up, dir), p, 2.4 * k);
    }
  }

  /** The point `d` m out along the old path from the stile, and `s` m to the right of its line, facing out: as [x, z]. */
  private onWay(d: number, s: number): [number, number] {
    return [this.spot.x - Math.sin(PATH_TURN) * d + Math.cos(PATH_TURN) * s, this.spot.z - Math.cos(PATH_TURN) * d - Math.sin(PATH_TURN) * s];
  }

  /**
   * A thicket of brambles behind the whole back fence (#749), taller than the
   * walker and some metres deep, its canes arching up out of it and over the
   * fence. Built as a paper theatre's flats (#1164): rows of bramble paper
   * (textures.ts brambleSheet) one behind another, each higher than the one in
   * front, so you see a bank of leaves and never a gap through it. Rows ring
   * the hill's top too, low enough that from it you see over them. Once the
   * hill's note is unlocked, a way is cut through along the old path: its
   * sides are wings, turned to face you as you come up it, and the cut canes
   * lie heaped beside it. The flats are a mesh per square of ground, the canes
   * one merged mesh. A step per stretch of canes: the scene yields between
   * them (#885).
   */
  private *buildThicket(c: BuildCtx, paper: THREE.Texture): Generator<void> {
    const r = rng(749);
    const [sx, sz] = [this.spot.x, this.spot.z];
    const [x0, x1] = [c.b.minX - 0.6, c.b.maxX + 0.6];
    // The way stops at the hilltop: the ring past it, on the far side, stays whole.
    const cut = (x: number, z: number, wide = 0) => this.open && Math.abs(this.side(x, z)) < CUT + wide && this.along(x, z) < HILL.out;
    /** A flat from `a` to `b` facing toward `to`'s side, its top `ta` over the ground at `a` and `tb` at `b`, its foot a little under it, so no gap shows on a slope. */
    const flat = (a: [number, number], b: [number, number], to: [number, number], ta: number, tb: number, light: number): Sheet => {
      // Its corners left to right as seen from the side it faces (sceneHedge.ts sheetGeometry).
      if ((a[1] - b[1]) * to[0] + (b[0] - a[0]) * to[1] < 0) [a, b, ta, tb] = [b, a, tb, ta];
      const [ga, gb] = [hillY(this.hill, ...a), hillY(this.hill, ...b)];
      const corners: [number, number, number][] = [[a[0], ga - FLAT_SINK, a[1]], [b[0], gb - FLAT_SINK, b[1]], [b[0], gb + tb, b[1]], [a[0], ga + ta, a[1]]];
      return { corners, u: r() * BRAMBLE_SHEET.w, light: light * (0.94 + r() * 0.12) };
    };
    /**
     * A row of flats along a line `len` m long (`at(t)`: the point `t` m along it), each about `seg` wide and over the
     * next a little, each end up to `wobble` out of the line; facing `to(x, z)`, their tops near `top` over the ground.
     * `ends`: the row has ends (a whole ring has none), and it slopes down to ROW_END at them.
     */
    const row = (len: number, at: (t: number) => [number, number], seg: number, wobble: number, to: (x: number, z: number) => [number, number], top: number, light: number, ends = true) => {
      const out: Sheet[] = [];
      for (let t = 0; t < len; ) {
        const t1 = Math.min(len, t + seg * (0.8 + r() * 0.4));
        const [a, b] = [at(t), at(t1)];
        // Each end moves off the line square to it: along the line turned a quarter.
        const [nx, nz] = [a[1] - b[1], b[0] - a[0]].map((v) => v / Math.hypot(a[0] - b[0], a[1] - b[1]));
        const w = () => (r() - 0.5) * 2 * wobble;
        const [wa, wb] = [w(), w()];
        const h = top * (0.9 + r() * 0.2);
        const [ta, tb] = [ends && t === 0 ? h * ROW_END : h, ends && t1 === len ? h * ROW_END : h];
        out.push(flat([a[0] + nx * wa, a[1] + nz * wa], [b[0] + nx * wb, b[1] + nz * wb], to((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), ta, tb, light));
        if (t1 === len) break;
        t = t1 - 0.15 * seg;
      }
      return out;
    };
    const sheets: Sheet[] = [];
    // Behind the fence, across the garden: each row's tops over the row in front. Open, each row stops short of the way's wings.
    for (const [back, k] of THICKET_ROWS) {
      // Where this row meets the way's sides: there side(x, z) is ±s.
      const at = (s: number) => sx + (s - back * Math.sin(PATH_TURN)) / Math.cos(PATH_TURN);
      const spans = this.open ? [[x0, at(-CUT - ROWS_CLEAR)], [at(CUT + ROWS_CLEAR), x1]] : [[x0, x1]];
      for (const [a, b] of spans) sheets.push(...row(b - a, (t) => [a + t, sz - back], 1.3, 0.05, () => [0, 1], THICKET.h * k, 0.8 + 0.25 * k));
    }
    // Round the hilltop's grass, facing it: a low row at its edge, so you see leaves down to the grass, then taller ones out to the hill's foot.
    const [tx, tz] = this.hill.top;
    RING_ROWS.forEach(([out, k], i) => {
      const rr = HILLTOP_R + out;
      // Open, the ring goes round from the way's one side to its other: on the ring, side is rr·sin(turn from the way's line).
      const gap = this.open ? Math.asin((i === 0 ? CUT + WINGS[0][0] : CUT + ROWS_CLEAR) / rr) : 0;
      const a0 = PATH_TURN + gap;
      const ring = row((Math.PI * 2 - 2 * gap) * rr, (t) => [tx + Math.sin(a0 + t / rr) * rr, tz + Math.cos(a0 + t / rr) * rr], 1.3, 0.05, (x, z) => [tx - x, tz - z], RING_H * k, 0.8 + 0.25 * k, this.open);
      // The thicket behind the fence covers the ground nearer the fence.
      sheets.push(...ring.filter((s) => (s.corners[0][2] + s.corners[1][2]) / 2 < sz - THICKET.far + 0.4));
    });
    // Where the way is cut: on each side, wings beside it from the fence to the hilltop, a low one in front of a tall one.
    if (this.open)
      for (const s of [-1, 1])
        for (const [out, k, darker] of WINGS) {
          // The last stops at the hilltop's low row of flats.
          const end = HILL.out - Math.sqrt((HILLTOP_R + RING_ROWS[0][0]) ** 2 - (CUT + out) ** 2);
          // The first starts as far up the way as the widest reaches back, so its outer end stays behind the fence.
          for (let d = THICKET.near + Math.cos(WING.turn) * WING.w * 1.15; d < end; d += WING.step * (0.85 + r() * 0.3)) {
            const w = WING.w * (0.85 + r() * 0.3);
            // The inner end beside the way, the outer end out and back toward the fence.
            const a = this.onWay(d, s * (CUT + out));
            const b = this.onWay(d - Math.cos(WING.turn) * w, s * (CUT + out + Math.sin(WING.turn) * w));
            const you = this.onWay(d - 3, 0);
            // A tall one is low near the fence, as the thicket's rows are.
            const top = THICKET.h * k * Math.min(1, 0.6 + 0.3 * d) * (0.9 + r() * 0.2);
            sheets.push(flat(a, b, [you[0] - a[0], you[1] - a[1]], top, top, darker));
          }
        }
    // Before the hill's note, brambles grown through the fence over the stile's steps, into the garden: what shuts the
    // way. Low enough that the top board shows among the leaves; inside the solid block (lookout.ts backWay), so you stop before them.
    if (!this.open)
      for (const [out, k] of STILE_ROWS) {
        const a = sx - STEP.w / 2 - 0.35;
        sheets.push(...row(STEP.w + 0.7, (t) => [a + t, sz + out], 0.6, 0.12, () => [0, 1], THICKET.h * k, 0.9));
      }
    // One mesh per square of ground: three culls a mesh whole, and one for the whole thicket was drawn from anywhere (#960).
    const squares = new Map<string, Sheet[]>();
    for (const s of sheets) {
      const [x, z] = [(s.corners[0][0] + s.corners[1][0]) / 2, (s.corners[0][2] + s.corners[1][2]) / 2];
      const k = `${Math.floor(x / FLAT_SQUARE)}:${Math.floor(z / FLAT_SQUARE)}`;
      const list = squares.get(k);
      if (list) list.push(s);
      else squares.set(k, [s]);
    }
    // Both sides: the ring's flats are seen from behind from the garden, the thicket's from the hilltop.
    const mat = c.mat(paper, "card", { vertexColors: true, alphaTest: 0.5, alphaToCoverage: c.msaa, side: THREE.DoubleSide });
    for (const square of squares.values()) c.scene.add(still(new THREE.Mesh(sheetGeometry(square, BRAMBLE_SHEET), mat)));
    yield;

    // Canes: some arch up out of the top; others reach over the fence toward the garden, at the eye's height.
    const canes = new Canes();
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
      yield;
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
    yield;
    c.scene.add(still(new THREE.Mesh(canes.geometry(), c.mat(T.paperTexture(T.cane(), true), "card", { vertexColors: true }))));
  }

  /** The stile: steps up and down, the top board over the fence, and a handrail down each side. */
  private buildStile(c: BuildCtx) {
    const wood = c.mat(c.woodTex, "kraft");
    const g = new THREE.Group();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, tilt = 0) => {
      const m = new THREE.Mesh(woodBox(w, h, d), wood);
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

  /** The stile, the thicket (`brambles`: textures.ts paintBrambles), and the notes in front of it (unread ones: read ones hang in the shed). In steps, as buildThicket. */
  *build(c: BuildCtx, brambles: THREE.Texture): Generator<void> {
    const at = this.spot;
    this.buildStile(c);

    this.buildHill(c);
    yield;
    yield* this.buildThicket(c, brambles);

    // The old path past the fence, from the far foot up over the hill's top.
    const run = HILL.out + TRACK.past - STEP.out + 0.2;
    const mid = STEP.out + run / 2 - 0.2;
    // Four strips across, so it follows the hill's round top.
    const track = new THREE.PlaneGeometry(TRACK.w, run, 4, 48);
    // Laid flat, then turned: its top (the texture's far end) points out, away from the fence. Then each row on the hill's ground.
    track.rotateX(-Math.PI / 2).rotateY(PATH_TURN).translate(at.x - Math.sin(PATH_TURN) * mid, 0, at.z - Math.cos(PATH_TURN) * mid);
    const pos = track.getAttribute("position");
    for (let i = 0; i < pos.count; i++) pos.setY(i, TRACK_LIFT + hillY(this.hill, pos.getX(i), pos.getZ(i)));
    c.scene.add(still(new THREE.Mesh(track, c.mat(T.paperTexture(T.track()), "sheet", { alphaTest: 0.5 }))));

    const notes = this.stileNotes.notes;
    if (notes.length === 0) return;
    const paper = (unread: boolean) => c.mat(T.paperTexture(T.notePaper(unread)), "sheet", { alphaTest: 0.5 });
    const fresh = paper(true);
    this.readPaper = paper(false);
    const geo = new THREE.PlaneGeometry(PAPER.w, PAPER.h);
    notes.forEach((n, i) => {
      const m = new THREE.Mesh(geo, fresh);
      m.rotation.set(-Math.PI / 2, 0.35 - i * 0.5, 0, "YXZ");
      m.position.set(...n.at);
      c.scene.add(still(m));
      this.meshes.push(m);
    });
    // A flat stone on them, so the wind leaves them where they were put.
    const [nx, nz] = at.note;
    const stone = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.055), c.mat(T.paperTexture(T.stone(), true), "sugar"));
    stone.position.set(nx + 0.02, SHEET * notes.length + 0.035 / 2, nz - 0.05);
    stone.rotation.y = 0.4;
    c.scene.add(still(stone));
  }

  /** Each note as it is now: an opened one lies on the paper of a read one. */
  show() {
    this.stileNotes.notes.forEach((n, i) => {
      if (n.opened) this.meshes[i].material = this.readPaper;
    });
  }

  /** The note a ray meets first, and how far along it. */
  pick(r: Ray): { id: string; t: number } | null {
    let best: string | null = null;
    let near = Infinity;
    for (const { id, at } of this.stileNotes.notes) {
      const [x, y, z] = at;
      const t = rayBox(r, [x - PAPER.h / 2, y - 0.02, z - PAPER.h / 2], [x + PAPER.h / 2, y + 0.02, z + PAPER.h / 2]);
      if (t < near) [best, near] = [id, t];
    }
    return best === null ? null : { id: best, t: near };
  }
}
