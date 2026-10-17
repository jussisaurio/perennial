// Walk into things (#359, #335 V6): no button, your body is the verb. Walk
// right beside a bed and its plants sway away and spring back, each playing
// its word's note; walk into an orchard tree and it shakes something down;
// in autumn, walk into a leaf pile and it bursts. The rules, as plain
// functions over numbers, so the scene (scenePlants.ts, sceneWalkInto.ts)
// only draws them. Every step here allocates nothing: they run every frame.

import type { PlacedTree } from "./orchard";
import type { Frame } from "./scenePart";
import type { PixelArt } from "./visitorArt";
import { basketAt, bowlAt, shedAt } from "./leave";
import { hash01 } from "../lib/seed";
import { benchAt, KEY_SPOTS, keyAt, lanternSpots, sunflowerAt, WALKER, type Layout } from "./world";

// ---- Brushing the beds ----

export const BRUSH = {
  /**
   * A plant this near the walker (m) is brushed. A walker keeps WALKER from a
   * bed's edge, and its edge row stands 0.63 m in: hugging a bed brushes that
   * row; the middle of the path brushes nothing.
   */
  r: 1.15,
  /** The spring: stiffness (per s²) and damping (per s). It springs back in about a second. */
  k: 140,
  c: 6,
  /** How fast a brushed plant starts to lean (rad/s), and how much more per m/s of the walker's speed: a run brushes harder. */
  kick: 1.2,
  perSpeed: 0.2,
  /** At least this long between two notes (s): a run along a row plays a quick run of notes, not a chord. */
  gap: 0.07,
  /** Below this lean (rad) and speed (rad/s), a plant is still again. */
  rest: 0.002,
} as const;

/** Every plant's lean and spring, which are near the walker, and which moved this frame. Made once per walk. */
export interface Brush {
  lean: Float32Array;
  vel: Float32Array;
  near: Uint8Array;
  /** The plants still springing back: the first `moving` of `active`. */
  active: Int32Array;
  moving: number;
  /** The plants whose lean changed this frame, for the scene to draw: the first `changed` of `dirty`. */
  dirty: Int32Array;
  changed: number;
  /** Each bed's plants, and whether the walker was near the bed last frame (its plants' `near` must be cleared once they leave). */
  beds: Int32Array[];
  bedNear: Uint8Array;
  /** When the last note played (s, Frame.elapsed). */
  lastNote: number;
}

export function brush(l: Layout): Brush {
  const n = l.plants.length;
  const byBed = l.beds.map(() => [] as number[]);
  l.plants.forEach((p, i) => byBed[p.bed].push(i));
  return {
    lean: new Float32Array(n),
    vel: new Float32Array(n),
    near: new Uint8Array(n),
    active: new Int32Array(n),
    moving: 0,
    dirty: new Int32Array(n),
    changed: 0,
    beds: byBed.map((b) => Int32Array.from(b)),
    bedNear: new Uint8Array(l.beds.length),
    lastNote: -Infinity,
  };
}

/**
 * One frame of brushing: plants the walker has just come near lean away from
 * them (in the view: a plant on your right leans right), and every moving
 * plant springs back. Only on foot (`f.speed` > 0): a glide past a bed or
 * sitting still brushes nothing. Returns the plant whose note plays now, or
 * -1: at most one a frame, and none within BRUSH.gap of the last.
 */
