// What the scene draws as solid stops a walker (docs/invariants.md, garden.drawn-solid). The
// scene's tap volumes (scenery.ts HitBox, HitDisc) are its one list of the things it draws in
// the garden, so this reads them, not a copy: a new thing with a tap volume is checked with no
// more work. Things drawn with no tap volume (the stile, the brambles, the well, the shed) are
// not checked here; the garden fuzzer's solids() lists them by hand.

import type { HitBox, HitDisc, SceneryId } from "../garden/scenery";

/**
 * Which part of each thing stops a walker: all of its footprint; only its middle (an upright
 * sprite: its leaves, petals or lamp hang over the ground round its stem or post); or none
 * (flat on the ground or the water, small enough to step over, or out of reach).
 */
const BODY: Record<SceneryId, "all" | "middle" | null> = {
  fence: "all",
  hedge: "all",
  door: "all",
  bench: "all",
  stool: "all",
  pond: "all",
  sign: "all",
  sundial: "all",
  bed: "all",
  sunflower: "middle",
  tree: "middle",
  pine: "middle",
  cherry: "middle",
  bush: "middle",
  lantern: "middle",
  lily: null,
  doormat: null,
  path: null,
  grass: null,
  flower: null,
  stone: null,
  hills: null,
  cloud: null,
  sun: null,
  moon: null,
  sky: null,
};

/** How far apart the spots tried along a thing are (m), and how far in from its ends the first and last are. */
const STEP = 0.2;
const INSET = 0.05;

/** A spot inside a thing drawn as solid where a walker may stand. */
export interface OpenSpot {
  id: SceneryId;
  x: number;
  z: number;
}

/**
 * The spots inside things drawn as solid where a walker may stand: `stand` (ground.ts standAt)
 * leaves them where they are. It tries the middle of each thing, and for a thing solid all
 * through, its middle line from end to end along its longer side. At each spot the ground
 * stands `lift` high: a box whose top is at or under it is walked over (the back fence, from
 * the stile's top step), and one whose bottom is over the eye is walked under (the door's lintel).
 */
export function openSpots(boxes: readonly HitBox[], discs: readonly HitDisc[], stand: (x: number, z: number) => { x: number; z: number }, lift: (x: number, z: number) => number, eye: number): OpenSpot[] {
  const out: OpenSpot[] = [];
  /** The spots along a line `len` long through (cx, cz), along (ux, uz); only its middle for a thing solid there alone. `ys` is a box's bottom and top; a disc's water has none. */
  const line = (id: SceneryId, cx: number, cz: number, ux: number, uz: number, len: number, ys?: [number, number]) => {
    const body = BODY[id];
    if (body === null) return;
    const half = body === "all" ? Math.max(0, len / 2 - INSET) : 0;
    const n = Math.ceil((2 * half) / STEP);
    for (let i = 0; i <= n; i++) {
      const s = n === 0 ? 0 : -half + (2 * half * i) / n;
      const [x, z] = [cx + ux * s, cz + uz * s];
      const ground = lift(x, z);
      if (ys && (ys[1] <= ground || ys[0] - ground > eye)) continue;
      const p = stand(x, z);
      if (p.x === x && p.z === z) out.push({ id, x, z });
    }
  };
  for (const b of boxes) {
    const w = b.max[0] - b.min[0];
    const d = b.max[2] - b.min[2];
    // Its long side in the world: the box's own x or z, turned as three turns rotation.y.
    const t = b.turn ?? 0;
    const [ux, uz] = w >= d ? [Math.cos(t), -Math.sin(t)] : [Math.sin(t), Math.cos(t)];
    line(b.id, (b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2, ux, uz, Math.max(w, d), [b.min[1], b.max[1]]);
  }
  for (const c of discs) line(c.id, c.x, c.z, 1, 0, 2 * c.r);
  return out;
}
