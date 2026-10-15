// The old orchard behind the hedge (#315): one fruit tree per orchard word the
// learner has started. Size comes from time (days since the word was planted),
// the look from memory (leaves while learning, blossom once known, then fruit).
// A forgotten word's tree never shrinks: it only rests without fruit until the
// word is remembered again. Everything follows from the reviews, like plants;
// nothing is stored. Pure functions, so the orchard is the same on every device.

import { DAY_MS, daily, rareDay } from "../core/day";
import { plantStage, type MemoryRow } from "../core/memory";
import type { Learner, Word } from "../data/learner";
import { ORCHARD_WORDS, type GardenWord, type OrchardWord } from "../deck/schema";
import { hash01 } from "../lib/seed";
import { CELL_H_PX, CELL_W, crownBox, TREE_SHAPES } from "./orchardArt";
import { rayBox, type Ray } from "./scenery";
import { MONTHS } from "./whimsy";

/** Read stability (days) at which a known word's tree bears fruit; below it a known word's tree is in blossom. */
export const FRUIT_S = 21;

export type TreeLook = "leaves" | "blossom" | "fruit";

/** One started orchard word, as the reviews tell it. */
export interface OrchardInput {
  id: string;
  lemma: string;
  gloss: string;
  kind: OrchardWord;
  /** The word's first reading review (ms). */
  planted: number;
  read: Pick<MemoryRow, "s" | "reps" | "lapses">;
}

/** A word's tree: what it is and how big it has grown. */
export interface OrchardTree {
  id: string;
  lemma: string;
  gloss: string;
  kind: OrchardWord;
  planted: number;
  /** Drawn height in metres, from the ground to the top of the crown. */
  height: number;
  look: TreeLook;
}

/** How tall each kind grows next to the others. */
const TREE_SIZE: Record<OrchardWord, number> = {
  // A plain big tree: the tallest in the orchard.
  tree: 1.3,
  apple: 1,
  orange: 0.95,
  lemon: 0.9,
  cherry: 1,
  pear: 1.05,
  plum: 0.95,
  fig: 0.9,
  olive: 0.9,
  // A vine on a low trellis.
  grape: 0.55,
  peach: 0.95,
};
/** A tree sprite at scale 1, in metres: one atlas cell (orchardArt.ts), 2 m tall. */
export const SPRITE_M = { w: (CELL_W / CELL_H_PX) * 2, h: 2 };

/** Height from age: quick at first, then slower (√days), full size at about five months. */
const AGE_H = { start: 0.8, perRootDay: 0.22, max: 3.6 };
/** A little extra for each time the word was remembered, up to a limit. */
const REMEMBERED_H = { each: 0.05, max: 0.5 };

/**
 * A tree's height in metres. It only ever grows: more days or more remembered
 * reviews never make it smaller, and a forgotten review adds nothing but takes nothing.
 */
export function treeHeight(kind: OrchardWord, days: number, remembered: number): number {
  const age = Math.min(AGE_H.max, AGE_H.start + AGE_H.perRootDay * Math.sqrt(days));
  const boost = Math.min(REMEMBERED_H.max, REMEMBERED_H.each * remembered);
  return (age + boost) * TREE_SIZE[kind];
}

/** The tree's look from the word's reading memory: leaves while learning, blossom once known, fruit once well known. */
export function treeLook(read: Pick<MemoryRow, "s" | "reps">): TreeLook {
  if (plantStage(read) !== "bloom") return "leaves";
  return read.s >= FRUIT_S ? "fruit" : "blossom";
}

/** The orchard's trees at `now`, in ORCHARD_WORDS order. */
export function orchardTrees(input: readonly OrchardInput[], now: number): OrchardTree[] {
  return input
    .map((w): OrchardTree => {
      // Another device's clock can put the first review a little in the future: that tree is new today.
      const days = Math.max(0, (now - w.planted) / DAY_MS);
      // Every review is a lapse (grade 1) or a remembered one (fsrs.ts replay).
      const remembered = w.read.reps - w.read.lapses;
      return { id: w.id, lemma: w.lemma, gloss: w.gloss, kind: w.kind, planted: w.planted, height: treeHeight(w.kind, days, remembered), look: treeLook(w.read) };
    })
    .sort((a, b) => ORCHARD_WORDS.indexOf(a.kind) - ORCHARD_WORDS.indexOf(b.kind));
}

