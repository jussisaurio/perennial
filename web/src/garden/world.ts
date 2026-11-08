// Layout of the walkable garden: words are planted in raised beds in the
// order the learner planted them (their first review), along a path that
// winds outward from the gate (#641). A bed never moves once it exists. Pure
// functions, so the layout is stable, the same on every device, and testable.

import type { Gender, GardenWord } from "../deck/schema";
import { dayNumber } from "../core/day";
import { hash01 } from "../lib/seed";
import { collideTrees, ORCHARD_MIN, orchardWell, WELL_R, type PlacedTree } from "./orchard";
import type { DeckLang } from "../deck/langs";
import type { PerLang } from "./nouns";
import type { Stage } from "../ui/plant";

/** A word that has its place in the beds: when it was planted, and what breaks a tie. */
export interface Planting {
  id: string;
  lemma: string;
  rank: number;
  /** Its first reading review (ms). */
  planted: number;
}

export interface GardenPlant extends Planting {
  gloss: string;
  pos: string;
  s: number;
  r: number;
  stage: Stage;
  growth: number;
  listen: boolean;
  write: boolean;
  /** The word's forms, the word itself among them (#357: shaken, the others fall as petals). */
  forms: readonly string[];
  /** A noun's gender, for the shape of its label's stake (#357). */
  gender?: Gender;
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

interface Bed {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Its sign: the month its first word was planted, on the first bed of each month only; null: no sign. */
  sign: BedSign | null;
}

/** What a bed's sign says, before bedSign writes it in the course language: when its first word was planted (`year`: with the year), or "empty" in a garden with no words yet. */
export type BedSign = { planted: number; year: boolean } | "empty";

export interface Layout {
  beds: Bed[];
  plants: PlacedPlant[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  gate: { x: number; z: number };
  pond: { x: number; z: number; r: number };
  /** The old orchard (#315): the walkable ground behind the hedge's door, by its middle. Nothing is built there until the door opens. */
  orchard: { x: number; z: number; w: number; d: number };
  /** The wishing well in the orchard (#335 S6): its middle and its stone ring's radius. It is there only once the door is open. */
  well: { x: number; z: number; r: number };
}

/** The hedge along the gate side (#315): from just behind the fence line, this deep and this tall. Taller than the eye (scene.ts EYE), so nothing behind it shows. */
export const HEDGE = { gap: 0.1, depth: 1.0, height: 2.6 } as const;
/** Half the width of the door in the hedge. */
export const DOOR_HALF = 0.55;
/** A walker's radius (m): how close the eye comes to fences, beds, the hedge and trunks. */
export const WALKER = 0.28;

/** Height of the raised beds: plants stand on their soil. */
export const BED_H = 0.28;
const SPACING = 0.62;
const BED_COLS = 6;
const BED_ROWS = 5;
const MARGIN = 0.32;
const BED_W = BED_COLS * SPACING + MARGIN * 2;
const BED_D = BED_ROWS * SPACING + MARGIN * 2;
const PATH = 1.9;
const CAPACITY = BED_COLS * BED_ROWS;
/** A bed and the path beside it, across (m): the paths between bed columns run CELL_W / 2 either side of the gate's line, and every CELL_W further out. */
export const CELL_W = BED_W + PATH;
const CELL_D = BED_D + PATH;
/** Past the outermost beds, the fence is this far from their edge (m). */
const SIDE = PATH / 2 + 1.2;
/** The garden is never narrower than this, so the pond, the bench and the shed by the gate have room (m). */
const MIN_HALF_W = CELL_W + 1.2;
/** A year (ms), for when bed signs add the year. */
const YEAR_MS = 365 * 24 * 3600 * 1000;

/**
 * The first `count` places for beds along the path, as [column, row]: column
 * 0 is in front of the gate, negative to the left; row 0 is by the gate. The
 * path winds outward in rings round the first bed: ring k goes up one side,
 * along the back and down the other side, and the next ring starts beside
 * where it ended. So a new bed always joins at the far end of the path, and no
 * place depends on how many beds there are.
 */
function bedCells(count: number): [number, number][] {
  const out: [number, number][] = [[0, 0]];
  for (let k = 1; out.length < count; k++) {
    const ring: [number, number][] = [];
    for (let r = 0; r <= k; r++) ring.push([-k, r]);
    for (let c = -k + 1; c < k; c++) ring.push([c, k]);
    for (let r = k; r >= 0; r--) ring.push([k, r]);
    // Every other ring goes the other way, so it starts beside where the last one ended.
    if (k % 2 === 0) ring.reverse();
    out.push(...ring);
  }
  return out.slice(0, count);
}

/** Planting order: first planted first; on a tie, the commoner word, then by lemma and id, so every device agrees. */
function byPlanting(a: Planting, b: Planting): number {
  return a.planted - b.planted || a.rank - b.rank || (a.lemma < b.lemma ? -1 : a.lemma > b.lemma ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The empty garden's bed sign, per course language: "Your words will grow here". */
const EMPTY_BED: PerLang<string> = { es: "Aquí crecerán tus palabras", de: "Hier wachsen deine Wörter" };

/**
 * A bed sign's text, in the course language (#650): the month, "Octubre" or
 * "Oktober", with the year when the sign has one. In local time, like the
 * garden's calendar days.
 */
export function bedSign(sign: BedSign, lang: DeckLang): string {
  if (sign === "empty") return EMPTY_BED[lang];
  const month = new Date(sign.planted).toLocaleDateString(lang, sign.year ? { month: "long", year: "numeric" } : { month: "long" });
  // Spanish writes a month small; alone on a sign, it starts with a capital.
  return month[0].toUpperCase() + month.slice(1);
}

/** Which way a word's plant leans when it leans at all: 1 to the right, -1 to the left, the same in every view. */
function leanDir(id: string): 1 | -1 {
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

/** The same lean as the 2D garden (leanDeg), in radians for the sprite shader, where positive turns the top to the left. @internal Exported for tests. */
export function droopFor(id: string, r: number): number {
  return (-leanDeg(id, r) * Math.PI) / 180;
}

/**
 * Each word takes the next place in planting order: 30 to a bed, filled from
 * the front, beds along the path (bedCells). `aside`: words set aside after
 * they were planted. Each keeps its place as an empty spot, so setting a word
 * aside never moves the plants planted after it, and bringing it back puts it
 * where it was. Words not planted yet take no place: when they are, they come
 * after every word planted before. `aside` defaults to none, as in a garden
 * made up for a test.
 */
export function layout(plants: readonly GardenPlant[], aside: readonly Planting[] = []): Layout {
  // Plants and empty spots (plant: null), in planting order.
  const slots: { at: Planting; plant: GardenPlant | null }[] = [...plants.map((p) => ({ at: p, plant: p })), ...aside.map((a) => ({ at: a, plant: null }))];
  slots.sort((a, b) => byPlanting(a.at, b.at));
  const count = Math.max(1, Math.ceil(slots.length / CAPACITY));
  // The year shows on every sign once the garden's planting spans a year: only then can a month name come round again.
  const year = slots.length > 0 && slots[slots.length - 1].at.planted - slots[0].at.planted >= YEAR_MS;
  const month = (b: number) => {
    const d = new Date(slots[b * CAPACITY].at.planted);
    return d.getFullYear() * 12 + d.getMonth();
  };

  const beds: Bed[] = [];
  const placed: PlacedPlant[] = [];
  for (const [b, [col, row]] of bedCells(count).entries()) {
    const x = col * CELL_W;
    const z = -row * CELL_D;
    // A sign where a month starts, not on every bed: a learner fills several beds a month.
    const sign: BedSign | null = !slots.length ? "empty" : b === 0 || month(b) !== month(b - 1) ? { planted: slots[b * CAPACITY].at.planted, year } : null;
    beds.push({ x, z, w: BED_W, d: BED_D, sign });
    for (let i = 0; i < CAPACITY; i++) {
      // Past the last word, or a word set aside: nothing grows here.
      const gp = slots[b * CAPACITY + i]?.plant;
      if (!gp) continue;
      // Fill from the front (the path side), so the bed's first words are seen first.
      const c = i % BED_COLS;
      const rr = Math.floor(i / BED_COLS);
      const jx = (hash01(gp.id, 1) - 0.5) * 0.2;
      const jz = (hash01(gp.id, 2) - 0.5) * 0.2;
      placed.push({
        ...gp,
        x: x - BED_W / 2 + MARGIN + (c + 0.5) * SPACING + jx,
        z: z + BED_D / 2 - MARGIN - (rr + 0.5) * SPACING + jz,
        droop: droopFor(gp.id, gp.r),
        phase: hash01(gp.id, 3) * Math.PI * 2,
        bed: b,
      });
    }
  }

  // The fence round every bed, as far out on both sides of the gate, so the hedge and the orchard stay in the middle.
  let maxAbsX = 0;
  let minZ = 0;
  for (const bed of beds) {
    maxAbsX = Math.max(maxAbsX, Math.abs(bed.x));
    minZ = Math.min(minZ, bed.z);
  }
  const halfW = Math.max(MIN_HALF_W, maxAbsX + BED_W / 2 + SIDE);
  const front = BED_D / 2 + PATH + 4.5; // room by the gate for the pond
  const bounds = { minX: -halfW, maxX: halfW, minZ: minZ - BED_D / 2 - PATH, maxZ: front };
  // A fixed size, whatever the size of the garden: just big enough for a tree of every kind. The door is in the middle of its side toward the garden.
  const orchard = { x: 0, z: bounds.maxZ + HEDGE.gap + HEDGE.depth + ORCHARD_MIN.d / 2, w: ORCHARD_MIN.w, d: ORCHARD_MIN.d };
  return {
    beds,
    plants: placed,
    bounds,
    gate: { x: 0, z: bounds.maxZ },
    pond: { x: bounds.minX + 2.6, z: bounds.maxZ - 2.4, r: 1.5 },
    orchard,
    well: { ...orchardWell(orchard), r: WELL_R },
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

/** The bench's size about its middle (m): half its length, and how far its back and its front are. */
export const BENCH = { half: 0.68, back: 0.25, front: 0.22 } as const;

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

/** The door's quiet lines (#315), in the course language like every line in the garden (#650). Here, not in the scene, so the page can use them without loading three.js. */
export const DOOR_LINES: PerLang<{ locked: string; found: string }> = {
  es: { locked: "Cerrado con llave.", found: "Has encontrado la llave." },
  de: { locked: "Abgeschlossen.", found: "Du hast den Schlüssel gefunden." },
};

/** The same lines as a screen reader hears them, in English. */
export const DOOR_SPOKEN = { locked: "Locked.", found: "You found the key." } as const;

/** Where the key to the door can hide (#315): one place per learner, never by the door. */
export const KEY_SPOTS = ["bench", "pond", "lantern", "bed", "sunflower"] as const;
export type KeySpot = (typeof KEY_SPOTS)[number];

/** This learner's hiding place, from a seed that stays the same for them (their id and course): always the same place. */
export function keySpot(seed: string): KeySpot {
  return KEY_SPOTS[Math.floor(hash01(seed, 315) * KEY_SPOTS.length)];
}

/**
 * Help for a learner whose key has waited a while (#334): from the world, late
 * and gently, never in words. From the third day after the key came, a visitor
 * here today waits by it (the dog; the bird at dusk and night); from the
 * seventh, it glints whenever you face it. Calendar days, in local time.
 */
const KEY_HELP_DAYS = { visitors: 3, glint: 7 } as const;
export interface KeyHelp {
  visitors: boolean;
  glint: boolean;
}

/** The help the garden gives today (`now`) for a key that came at `since` (ms). */
export function keyHelp(since: number, now: number): KeyHelp {
  const days = dayNumber(now) - dayNumber(since);
  return { visitors: days >= KEY_HELP_DAYS.visitors, glint: days >= KEY_HELP_DAYS.glint };
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

/** How far from the key each visitor waits (m), and how far round from the side away from the garden's middle (rad): the bird beside it, not behind the dog. */
const BY_KEY = { dog: [0.8, 0], bird: [0.5, Math.PI / 2] } as const;

/**
 * Where a visitor waits by a key left waiting (#802): near it, on the side
 * away from the garden's middle (BY_KEY), so the key lies between it and you
 * as you come. On open ground: the nearest
 * such place out of the beds, the pond, the bench, the lanterns' posts and
 * the sunflower, and inside the fence.
 */
export function besideKey(l: Layout, key: { x: number; z: number }, who: keyof typeof BY_KEY): [number, number, number] {
  const [d, turn] = BY_KEY[who];
  const b = l.bounds;
  const away = Math.atan2(key.z - (b.minZ + b.maxZ) / 2, key.x - (b.minX + b.maxX) / 2) + turn;
  const bench = benchAt(l);
  const posts: [number, number][] = [...lanternSpots(l), [sunflowerAt(l).x, sunflowerAt(l).z]];
  // Room for the dog's body (m) from a post or the bench.
  const room = 0.35;
  for (let i = 0; i < 24; i++) {
    // 0, +15°, -15°, +30°, ...
    const a = away + Math.ceil(i / 2) * (i % 2 ? 1 : -1) * (Math.PI / 12);
    const x = key.x + Math.cos(a) * d;
    const z = key.z + Math.sin(a) * d;
    const p = collide(l, x, z);
    if (p.x !== x || p.z !== z) continue;
    if (Math.abs(x - bench.x) < BENCH.half + room && z > bench.z - BENCH.back - room && z < bench.z + BENCH.front + room) continue;
    if (posts.some(([px, pz]) => Math.hypot(x - px, z - pz) < room)) continue;
    return [x, 0, z];
  }
  // Every key spot has open ground round it (world.test.ts).
  throw new Error("No room beside the key");
}

type Rect = [minX: number, maxX: number, minZ: number, maxZ: number];

/** A strip of ground from (x, z) along the unit direction (dx, dz) for `len`, `half` wide either side of its middle line (m). */
interface Strip {
  x: number;
  z: number;
  dx: number;
  dz: number;
  len: number;
  half: number;
}

/** A round thing or place: its middle and radius (m). */
interface Round {
  x: number;
  z: number;
  r: number;
}

/** The stile's steps: its middle on the fence line, `half` their width either side, and `out` from the fence on each side (m). */
interface Steps {
  x: number;
  z: number;
  half: number;
  out: number;
}

/**
 * The ground past the back fence (#770), as lookout.ts backWay makes it. Shut:
 * brambles grown over the stile reach into the garden, a solid block. Open:
 * the stile's steps, with a handrail down each side; the way cut up the old
 * path; the hilltop; and the things that stand on it.
 */
export type BackWay = { open: false; brambles: Rect } | { open: true; stile: Steps; way: Strip; top: Round; things: Round[] };

/** Ground a walker's middle may be on: a rectangle, a strip or a disc. */
type Area = Rect | Strip | Round;

/** The nearest point to (x, z) in any of the areas: the walker slides along their edges. */
function nearestIn(areas: Area[], x: number, z: number): { x: number; z: number } {
  let best = { x, z };
  let bestD = Infinity;
  for (const a of areas) {
    const p = nearestOn(a, x, z);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) [best, bestD] = [p, d];
  }
  return best;
}

function nearestOn(a: Area, x: number, z: number): { x: number; z: number } {
  if (Array.isArray(a)) {
    const [x0, x1, z0, z1] = a;
    return { x: Math.max(x0, Math.min(x1, x)), z: Math.max(z0, Math.min(z1, z)) };
  }
  if ("r" in a) {
    const d = Math.hypot(x - a.x, z - a.z);
    return d <= a.r ? { x, z } : { x: a.x + ((x - a.x) * a.r) / d, z: a.z + ((z - a.z) * a.r) / d };
  }
  // Along the strip and across it (its left is (−dz, dx)), each kept in bounds.
  const t = Math.max(0, Math.min(a.len, (x - a.x) * a.dx + (z - a.z) * a.dz));
  const s = Math.max(-a.half, Math.min(a.half, -(x - a.x) * a.dz + (z - a.z) * a.dx));
  return { x: a.x + a.dx * t - a.dz * s, z: a.z + a.dz * t + a.dx * s };
}

/** The open back way's ground for a walker of radius `rad`: over the stile between its rails, up the cut way, and the hilltop. */
function backGround(b: Extract<BackWay, { open: true }>, rad: number): Area[] {
  const s = b.stile;
  // From the garden's edge to a little past the far foot, where the cut way starts clear of the rails' ends.
  const over: Rect = [s.x - s.half + rad, s.x + s.half - rad, s.z - s.out - rad - 0.05, s.z + rad];
  return [over, { ...b.way, half: b.way.half - rad }, { ...b.top, r: b.top.r - rad }];
}

/**
 * The stile's steps (#770): between the rails you go up and over. Walk into
 * their front or back with your middle within their width and you slide onto
 * them; a rail stops you from the side, and from on the steps.
 */
function onSteps(s: Steps, x: number, z: number, rad: number): { x: number; z: number } {
  const dx = x - s.x;
  const dz = z - s.z;
  const hw = s.half + rad;
  const hd = s.out + rad;
  if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) return { x, z };
  if (Math.abs(dx) < s.half) return { x: s.x + Math.max(rad - s.half, Math.min(s.half - rad, dx)), z };
  return outOfBox([s.x - s.half, s.x + s.half, s.z - s.out, s.z + s.out], x, z, rad);
}

/** Push a walker of radius `rad` out of a box along its shallowest side, as from a bed. */
function outOfBox([x0, x1, z0, z1]: Rect, x: number, z: number, rad: number): { x: number; z: number } {
  const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
  const hw = (x1 - x0) / 2 + rad;
  const hd = (z1 - z0) / 2 + rad;
  const dx = x - cx;
  const dz = z - cz;
  if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) return { x, z };
  return hw - Math.abs(dx) < hd - Math.abs(dz) ? { x: cx + Math.sign(dx || 1) * hw, z } : { x, z: cz + Math.sign(dz || 1) * hd };
}

/**
 * Keep a walker of radius `rad` inside the fence and out of beds and the pond.
 * Once the door is open (#315), the doorway and the orchard behind it are open
 * too, and its well stands in the way (#335 S6). `back` is the ground past the
 * back fence (#770): only the learner walks there, so the rest pass none.
 */
export function collide(l: Layout, x: number, z: number, rad = WALKER, doorOpen = false, back: BackWay | null = null): { x: number; z: number } {
  const b = l.bounds;
  const garden: Rect = [b.minX + rad, b.maxX - rad, b.minZ + rad, b.maxZ - rad];
  const o = l.orchard;
  const near = o.z - o.d / 2;
  const doorway: Rect = [l.gate.x - DOOR_HALF + rad, l.gate.x + DOOR_HALF - rad, b.maxZ - rad, near + rad];
  const orchard: Rect = [o.x - o.w / 2 + rad, o.x + o.w / 2 - rad, near + rad, o.z + o.d / 2 - rad];
  ({ x, z } = nearestIn([garden, ...(doorOpen ? [doorway, orchard] : []), ...(back?.open ? backGround(back, rad) : [])], x, z));
  for (const bed of l.beds) ({ x, z } = outOfBox([bed.x - bed.w / 2, bed.x + bed.w / 2, bed.z - bed.d / 2, bed.z + bed.d / 2], x, z, rad));
  if (back?.open === false) ({ x, z } = outOfBox(back.brambles, x, z, rad));
  if (back?.open) {
    ({ x, z } = onSteps(back.stile, x, z, rad));
    for (const t of back.things) ({ x, z } = outOf(t, x, z, rad));
  }
  ({ x, z } = outOf(l.pond, x, z, rad));
  return doorOpen ? outOf(l.well, x, z, rad) : { x, z };
}

/** Push a walker of radius `rad` out of a round thing (the pond, the well) the shortest way. */
function outOf(c: { x: number; z: number; r: number }, x: number, z: number, rad: number): { x: number; z: number } {
  const dx = x - c.x;
  const dz = z - c.z;
  const d = Math.hypot(dx, dz);
  const min = c.r + rad;
  if (d >= min) return { x, z };
  // At its very middle (a tap on the diary's stone, #858) no way out is shortest: out toward +z, the way back to the garden.
  if (d === 0) return { x, z: z + min };
  const k = min / d;
  return { x: c.x + dx * k, z: c.z + dz * k };
}

/**
 * Move a walker from (x, z) toward (toX, toZ), in short pieces through collide,
 * and round the orchard's trunks (`trees`: none while the door is shut), and
 * past the back fence on the `back` way (#770).
 * collide sees only where a move ends: one long move (a ctrl+wheel step is 2 m)
 * could end past the hedge's middle and land in the orchard, beside the door (#315).
 */
export function walk(l: Layout, x: number, z: number, toX: number, toZ: number, doorOpen: boolean, trees: readonly PlacedTree[], back: BackWay | null): { x: number; z: number } {
  const n = Math.max(1, Math.ceil(Math.hypot(toX - x, toZ - z) / 0.25));
  const [dx, dz] = [(toX - x) / n, (toZ - z) / n];
  for (let i = 0; i < n; i++) {
    ({ x, z } = collide(l, x + dx, z + dz, WALKER, doorOpen, back));
    ({ x, z } = collideTrees(trees, x, z, WALKER));
  }
  return { x, z };
}

/** How far into the doorway's ends a route steps: clear of the hedge on either side. */
const DOOR_STEP = 0.5;

/**
 * The way to a spot in the garden from (x, z): straight there from the garden;
 * from the orchard or its doorway (#315), out through the door first, so a
 * glide never goes through the hedge. From past the back fence (#770), back
 * down the cut way and over the stile. Corners in order, from (x, z) to the spot.
 */
export function route(l: Layout, x: number, z: number, toX: number, toZ: number, back: BackWay | null): [number, number][] {
  if (back?.open && z < back.stile.z + WALKER) {
    const { stile: s, way: w } = back;
    const out: [number, number][] = [[x, z]];
    // On the hilltop, first to where the cut way meets it; then to the cut way's start, and over.
    if ((x - w.x) * w.dx + (z - w.z) * w.dz > w.len - back.top.r) out.push(wayPoint(w, w.len - back.top.r));
    out.push([w.x, w.z], [s.x, s.z + s.out + DOOR_STEP], [toX, toZ]);
    return out;
  }
  if (z <= l.bounds.maxZ) return [[x, z], [toX, toZ]];
  const out: [number, number][] = [[x, z]];
  const near = l.orchard.z - l.orchard.d / 2;
  // In the orchard: first to just inside the door.
  if (z > near) out.push([l.gate.x, near + DOOR_STEP]);
  out.push([l.gate.x, l.bounds.maxZ - DOOR_STEP], [toX, toZ]);
  return out;
}

/** The point `t` along a strip's middle line. */
function wayPoint(w: Strip, t: number): [number, number] {
  return [w.x + w.dx * t, w.z + w.dz * t];
}

/** How far apart a leg past the back fence is checked for ground to stand on (m): less than a bramble's edge could cut off. */
const BACK_STEP = 0.05;

/** How far from a bed's corner, the pond or a trunk a way on foot turns: a little more than a walker's radius, so its legs pass clear. */
const TURN_CLEAR = WALKER + 0.12;
/** A leg must clear things by a hair less than a walker's radius: a walker that collide pushed against a bed stands exactly a radius from it. */
const LEG_CLEAR = WALKER - 0.01;

/** Does the segment a→b pass through the rectangle (grown by `pad`)? Touching its edge does not count. */
function crossesRect(ax: number, az: number, bx: number, bz: number, [x0, x1, z0, z1]: Rect, pad: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const d = [bx - ax, bz - az];
  const o = [ax, az];
  const lo = [x0 - pad, z0 - pad];
  const hi = [x1 + pad, z1 + pad];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (o[i] <= lo[i] || o[i] >= hi[i]) return false;
      continue;
    }
    let n = (lo[i] - o[i]) / d[i];
    let f = (hi[i] - o[i]) / d[i];
    if (n > f) [n, f] = [f, n];
    t0 = Math.max(t0, n);
    t1 = Math.min(t1, f);
    if (t1 - t0 <= 1e-9) return false;
  }
  return true;
}

/** The distance from (x, z) to the segment a→b. */
function toSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len = dx * dx + dz * dz;
  const k = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
  return Math.hypot(x - ax - dx * k, z - az - dz * k);
}

/**
 * The way on foot to a spot (#336, tap to walk): the shortest line of corners
 * round the beds, the pond, the hedge (through the door when it is open), the
 * orchard's well and its trunks, from (x, z) to (toX, toZ); past the back fence
 * (#770), over the stile, up the cut way and round the hilltop's things.
 * Both ends must be where a walker may stand (collide, collideTrees). Straight
 * there when nothing is in the way, which is most taps. Corners in order, from
 * (x, z) to the spot.
 */
export function wayTo(l: Layout, x: number, z: number, toX: number, toZ: number, doorOpen: boolean, trees: readonly PlacedTree[], back: BackWay | null): [number, number][] {
  const near = l.orchard.z - l.orchard.d / 2;
  const [h0, h1] = hedgeSpan(l);
  const rects: Rect[] = [
    ...l.beds.map((b): Rect => [b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2]),
    // The hedge, either side of the door; across it too while the door is shut.
    ...(doorOpen
      ? [[h0, l.gate.x - DOOR_HALF, l.bounds.maxZ, near] as Rect, [l.gate.x + DOOR_HALF, h1, l.bounds.maxZ, near] as Rect]
      : [[h0, h1, l.bounds.maxZ, near] as Rect]),
    // The brambles over the shut stile (#770).
    ...(back?.open === false ? [back.brambles] : []),
  ];
  const rounds = [l.pond, ...(doorOpen ? [l.well] : []), ...trees.map((t) => ({ x: t.x, z: t.z, r: t.trunk })), ...(back?.open ? back.things : [])];
  const free = (px: number, pz: number) => {
    const p = collide(l, px, pz, WALKER, doorOpen, back);
    const q = collideTrees(trees, p.x, p.z, WALKER);
    return Math.hypot(q.x - px, q.z - pz) < 1e-9;
  };
  // Past the back fence the ground is a strip and a disc, not boxes to go round: a leg that reaches the stile's steps is walked in short checks.
  const steps = back?.open ? back.stile : null;
  const backClear = (ax: number, az: number, bx: number, bz: number) => {
    if (!steps || Math.min(az, bz) >= steps.z + steps.out + WALKER) return true;
    // Through the fence only between the rails: most legs that cross it fail here, before the checks.
    if ((az - steps.z) * (bz - steps.z) < 0 && Math.abs(ax + ((bx - ax) * (steps.z - az)) / (bz - az) - steps.x) > steps.half - WALKER + 1e-9) return false;
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / BACK_STEP);
    for (let i = 1; i < n; i++) if (!free(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)) return false;
    return true;
  };
  const clear = (ax: number, az: number, bx: number, bz: number) =>
    rects.every((r) => !crossesRect(ax, az, bx, bz, r, LEG_CLEAR)) && rounds.every((c) => toSegment(c.x, c.z, ax, az, bx, bz) >= c.r + LEG_CLEAR) && backClear(ax, az, bx, bz);
  if (clear(x, z, toX, toZ)) return [[x, z], [toX, toZ]];