export function brushStep(b: Brush, l: Layout, f: Frame): number {
  b.changed = 0;
  let note = -1;
  const rx = Math.cos(f.yaw);
  const rz = -Math.sin(f.yaw);
  for (let bi = 0; bi < l.beds.length; bi++) {
    const bed = l.beds[bi];
    const ox = Math.max(0, Math.abs(f.x - bed.x) - bed.w / 2);
    const oz = Math.max(0, Math.abs(f.z - bed.z) - bed.d / 2);
    const close = Math.hypot(ox, oz) < BRUSH.r;
    if (!close && !b.bedNear[bi]) continue;
    b.bedNear[bi] = close ? 1 : 0;
    const inBed = b.beds[bi];
    for (let j = 0; j < inBed.length; j++) {
      const i = inBed[j];
      const p = l.plants[i];
      const dx = p.x - f.x;
      const dz = p.z - f.z;
      const isNear = Math.hypot(dx, dz) < BRUSH.r;
      const came = isNear && !b.near[i];
      b.near[i] = isNear ? 1 : 0;
      if (!came || f.speed <= 0) continue;
      // A positive angle turns the top left (sceneSprites.ts billboard): a plant on the right leans the other way. Dead ahead, either way will do.
      const side = dx * rx + dz * rz >= 0 ? -1 : 1;
      if (b.vel[i] === 0 && b.lean[i] === 0) b.active[b.moving++] = i;
      b.vel[i] += side * (BRUSH.kick + BRUSH.perSpeed * f.speed);
      if (note < 0 && f.elapsed - b.lastNote >= BRUSH.gap) {
        note = i;
        b.lastNote = f.elapsed;
      }
    }
  }
  const dt = f.dt;
  for (let k = 0; k < b.moving; ) {
    const i = b.active[k];
    b.vel[i] += (-BRUSH.k * b.lean[i] - BRUSH.c * b.vel[i]) * dt;
    b.lean[i] += b.vel[i] * dt;
    b.dirty[b.changed++] = i;
    if (Math.abs(b.lean[i]) < BRUSH.rest && Math.abs(b.vel[i]) < BRUSH.rest) {
      b.lean[i] = b.vel[i] = 0;
      b.active[k] = b.active[--b.moving];
    } else k++;
  }
  return note;
}

// ---- Bumping a tree ----

/** Walking into a trunk: the walker is held WALKER from it (orchard.ts collideTrees), so within `touch` more is touching it. Away by `rearm` before it shakes again. */
export const BUMP = { touch: 0.04, rearm: 0.5 } as const;

/** What a bumped tree drops: a fruit when it is in fruit (the plain tree's "fruit" is a nest, so leaves), petals in blossom, else leaves. */
export type Fell = "fruit" | "petals" | "leaves";

export function fellFrom(t: Pick<PlacedTree, "kind" | "look">): Fell {
  if (t.look === "fruit" && t.kind !== "tree") return "fruit";
  return t.look === "blossom" ? "petals" : "leaves";
}

/** The tree the walker just walked into on foot, or -1. `armed` (one per tree, 1 to start) keeps leaning on a trunk from shaking it again and again. */
export function bumpStep(trees: readonly PlacedTree[], armed: Uint8Array, x: number, z: number, speed: number): number {
  let hit = -1;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const d = Math.hypot(x - t.x, z - t.z) - t.trunk - WALKER;
    if (d > BUMP.rearm) armed[i] = 1;
    else if (armed[i] && d < BUMP.touch && speed > 0 && hit < 0) {
      armed[i] = 0;
      hit = i;
    }
  }
  return hit;
}

/** "An apple fell." for screen readers, from the fruit's kind in English. */
export function fellLine(kind: string): string {
  return `${/^[aeiou]/.test(kind) ? "An" : "A"} ${kind} fell.`;
}

// ---- A fallen fruit ----

/** A fruit in the air or on the ground (m, m/s). Made once per slot; fruitDrop and rollStep change it in place. */
export interface Rolling {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  still: boolean;
}

/** Gravity (m/s²); the share of its speed a bounce keeps; slower than `settle` (m/s) it stops bouncing; ground friction (per s); slower than `stop` it lies still. */
export const ROLL = { g: 9.8, bounce: 0.45, settle: 0.5, friction: 2.4, stop: 0.04 } as const;

/** A fruit falls this far round from straight behind the trunk (rad), left or right: you stand at the trunk, so it lands where you can see it, beside it. */
const DROP_TURN = 0.55;

/**
 * A fruit leaves the crown on the far side of the trunk from the walker, a
 * little to the left or right (`side`), and rolls on away from them. With
 * reduced motion it lies there at once.
 */
