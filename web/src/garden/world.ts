// Layout of the walkable garden: words are planted in raised beds, one kind
// of word per row of beds (nouns, verbs, …), the most common words nearest
// the gate. Pure functions, so the layout is stable and testable.

import { toPos, type GardenWord, type Pos } from "../deck/schema";
import { hash01 } from "../lib/seed";
import { collideTrees, ORCHARD_MIN, type PlacedTree } from "./orchard";
import type { Stage } from "../ui/plant";

export interface GardenPlant {
  id: string;
  lemma: string;
  gloss: string;
  pos: string;
  rank: number;
  s: number;
  r: number;
  stage: Stage;
  growth: number;
  listen: boolean;
  write: boolean;
  /** A garden word's plant (#209): its visitor lives here once it has come. */
  garden?: GardenWord;
}

export interface PlacedPlant extends GardenPlant {
  x: number;
  z: number;
  /** Lean in radians for the shader as recall fades (droopFor). Never more than 18°, nothing ever dies. */
  droop: number;
  phase: number;
  bed: number;
}

export interface Bed {
  x: number;
  z: number;
  w: number;
  d: number;
  label: string;
}

export interface Layout {
  beds: Bed[];
  plants: PlacedPlant[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  gate: { x: number; z: number };
  pond: { x: number; z: number; r: number };
  /** The old orchard (#315): the walkable ground behind the hedge's door, by its middle. Nothing is built there until the door opens. */
  orchard: { x: number; z: number; w: number; d: number };
}

/** The hedge along the gate side (#315): from just behind the fence line, this deep and this tall. Taller than the eye (scene.ts EYE), so nothing behind it shows. */
export const HEDGE = { gap: 0.1, depth: 1.0, height: 2.6 } as const;
/** Half the width of the door in the hedge. */
export const DOOR_HALF = 0.55;
/** A walker's radius (m): how close the eye comes to fences, beds, the hedge and trunks. */
export const WALKER = 0.28;

const SPACING = 0.62;
const BED_COLS = 6;
const BED_ROWS = 5;
const MARGIN = 0.32;
const BED_W = BED_COLS * SPACING + MARGIN * 2;
const BED_D = BED_ROWS * SPACING + MARGIN * 2;
const PATH = 1.9;
const CAPACITY = BED_COLS * BED_ROWS;

const GROUPS: { label: string; pos: readonly Pos[] }[] = [
  { label: "Nouns", pos: ["noun"] },
  { label: "Verbs", pos: ["verb"] },
  { label: "Adjectives", pos: ["adj"] },
  { label: "Adverbs", pos: ["adv"] },
  { label: "Small words", pos: ["pron", "prep", "conj", "det", "num", "particle"] },
  { label: "Phrases", pos: ["phrase"] },
];
const OTHER = "Other words";

export function groupOf(pos: string): string {
  const p = toPos(pos);
  return (p && GROUPS.find((g) => g.pos.includes(p))?.label) || OTHER;
}

/** Which way a word's plant leans when it leans at all: 1 to the right, -1 to the left, the same in every view. */
export function leanDir(id: string): 1 | -1 {
  return hash01(id, 9) > 0.5 ? 1 : -1;
}

/**
 * How far a plant leans as recall fades, in degrees, positive to the right as
 * you look at it (SVG's rotate). A hint below 90% recall, never a punishment:
 * plants stay green and never lean more than 18°, however long the break.
 */
export function leanDeg(id: string, r: number): number {
  return leanDir(id) * Math.max(0, Math.min(1, (0.9 - r) / 0.4)) * 18;
}

/** The same lean as the 2D garden (leanDeg), in radians for the sprite shader, where positive turns the top to the left. */
export function droopFor(id: string, r: number): number {
  return (-leanDeg(id, r) * Math.PI) / 180;
}

export function layout(plants: GardenPlant[]): Layout {
  const byGroup = new Map<string, GardenPlant[]>();
  for (const p of plants) {
    const g = groupOf(p.pos);
    byGroup.set(g, [...(byGroup.get(g) ?? []), p]);
  }
  const order = [...GROUPS.map((g) => g.label), OTHER].filter((g) => byGroup.has(g));
  for (const g of order) byGroup.get(g)!.sort((a, b) => a.rank - b.rank || a.lemma.localeCompare(b.lemma));

  // One group per row of beds; a big group wraps onto more rows.
  const totalBeds = Math.max(1, order.reduce((n, g) => n + Math.ceil(byGroup.get(g)!.length / CAPACITY), 0));
  const cols = Math.max(2, Math.min(7, Math.ceil(Math.sqrt(totalBeds * 1.3))));
  const cellW = BED_W + PATH;
  const cellD = BED_D + PATH;

  const beds: Bed[] = [];
  const placed: PlacedPlant[] = [];
  let row = 0;
  const groups = order.length ? order : [""];
  for (const g of groups) {
    const list = byGroup.get(g) ?? [];
    const n = Math.max(1, Math.ceil(list.length / CAPACITY));
    for (let b = 0; b < n; b++) {
      const col = b % cols;
      if (b > 0 && col === 0) row++;
      // Centre each row of beds on the main path from the gate.
      const inRow = Math.min(cols, n - (b - col));
      const x = (col - (inRow - 1) / 2) * cellW;
      const z = -row * cellD;
      const label = !g ? "Your first words grow here" : b === 0 ? g : `${g} · ${b + 1}`;
      beds.push({ x, z, w: BED_W, d: BED_D, label });
      const bedIndex = beds.length - 1;
      list.slice(b * CAPACITY, (b + 1) * CAPACITY).forEach((p, i) => {
        // Fill from the front (the gate side) so the most common words are seen first.
        const c = i % BED_COLS;
        const rr = Math.floor(i / BED_COLS);
        const jx = (hash01(p.id, 1) - 0.5) * 0.2;
        const jz = (hash01(p.id, 2) - 0.5) * 0.2;
        placed.push({
          ...p,
          x: x - BED_W / 2 + MARGIN + (c + 0.5) * SPACING + jx,
          z: z + BED_D / 2 - MARGIN - (rr + 0.5) * SPACING + jz,
          droop: droopFor(p.id, p.r),
          phase: hash01(p.id, 3) * Math.PI * 2,
          bed: bedIndex,
        });
      });
    }
    row++;
  }

  const rows = row;
  const halfW = (cols * cellW) / 2 + 1.2;
  const front = BED_D / 2 + PATH + 4.5; // room by the gate for the pond
  const bounds = { minX: -halfW, maxX: halfW, minZ: -(rows - 1) * cellD - BED_D / 2 - PATH, maxZ: front };
  return {
    beds,
    plants: placed,
    bounds,
    gate: { x: 0, z: bounds.maxZ },
    pond: { x: bounds.minX + 2.6, z: bounds.maxZ - 2.4, r: 1.5 },
    // A fixed size, whatever the size of the garden: just big enough for a tree of every kind. The door is in the middle of its side toward the garden.
    orchard: { x: 0, z: bounds.maxZ + HEDGE.gap + HEDGE.depth + ORCHARD_MIN.d / 2, w: ORCHARD_MIN.w, d: ORCHARD_MIN.d },
  };
}

/**
 * Where the hedge runs along the gate side, left to right: a little past the
 * side fences, and past the orchard's own hedge where the orchard is wider than
 * the garden. Every line of sight from the garden into the orchard meets it.
 */
export function hedgeSpan(l: Layout): [number, number] {
  const o = l.orchard;
  return [Math.min(l.bounds.minX - 0.6, o.x - o.w / 2 - HEDGE.depth), Math.max(l.bounds.maxX + 0.6, o.x + o.w / 2 + HEDGE.depth)];
}

/** The bench by the pond, for sitting and admiring: its middle. It faces the pond. */
export function benchAt(l: Layout): { x: number; z: number } {
  return { x: l.pond.x + 0.2, z: l.pond.z - l.pond.r - 0.75 };
}

/** The sunflower, in the far right corner by the back fence. */
export function sunflowerAt(l: Layout): { x: number; z: number } {
  return { x: l.bounds.maxX - 1, z: l.bounds.minZ + 0.45 };
}

/** Lanterns where paths cross (by each bed's front corners), and two by the door. */
export function lanternSpots(l: Layout): [number, number][] {
  const spots = new Map<string, [number, number]>();
  for (const bed of l.beds)
    for (const sx of [-1, 1]) {
      const x = bed.x + sx * (bed.w / 2 + 0.95);
      const z = bed.z + bed.d / 2 + 0.95;
      spots.set(`${x.toFixed(1)},${z.toFixed(1)}`, [x, z]);
    }
  spots.set("gate-l", [l.gate.x - 1.6, l.gate.z - 0.4]);
  spots.set("gate-r", [l.gate.x + 1.6, l.gate.z - 0.4]);
  return [...spots.values()];
}

/** Where the key to the door can hide (#315): one place per learner, never by the door. */
/** The door's quiet lines (#315). Here, not in the scene, so the page can use them without loading three.js. */
export const DOOR_LINES = { locked: "Locked. The key must be somewhere.", found: "You found the key." } as const;

export const KEY_SPOTS = ["bench", "pond", "lantern", "bed", "sunflower"] as const;
export type KeySpot = (typeof KEY_SPOTS)[number];

/** This learner's hiding place, from a seed that stays the same for them (their id and course): always the same place. */
export function keySpot(seed: string): KeySpot {
  return KEY_SPOTS[Math.floor(hash01(seed, 315) * KEY_SPOTS.length)];
}

/** Where the key lies on the ground in this garden, at its hiding place. */
export function keyAt(l: Layout, spot: KeySpot): { x: number; z: number } {
  const far = (p: [number, number]) => Math.hypot(p[0] - l.gate.x, p[1] - l.gate.z);
  switch (spot) {
    case "bench": {
      // Half under the seat, at its front.
      const b = benchAt(l);
      return { x: b.x + 0.35, z: b.z + 0.18 };
    }
    case "pond":
      // Among the stones at the pond's edge, on the side by the fence.
      // Far enough out that no end of the key lies under the pond's rim.
      return { x: l.pond.x - l.pond.r - 0.35, z: l.pond.z + 0.3 };
    case "lantern": {
      // At the foot of the lantern farthest from the door.
      const [x, z] = lanternSpots(l).reduce((a, b) => (far(b) > far(a) ? b : a));
      return { x: x + 0.2, z: z + 0.12 };
    }
    case "bed": {
      // By the back left corner of the bed farthest from the door.
      const bed = l.beds.reduce((a, b) => (far([b.x - b.w / 2, b.z - b.d / 2]) > far([a.x - a.w / 2, a.z - a.d / 2]) ? b : a));
      return { x: bed.x - bed.w / 2 - 0.2, z: bed.z - bed.d / 2 - 0.2 };
    }
    case "sunflower": {
      const f = sunflowerAt(l);
      return { x: f.x - 0.3, z: f.z + 0.2 };
    }
  }
}

type Rect = [minX: number, maxX: number, minZ: number, maxZ: number];

/** The nearest point to (x, z) in any of the rectangles: the walker slides along their edges. */
function nearestIn(rects: Rect[], x: number, z: number): { x: number; z: number } {
  let best = { x, z };
  let bestD = Infinity;
  for (const [x0, x1, z0, z1] of rects) {
    const p = { x: Math.max(x0, Math.min(x1, x)), z: Math.max(z0, Math.min(z1, z)) };
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) [best, bestD] = [p, d];
  }
  return best;
}