  // Turning points: just off every corner, and round every round thing; only those a walker may stand on.
  const points: [number, number][] = [[x, z], [toX, toZ]];
  // Over the open stile: in front of its steps, at the cut way's start, and where the cut way meets the hilltop.
  if (back?.open) points.push([back.stile.x, back.stile.z + back.stile.out + TURN_CLEAR], [back.way.x, back.way.z], wayPoint(back.way, back.way.len - back.top.r));
  for (const [x0, x1, z0, z1] of rects)
    for (const px of [x0 - TURN_CLEAR, x1 + TURN_CLEAR]) for (const pz of [z0 - TURN_CLEAR, z1 + TURN_CLEAR]) if (free(px, pz)) points.push([px, pz]);
  // Eight points round a circle, far enough out that the octagon's sides clear it too.
  for (const c of rounds)
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r = (c.r + TURN_CLEAR) / Math.cos(Math.PI / 8);
      if (free(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r)) points.push([c.x + Math.cos(a) * r, c.z + Math.sin(a) * r]);
    }

  // Dijkstra over the points, joined where a straight leg is clear.
  const n = points.length;
  const dist = new Array<number>(n).fill(Infinity);
  const from = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    // Every spot a walker may stand on is reachable from every other (world.test.ts): no way means a bug, so say so.
    if (u < 0) throw new Error(`no way on foot from ${x.toFixed(2)},${z.toFixed(2)} to ${toX.toFixed(2)},${toZ.toFixed(2)}`);
    if (u === 1) break;
    done[u] = true;
    const [ux, uz] = points[u];
    for (let v = 0; v < n; v++) {
      if (done[v]) continue;
      const d = dist[u] + Math.hypot(points[v][0] - ux, points[v][1] - uz);
      if (d < dist[v] && clear(ux, uz, points[v][0], points[v][1])) {
        dist[v] = d;
        from[v] = u;
      }
    }
  }
  const way: [number, number][] = [];
  for (let i = 1; i >= 0; i = from[i]) way.unshift(points[i]);
  return way;
}

