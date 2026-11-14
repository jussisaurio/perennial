// The hedge round the old orchard (#315), as plain numbers: where its walls run,
// and the shape of each wall. A solid middle (it hides what is behind it, from
// any angle) under rows of paper leaves (#1164): each row a sheet cut along its
// top, standing a little behind the row below, as in a paper model.
// sceneHedge.ts draws it: the middles as boxes, the sheets as one mesh.

import { rng } from "../lib/seed";
import { DOOR_HALF, HEDGE, hedgeSpan, type Layout } from "./world";

/** An axis-aligned box: [x, y, z] corners. */
export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * A wall of hedge: its outline, which of its long faces you can walk up to (-1: the low x or z side, 1: the high one),
 * and which of its ends stand free, with nothing against them (-1: the low end, 1: the high one). Both get rows of
 * leaves, so a free end is leafy, not a bare box.
 */
export interface HedgeWall extends Box {
  faces: (-1 | 1)[];
  ends: (-1 | 1)[];
}

/**
 * A sheet of paper leaves (#1164): a flat strip cut from the hedge's paper, its leaves along its top edge
 * (textures.ts hedgeSheet). Its four corners, in the order bottom-left, bottom-right, top-right, top-left as seen
 * from the side it faces; where along the paper it starts (m), so rows' leaves do not line up; and how light it is
 * (1: in full light; lower down, darker).
 */
export interface Sheet {
  corners: [number, number, number][];
  u: number;
  light: number;
}

/** A sheet's size (m): one repeat of its paper along it, its height, and the top part of it cut into leaves. textures.ts paints it to these. */
export const SHEET_W = 2;
export const SHEET_H = 0.57;
export const LEAF_H = 0.22;
/** How far up each row starts above the row below (m). Less than a sheet's solid part, so the solid parts overlap and no gap shows between rows. */
const ROW_STEP = 0.29;
/** How far the bottom row stands out past the hedge's outline (m), at most: never into the path or the doorway. A thing set on the hedge's face (the mouse door) stands in front of this. */
export const BULGE = 0.03;
/**
 * How far each row stands back from the row below (m), and how far a sheet's top leans back from its bottom. Each row
 * stays behind the row below where they overlap (ROW_IN > LEAN * ROW_STEP / SHEET_H), so no sheet cuts through
 * another. The face leans back as it rises, as a clipped hedge does.
 */
const ROW_IN = 0.03;
const LEAN = 0.03;
/** The solid middle sits this far inside a walled face (m), behind the top row of sheets, and its top this far below the hedge's height: the leaves along the top stand above it. */
const SKIN = 0.25;
const CORE_TOP = HEDGE.height - 0.2;
/** The sheets along the top, standing up out of the solid middle: how far each is from the wall's middle (m), and how far its leaves reach above the hedge's height. */
const CRESTS = [-0.25, 0, 0.25];
const CREST_UP = 0.1;

/**
 * The hedge along the gate side: left and right of the door, and over it from
 * the door's top. Its back faces the orchard: leaves on both sides.
 */
export function gateHedge(l: Layout, doorTop: number): HedgeWall[] {
  const gx = l.gate.x;
  const z0 = l.bounds.maxZ + HEDGE.gap;
  const z1 = z0 + HEDGE.depth;
  const [left, right] = hedgeSpan(l);
  const wall = (x0: number, x1: number, y0: number, ends: HedgeWall["ends"]): HedgeWall => ({ min: [x0, y0, z0], max: [x1, HEDGE.height, z1], faces: [-1, 1], ends });
  // Each side ends free on the outside; the door's frame holds its other end.
  return [wall(left, gx - DOOR_HALF, 0, [-1]), wall(gx + DOOR_HALF, right, 0, [1]), wall(gx - DOOR_HALF, gx + DOOR_HALF, doorTop, [])];
}

/** The orchard's own hedge, round its other three sides: leaves only on the inside, as nobody walks round the outside. Its ends meet the gate's hedge and each other. */
export function orchardHedge(l: Layout): HedgeWall[] {
  const o = l.orchard;
  const [x0, x1] = [o.x - o.w / 2, o.x + o.w / 2];
  const [near, far] = [o.z - o.d / 2, o.z + o.d / 2];
  const d = HEDGE.depth;
  return [
    { min: [x0 - d, 0, near], max: [x0, HEDGE.height, far], faces: [1], ends: [] },
    { min: [x1, 0, near], max: [x1 + d, HEDGE.height, far], faces: [-1], ends: [] },
    { min: [x0 - d, 0, far], max: [x1 + d, HEDGE.height, far + d], faces: [-1], ends: [] },
  ];
}