/**
 * Keep a walker of radius `rad` inside the fence and out of beds and the pond.
 * Once the door is open (#315), the doorway and the orchard behind it are open too.
 */
export function collide(l: Layout, x: number, z: number, rad = WALKER, doorOpen = false): { x: number; z: number } {
  const b = l.bounds;
  const garden: Rect = [b.minX + rad, b.maxX - rad, b.minZ + rad, b.maxZ - rad];
  const o = l.orchard;
  const near = o.z - o.d / 2;
  const doorway: Rect = [l.gate.x - DOOR_HALF + rad, l.gate.x + DOOR_HALF - rad, b.maxZ - rad, near + rad];
  const orchard: Rect = [o.x - o.w / 2 + rad, o.x + o.w / 2 - rad, near + rad, o.z + o.d / 2 - rad];
  ({ x, z } = nearestIn(doorOpen ? [garden, doorway, orchard] : [garden], x, z));
  for (const bed of l.beds) {
    const hw = bed.w / 2 + rad;
    const hd = bed.d / 2 + rad;
    const dx = x - bed.x;
    const dz = z - bed.z;
    if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
      // Push out along the shallowest side.
      const px = hw - Math.abs(dx);
      const pz = hd - Math.abs(dz);
      if (px < pz) x = bed.x + Math.sign(dx || 1) * hw;
      else z = bed.z + Math.sign(dz || 1) * hd;
    }
  }
  const dx = x - l.pond.x;
  const dz = z - l.pond.z;
  const d = Math.hypot(dx, dz);
  const min = l.pond.r + rad;
  if (d < min) {
    const k = min / (d || 1);
    x = l.pond.x + dx * k;
    z = l.pond.z + dz * k;
  }
  return { x, z };
}