/** A walk to a tapped spot under way (#336): its way (wayTo), the corner it heads for, how far short of the end it stops (m), and seconds without headway. */
export interface Trip {
  way: [number, number][];
  leg: number;
  stop: number;
  stuck: number;
}

/**
 * A walk that makes no headway for this long (s) has stalled: something holds
 * it that wayTo did not plan round. That should never happen, so it is
 * reported; the walk ends rather than walk into a wall for ever.
 * @internal Exported for tests.
 */
export const TRIP_STUCK = 0.5;

/**
 * One frame of a walk: the walker at `at` moves up to `metres` toward the
 * trip's next corner, through walk()'s collisions (`at` is updated in place).
 * "arrived" within `stop` of the end, "stalled" after TRIP_STUCK seconds
 * without headway, else "walking".
 */
export function walkStep(l: Layout, t: Trip, at: { x: number; z: number }, metres: number, dt: number, doorOpen: boolean, trees: readonly PlacedTree[], back: BackWay | null): "walking" | "arrived" | "stalled" {
  const [cx, cz] = t.way[t.leg];
  const last = t.leg === t.way.length - 1;
  const gap = Math.hypot(cx - at.x, cz - at.z);
  const left = gap - (last ? t.stop : 0);
  if (left < 1e-3) {
    if (last) return "arrived";
    t.leg++;
    return "walking";
  }
  const step = Math.min(left, metres);
  const k = step / gap;
  const x0 = at.x;
  const z0 = at.z;
  ({ x: at.x, z: at.z } = walk(l, x0, z0, x0 + (cx - x0) * k, z0 + (cz - z0) * k, doorOpen, trees, back));
  t.stuck = Math.hypot(at.x - x0, at.z - z0) < step / 4 ? t.stuck + dt : 0;
  return t.stuck > TRIP_STUCK ? "stalled" : "walking";
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