/** The solid middle of a wall: inside its outline on the faces and ends that get leaves, and a little lower. */
export function hedgeCore(w: HedgeWall): Box {
  const thin = w.max[0] - w.min[0] < w.max[2] - w.min[2] ? 0 : 2;
  const long = thin === 0 ? 2 : 0;
  const min: [number, number, number] = [...w.min];
  const max: [number, number, number] = [w.max[0], Math.max(w.min[1], CORE_TOP), w.max[2]];
  if (w.faces.includes(-1)) min[thin] += SKIN;
  if (w.faces.includes(1)) max[thin] -= SKIN;
  if (w.ends.includes(-1)) min[long] += SKIN;
  if (w.ends.includes(1)) max[long] -= SKIN;
  return { min, max };
}

/** A point `along` a wall's length, `up` high and `across` its depth: [x, y, z]. */
type Point = [number, number, number];

/**
 * The sheets of leaves on a wall: rows of them up each walled face and each free end, and a few along the top. Each
 * row stands a little behind the row below; each sheet stays inside the wall's length (its free ends aside, where
 * the end's own rows stand), so none hangs into the doorway, and stands at most BULGE past the outline.
 */
export function hedgeSheets(w: HedgeWall, seed: number): Sheet[] {
  const rand = rng(seed);
  const thin = w.max[0] - w.min[0] < w.max[2] - w.min[2] ? 0 : 2;
  const long = thin === 0 ? 2 : 0;
  const out: Sheet[] = [];
  /**
   * A sheet across `axis`, facing `s` along it: its plane at `plane[0]` at the bottom and `plane[1]` at the top (it
   * leans), running from `run[0]` to `run[1]` along the other ground axis at the bottom, `run[2]` to `run[3]` at the top.
   */
  const put = (axis: 0 | 2, s: -1 | 1, plane: [number, number], run: [number, number, number, number], y: number, light: number) => {
    const other = axis === 0 ? 2 : 0;
    const p = (at: number, a: number, up: number): Point => {
      const v: Point = [0, up, 0];
      v[axis] = at;
      v[other] = a;
      return v;
    };
    // Seen from the side it faces, its left is the low end of the run when it faces +z or -x.
    const [l0, r0, l1, r1] = (axis === 2 ? s : -s) > 0 ? run : [run[1], run[0], run[3], run[2]];
    out.push({ corners: [p(plane[0], l0, y), p(plane[0], r0, y), p(plane[1], r1, y + SHEET_H), p(plane[1], l1, y + SHEET_H)], u: rand() * SHEET_W, light });
  };
  // Darker low down, where less light reaches.
  const lightAt = (y: number) => (0.8 + 0.26 * Math.min(1, y / HEDGE.height)) * (0.95 + rand() * 0.1);
  // How far a row stands past the outline (negative: inside it), at its bottom and at its top.
  const depth = (k: number): [number, number] => [BULGE - k * ROW_IN, BULGE - k * ROW_IN - LEAN];
  // Where a row runs to at either end of the wall: past a free end by that row's depth, where the end's own rows stand; else the wall's end.
  const end = (e: -1 | 1, d: number) => (e < 0 ? w.min[long] : w.max[long]) + (w.ends.includes(e) ? e * d : 0);
  // And across the wall, at a free end: out to where each face's rows stand.
  const side = (f: -1 | 1, d: number) => (f < 0 ? w.min[thin] : w.max[thin]) + (w.faces.includes(f) ? f * d : 0);
  const rows: number[] = [];
  // The top row's leaves end within a few centimetres of the wall's height.
  for (let y = w.min[1]; y + SHEET_H <= w.max[1] + 0.03; y += ROW_STEP) rows.push(y);
  if (!rows.length) throw new Error(`hedge: a wall ${w.max[1] - w.min[1]} m high is too low for a row of leaves`);
  rows.forEach((y, k) => {
    const [d0, d1] = depth(k);
    const light = lightAt(y + SHEET_H / 2);
    for (const s of w.faces) {
      const face = s < 0 ? w.min[thin] : w.max[thin];
      put(thin, s, [face + s * d0, face + s * d1], [end(-1, d0), end(1, d0), end(-1, d1), end(1, d1)], y, light);
    }
    for (const e of w.ends) {
      const at = e < 0 ? w.min[long] : w.max[long];
      put(long, e, [at + e * d0, at + e * d1], [side(-1, d0), side(1, d0), side(-1, d1), side(1, d1)], y, light);
    }
  });
  // Along the top, inside the top row's ends.
  const inside = depth(rows.length - 1)[1] - 0.02;
  const mid = (w.min[thin] + w.max[thin]) / 2;
  for (const c of CRESTS) put(thin, w.faces[0], [mid + c, mid + c], [end(-1, inside), end(1, inside), end(-1, inside), end(1, inside)], w.max[1] + CREST_UP - SHEET_H, 1.02 + rand() * 0.08);
  return out;
}
