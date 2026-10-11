// Layout of the walkable garden: words are planted in raised beds, one kind
// of word per row of beds (nouns, verbs, …), the most common words nearest
// the gate. Pure functions, so the layout is stable and testable.

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
}

export interface PlacedPlant extends GardenPlant {
  x: number;
  z: number;
  /** Lean in radians as recall fades. Never more than ~18°, nothing ever dies. */
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
}

export const SPACING = 0.62;
export const BED_COLS = 6;
export const BED_ROWS = 5;
const MARGIN = 0.32;
export const BED_W = BED_COLS * SPACING + MARGIN * 2;
export const BED_D = BED_ROWS * SPACING + MARGIN * 2;
const PATH = 1.9;
const CAPACITY = BED_COLS * BED_ROWS;

const GROUPS: { label: string; pos: string[] }[] = [
  { label: "Nouns", pos: ["noun"] },
  { label: "Verbs", pos: ["verb"] },
  { label: "Adjectives", pos: ["adj", "adjective"] },
  { label: "Adverbs", pos: ["adv", "adverb"] },
  { label: "Small words", pos: ["pron", "prep", "conj", "det", "num", "particle", "pronoun", "preposition", "conjunction", "determiner", "article", "number"] },
  { label: "Phrases", pos: ["phrase"] },
];
const OTHER = "Other words";

export function groupOf(pos: string): string {
  const p = pos.trim().toLowerCase();
  return GROUPS.find((g) => g.pos.includes(p))?.label ?? OTHER;
}

export function hash(str: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Same lean as the 2D garden: a hint below 90% recall, capped at 18°. */
export function droopFor(id: string, r: number): number {
  const dir = hash(id, 9) > 0.5 ? 1 : -1;
  return dir * Math.max(0, Math.min(1, (0.9 - r) / 0.4)) * ((18 * Math.PI) / 180);
}

export const THIRSTY = 0.85;

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
        const jx = (hash(p.id, 1) - 0.5) * 0.2;
        const jz = (hash(p.id, 2) - 0.5) * 0.2;
        placed.push({
          ...p,
          x: x - BED_W / 2 + MARGIN + (c + 0.5) * SPACING + jx,
          z: z + BED_D / 2 - MARGIN - (rr + 0.5) * SPACING + jz,
          droop: droopFor(p.id, p.r),
          phase: hash(p.id, 3) * Math.PI * 2,
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
  };
}

/** Keep a walker of radius `rad` inside the fence and out of beds and the pond. */
export function collide(l: Layout, x: number, z: number, rad = 0.28): { x: number; z: number } {
  const b = l.bounds;
  x = Math.max(b.minX + rad, Math.min(b.maxX - rad, x));
  z = Math.max(b.minZ + rad, Math.min(b.maxZ - rad, z));
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

/** Where to stand to look at a plant: on the path in front of its bed. */
export function viewpoint(l: Layout, p: PlacedPlant): { x: number; z: number; yaw: number } {
  const bed = l.beds[p.bed];
  const z = bed.z + bed.d / 2 + 1.45;
  const x = p.x;
  const yaw = Math.atan2(-(p.x - x), -(p.z - z)); // forward is -z at yaw 0
  return { x, z, yaw };
}
