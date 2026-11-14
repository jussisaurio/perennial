// The hedge round the old orchard (#315), as plain numbers: where its walls run,
// and the shape of each wall. A solid middle (it hides what is behind it, from
// any angle) under rounded clumps of leaves (an uneven top, a bumpy face).
// scene.ts draws it: the middles as boxes, the clumps as one instanced mesh.

import { rng } from "../lib/seed";
import { DOOR_HALF, HEDGE, hedgeSpan, type Layout } from "./world";

/** An axis-aligned box: [x, y, z] corners. */
export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * A wall of hedge: its outline, which of its long faces you can walk up to (-1: the low x or z side, 1: the high one),
 * and which of its ends stand free, with nothing against them (-1: the low end, 1: the high one). Both get clumps of
 * leaves, so a free end is round, not cut off square.
 */
export interface HedgeWall extends Box {
  faces: (-1 | 1)[];
  ends: (-1 | 1)[];
}

/** A clump of leaves: its middle, its radii along x, y and z, and how light it is (1: in full light; lower down, darker). */
export interface Clump {
  at: [number, number, number];
  r: [number, number, number];
  shade: number;
}

/** The solid middle sits this far inside a walled face (m), and its top this far below the hedge's height: clumps fill out the rest. */
const SKIN = 0.14;
const CORE_TOP = HEDGE.height - 0.2;
/** How far a clump may bulge out past the hedge's outline (m): never into the path or the doorway. */
const BULGE = 0.04;

/**
 * The hedge along the gate side: left and right of the door, and over it from
 * the door's top. Its back faces the orchard: clumps on both sides.
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

/** The orchard's own hedge, round its other three sides: clumps only on the inside, as nobody walks round the outside. Its ends meet the gate's hedge and each other. */
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

/** The solid middle of a wall: inside its outline on the faces and ends that get clumps, and a little lower. */
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

/**
 * The clumps of leaves on a wall: rows of them up each walled face, a row
 * along the top at varied heights, and a column up each free end. Each stays
 * inside the wall's length, so none hangs into the doorway, and bulges at most
 * BULGE past the face.
 */
export function hedgeClumps(w: HedgeWall, seed: number): Clump[] {
  const rand = rng(seed);
  const thin = w.max[0] - w.min[0] < w.max[2] - w.min[2] ? 0 : 2;
  const long = thin === 0 ? 2 : 0;
  const [a0, a1] = [w.min[long], w.max[long]];
  const core = hedgeCore(w);
  const top = core.max[1];
  const out: Clump[] = [];
  const put = (along: number, y: number, across: number, ra: number, ry: number, rt: number, shade: number) => {
    const at: [number, number, number] = [0, y, 0];
    const r: [number, number, number] = [0, ry, 0];
    // Inside the wall's length: no clump hangs past its end.
    at[long] = Math.max(a0 + ra, Math.min(a1 - ra, along));
    at[thin] = across;
    r[long] = ra;
    r[thin] = rt;
    out.push({ at, r, shade });
  };
  // Darker low down, where less light reaches.
  const lightAt = (y: number) => (0.8 + 0.28 * Math.min(1, y / top)) * (0.9 + rand() * 0.16);
  // A row of clumps along the wall, a little apart, each a little different.
  const row = (each: (along: number) => void) => {
    for (let a = a0 + 0.1 + rand() * 0.3; a < a1; a += 0.38 + rand() * 0.3) each(a);
  };
  for (const s of w.faces) {
    const face = s < 0 ? w.min[thin] : w.max[thin];
    for (let y = w.min[1] + 0.38; y < top - 0.1; y += 0.56)
      row((a) => {
        const rt = 0.2 + rand() * 0.08;
        const light = lightAt(y);
        put(a, y + (rand() - 0.5) * 0.24, face + s * (BULGE - rand() * 0.08 - rt), 0.3 + rand() * 0.22, 0.28 + rand() * 0.16, rt, light);
      });
  }
  // The top: an uneven line, now and then a taller tuft. Each clump spans the wall's depth.
  const mid = (w.min[thin] + w.max[thin]) / 2;
  const half = (w.max[thin] - w.min[thin]) / 2;
  row((a) => {
    const tall = rand() < 0.18 ? 0.12 : 0;
    put(a, top + rand() * 0.14 + tall, mid, 0.34 + rand() * 0.18, 0.24 + rand() * 0.1, half + BULGE, 1 + rand() * 0.12);
  });
  // A free end: a column of clumps up it, across its middle (the faces' clumps round its corners).
  for (const s of w.ends) {
    const end = s < 0 ? a0 : a1;
    for (let y = w.min[1] + 0.38; y < top - 0.1; y += 0.56) {
      const ra = 0.2 + rand() * 0.08;
      put(end - s * (ra + rand() * 0.08), y + (rand() - 0.5) * 0.24, mid + (rand() - 0.5) * 0.2, ra, 0.28 + rand() * 0.16, 0.3 + rand() * 0.1, lightAt(y));
    }
  }
  return out;
}