/** What orchardInput reads from the learner. */
export type OrchardLearner = Pick<Learner, "memories" | "reviewsByWord"> & {
  words: ReadonlyMap<string, Pick<Word, "id" | "lemma" | "gloss" | "status" | "orchard">>;
};

/** Every started orchard word, from the learner's reviews, like plantsFromLearner. */
export function orchardInput(l: OrchardLearner): OrchardInput[] {
  const out: OrchardInput[] = [];
  for (const m of l.memories) {
    const w = l.words.get(m.wordId);
    if (m.skill !== "read" || !w?.orchard || w.status === "ignored" || m.reps === 0) continue;
    // A read memory comes from read reviews, so the word has at least one.
    const planted = Math.min(...l.reviewsByWord.get(w.id)!.filter((r) => r.skill === "read").map((r) => Date.parse(r.reviewed_at)));
    out.push({ id: w.id, lemma: w.lemma, gloss: w.gloss, kind: w.orchard, planted, read: m });
  }
  return out;
}

// ---- Placement ----

/** The orchard inside its hedge: the middle (x, z), width along x and depth along z. The door is in the middle of its side toward the garden (DOOR_SIDE). */
export interface OrchardArea {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** Which way along z the door is, from anywhere in the orchard: the garden lies toward −z (world.ts layout). Everything placed from the door follows this one sign. */
const DOOR_SIDE = -1;

/** The z of a line `m` metres in from the door's side of the area. */
function inFromDoor(a: OrchardArea, m: number): number {
  return a.z + DOOR_SIDE * (a.d / 2 - m);
}

/** Room between tree rows and columns, the path up the middle from the door, and the strip inside the door kept for the bench. */
export const ORCHARD_SPACING = 4;
const AISLE = 2;
const FRONT = 2.2;
/** How far a tree may sit off its spot, so the rows look planted by hand. */
const JITTER = 0.2;

/** The smallest area that holds a tree of every kind: two columns each side of the path, three rows. */
export const ORCHARD_MIN = { w: AISLE + 4 * ORCHARD_SPACING, d: 3 * ORCHARD_SPACING + FRONT };

export interface PlacedTree extends OrchardTree {
  x: number;
  z: number;
  /** The sprite's scale (SPRITE_M at 1). */
  scale: number;
  /** Half the crown's width in metres: the tree's footprint and hit box. */
  half: number;
  /** Half the trunk's width in metres, for walking into it. */
  trunk: number;
  /** Sway phase, so trees do not move together. */
  phase: number;
}

/** The planting spots, front rows first and nearest the path first, so every course has the same orchard. */
function slots(a: OrchardArea): [number, number][] {
  const perSide = Math.floor((a.w / 2 - AISLE / 2) / ORCHARD_SPACING);
  const rows = Math.floor((a.d - FRONT) / ORCHARD_SPACING);
  const out: [number, number][] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < perSide; c++)
      for (const s of [-1, 1]) out.push([a.x + s * (AISLE / 2 + (c + 0.5) * ORCHARD_SPACING), inFromDoor(a, FRONT + (r + 0.5) * ORCHARD_SPACING)]);
  return out;
}

/** Each kind's spot: the first spots, shared out by a hash of the kind, so a tree never moves when another is planted. */
const SPOT: Record<OrchardWord, number> = Object.fromEntries(
  [...ORCHARD_WORDS].sort((a, b) => hash01(a, 31) - hash01(b, 31)).map((k, i) => [k, i]),
) as Record<OrchardWord, number>;

/** Where each tree stands in the area: rows either side of the path from the door, one fixed spot per kind. */
export function placeTrees(area: OrchardArea, trees: readonly OrchardTree[]): PlacedTree[] {
  const spots = slots(area);
  if (spots.length < ORCHARD_WORDS.length) throw new Error(`the orchard needs at least ${ORCHARD_MIN.w}×${ORCHARD_MIN.d} m, got ${area.w}×${area.d}`);
  const seen = new Set<OrchardWord>();
  return trees.map((t) => {
    // The deck allows one word per kind (deckProblems); two would share a spot.
    if (seen.has(t.kind)) throw new Error(`two orchard words of kind "${t.kind}"`);
    seen.add(t.kind);
    const [sx, sz] = spots[SPOT[t.kind]];
    const art = crownBox(t.kind);
    const scale = t.height / (SPRITE_M.h * art.top);
    return {
      ...t,
      x: sx + (hash01(t.kind, 32) - 0.5) * 2 * JITTER,
      z: sz + (hash01(t.kind, 33) - 0.5) * 2 * JITTER,
      scale,
      half: art.half * SPRITE_M.w * scale,
      trunk: (TREE_SHAPES[t.kind].trunk.w / 2 / CELL_W) * SPRITE_M.w * scale,
      phase: hash01(t.kind, 34) * Math.PI * 2,
    };
  });
}