/**
 * Move a walker from (x, z) toward (toX, toZ), in short pieces through collide,
 * and round the orchard's trunks (`trees`: none while the door is shut).
 * collide sees only where a move ends: one long move (a ctrl+wheel step is 2 m)
 * could end past the hedge's middle and land in the orchard, beside the door (#315).
 */
export function walk(l: Layout, x: number, z: number, toX: number, toZ: number, doorOpen: boolean, trees: readonly PlacedTree[]): { x: number; z: number } {
  const n = Math.max(1, Math.ceil(Math.hypot(toX - x, toZ - z) / 0.25));
  const [dx, dz] = [(toX - x) / n, (toZ - z) / n];
  for (let i = 0; i < n; i++) {
    ({ x, z } = collide(l, x + dx, z + dz, WALKER, doorOpen));
    ({ x, z } = collideTrees(trees, x, z, WALKER));
  }
  return { x, z };
}

/** How far into the doorway's ends a route steps: clear of the hedge on either side. */
const DOOR_STEP = 0.5;

/**
 * The way to a spot in the garden from (x, z): straight there from the garden;
 * from the orchard or its doorway (#315), out through the door first, so a
 * glide never goes through the hedge. Corners in order, from (x, z) to the spot.
 */
export function route(l: Layout, x: number, z: number, toX: number, toZ: number): [number, number][] {
  if (z <= l.bounds.maxZ) return [[x, z], [toX, toZ]];
  const out: [number, number][] = [[x, z]];
  const near = l.orchard.z - l.orchard.d / 2;
  // In the orchard: first to just inside the door.
  if (z > near) out.push([l.gate.x, near + DOOR_STEP]);
  out.push([l.gate.x, l.bounds.maxZ - DOOR_STEP], [toX, toZ]);
  return out;
}