export function fruitDrop(t: PlacedTree, walkerX: number, walkerZ: number, side: 1 | -1, motion: boolean, out: Rolling): void {
  const d = Math.hypot(t.x - walkerX, t.z - walkerZ);
  // The walker is held off the trunk (collideTrees), so d is never 0.
  const c = Math.cos(DROP_TURN * side);
  const s = Math.sin(DROP_TURN * side);
  const ax = (t.x - walkerX) / d;
  const az = (t.z - walkerZ) / d;
  const ux = ax * c - az * s;
  const uz = ax * s + az * c;
  const from = motion ? t.half * 0.45 : t.half * 0.6;
  out.x = t.x + ux * from;
  out.z = t.z + uz * from;
  out.y = motion ? t.height * 0.55 : 0;
  out.vx = motion ? ux * 0.5 : 0;
  out.vz = motion ? uz * 0.5 : 0;
  out.vy = motion ? 0.6 : 0;
  out.still = !motion;
}

/** One frame of a fruit's fall: it drops, bounces lower each time, then rolls to a stop. */
export function rollStep(f: Rolling, dt: number): void {
  if (f.still) return;
  f.vy -= ROLL.g * dt;
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  f.z += f.vz * dt;
  if (f.y > 0) return;
  f.y = 0;
  f.vy = Math.abs(f.vy) < ROLL.settle ? 0 : -f.vy * ROLL.bounce;
  if (f.vy !== 0) return;
  const k = Math.max(0, 1 - ROLL.friction * dt);
  f.vx *= k;
  f.vz *= k;
  if (Math.hypot(f.vx, f.vz) < ROLL.stop) f.still = true;
}

// ---- Leaf piles ----

/** A few piles; walk within `r` (m) of one to burst it; nothing else this near (m) to a pile. */
export const PILES = { count: 3, r: 0.45, clear: 1.1 } as const;

/**
 * Where the leaf piles lie: on the paths beside and behind the beds, away
 * from the lanterns, the sunflower, the bench, the bowl and shed, and every
 * place the key can hide. The same spots every visit to this garden.
 */
export function leafPiles(l: Layout): { x: number; z: number }[] {
  const spots = new Map<string, { x: number; z: number }>();
  for (const bed of l.beds)
    for (const [x, z] of [
      [bed.x - bed.w / 2 - 0.95, bed.z],
      [bed.x + bed.w / 2 + 0.95, bed.z],
      [bed.x, bed.z - bed.d / 2 - 0.95],
    ])
      spots.set(`${x.toFixed(1)},${z.toFixed(1)}`, { x, z });
  const keep = [...lanternSpots(l).map(([x, z]) => ({ x, z })), sunflowerAt(l), benchAt(l), bowlAt(l), shedAt(l), basketAt(l), ...KEY_SPOTS.map((s) => keyAt(l, s))];
  return [...spots.entries()]
    .filter(([, p]) => keep.every((k) => Math.hypot(k.x - p.x, k.z - p.z) >= PILES.clear))
    .sort(([a], [b]) => hash01(a, 359) - hash01(b, 359))
    .slice(0, PILES.count)
    .map(([, p]) => p);
}

/** A number in [0, 1) from a number: the scatter of a burst's leaves, seeded, never Math.random, and with no string to make. */
export function scatter(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Autumn's leaves: the piles and the bits they burst into. */
export const AUTUMN = ["#e8902a", "#c8502a", "#f2c240", "#a8642c"] as const;

/** A neat, low pile of autumn leaves. */
export const LEAF_PILE: PixelArt = {
  rows: [
    "......aYb.......",
    "....bYaaOYa.....",
    "..aOYbaYaabOY...",
    ".YabOaYbOaYabOa.",
    "aOYaabOYaYbaOYab",
    "bbaObbaabbOabbab",
  ],
  pal: { a: AUTUMN[0], O: AUTUMN[1], Y: AUTUMN[2], b: AUTUMN[3] },
};