/** Keep a walker of radius `rad` out of the trunks, as wide as they are drawn: you walk under a crown, not through a trunk. */
export function collideTrees(trees: readonly PlacedTree[], x: number, z: number, rad: number): { x: number; z: number } {
  for (const t of trees) {
    const min = t.trunk + rad;
    const dx = x - t.x;
    const dz = z - t.z;
    const d = Math.hypot(dx, dz);
    if (d >= min) continue;
    // Exactly on the trunk's middle there is no direction to push: step out toward the door.
    if (d === 0) z = t.z + DOOR_SIDE * min;
    else {
      x = t.x + (dx * min) / d;
      z = t.z + (dz * min) / d;
    }
  }
  return { x, z };
}

// ---- Tapping a tree ----

/** A tree's hit box: its crown and trunk. Its tag sits just over the crown. */
export interface TreeHit {
  /** The word's id. */
  id: string;
  min: [number, number, number];
  max: [number, number, number];
  tag: [number, number, number];
}

export function treeHits(trees: readonly PlacedTree[]): TreeHit[] {
  return trees.map((t) => ({ id: t.id, min: [t.x - t.half, 0, t.z - t.half], max: [t.x + t.half, t.height, t.z + t.half], tag: [t.x, t.height + 0.08, t.z] }));
}

/** The tree a ray meets first, and how far along the ray, or null. */
export function pickTree(r: Ray, hits: readonly TreeHit[]): { hit: TreeHit; t: number } | null {
  let best: TreeHit | null = null;
  let bestT = Infinity;
  for (const h of hits) {
    const t = rayBox(r, h.min, h.max);
    if (t >= bestT) continue;
    best = h;
    bestT = t;
  }
  return best && { hit: best, t: bestT };
}

// ---- The bench and the visitors ----

/**
 * The bench just inside the door, on your right as you come in, its back to the door.
 * `turn` as three's rotation.y of a bench whose seat faces +z (its back toward −z).
 */
export function orchardBench(a: OrchardArea): { x: number; z: number; turn: number } {
  // Coming in, you face away from the door; your right is +x when you face −z. Turn 0 puts its back toward −z, the door's side (DOOR_SIDE).
  return { x: a.x + DOOR_SIDE * (AISLE / 2 + 0.9), z: inFromDoor(a, 1), turn: 0 };
}

/** The bench's plaque, e.g. "First word planted 3 Oct 2026". */
export function benchLine(firstPlanted: number): string {
  const d = new Date(firstPlanted);
  return `First word planted ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Garden visitors that like trees. */
export const TREE_VISITORS = ["bird", "owl", "squirrel", "bee"] as const satisfies readonly GardenWord[];
export type TreeVisitor = (typeof TREE_VISITORS)[number];

/** Where a visitor sits, in metres: on the ground for the squirrel, in or by the crown for the others. */
export interface TreeVisitorSpot {
  who: TreeVisitor;
  /** The tree's word id. */
  tree: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Which brought visitors sit in the orchard today, and where. Each comes on
 * about one day in two, to a tree chosen for the day; the bee only to a tree in
 * blossom or fruit. A little toward the door, so from the door side the tree's sprite does not hide it.
 */
export function treeVisitorSpots(trees: readonly PlacedTree[], brought: ReadonlySet<GardenWord>, now: Date): TreeVisitorSpot[] {
  const out: TreeVisitorSpot[] = [];
  for (const who of TREE_VISITORS) {
    if (!brought.has(who) || !rareDay(2, `orchard:${who}`, now)) continue;
    const pool = who === "bee" ? trees.filter((t) => t.look !== "leaves") : trees;
    if (!pool.length) continue;
    const t = daily(pool, `orchard:${who}`, now);
    // dz: toward the door.
    const [dx, fy, dz] = who === "bird" ? [t.half * 0.5, 0.8, 0.3] : who === "owl" ? [-t.half * 0.3, 0.55, 0.3] : who === "squirrel" ? [0.35, 0, 0.35] : [-t.half * 0.7, 0.5, 0.4];
    out.push({ who, tree: t.id, x: t.x + dx, y: t.height * fy, z: t.z + DOOR_SIDE * dz });
  }
  return out;
}