/** The point a fraction `k` (0 to 1) of the way along a route, by length. */
export function along(path: readonly [number, number][], k: number): { x: number; z: number } {
  // The ends exactly: summing and subtracting leg lengths rounds, and Math.hypot rounds differently per platform.
  if (k >= 1) return { x: path[path.length - 1][0], z: path[path.length - 1][1] };
  const lens = path.slice(1).map(([x, z], i) => Math.hypot(x - path[i][0], z - path[i][1]));
  let left = k * lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      // A leg of no length (already at its end) has no direction: its end is the point.
      const f = lens[i] ? Math.min(1, left / lens[i]) : 1;
      return { x: path[i][0] + (path[i + 1][0] - path[i][0]) * f, z: path[i][1] + (path[i + 1][1] - path[i][1]) * f };
    }
    left -= lens[i];
  }
  throw new Error("a route has at least two corners");
}

/** Where to stand to look at a plant: on the path in front of its bed. */
export function viewpoint(l: Layout, p: PlacedPlant): { x: number; z: number; yaw: number } {
  const bed = l.beds[p.bed];
  const z = bed.z + bed.d / 2 + 1.45;
  const x = p.x;
  const yaw = Math.atan2(-(p.x - x), -(p.z - z)); // forward is -z at yaw 0
  return { x, z, yaw };
}
