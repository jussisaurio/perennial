// The garden itself teaches (#74): the sunflower, the trees, the fence, the
// pond, the sky... each is a word in the course language, with its article.
// Unlike visitors, scenery never shows a tag on approach: you tap it, and its
// tag shows for a moment (and with sound on, it says its word). Scenery words
// never join reviews, stats, the Words list, Next plant or the summary.
// Pure data and hit tests, so they are easy to test. The scene builds the hit
// volumes once; a tap casts one ray through them.

import { nounLemma, nounView, type NounDef, type NounView } from "./nouns";

export type SceneryId =
  | "sunflower"
  | "tree"
  | "pine"
  | "cherry"
  | "bush"
  | "fence"
  | "gate"
  | "bench"
  | "pond"
  | "lily"
  | "lantern"
  | "sign"
  | "bed"
  | "path"
  | "grass"
  | "flower"
  | "stone"
  | "hills"
  | "cloud"
  | "sun"
  | "moon"
  | "sky";

/** Spain Spanish; plain nouns, not species names. Signs and notice boards are all "el letrero". */
export const SCENERY: Record<SceneryId, NounDef> = {
  sunflower: { words: { es: "el girasol", de: "die Sonnenblume" }, gloss: "sunflower" },
  // The round, leafy trees outside the fence.
  tree: { words: { es: "el árbol", de: "der Baum" }, gloss: "tree" },
  pine: { words: { es: "el pino", de: "die Kiefer" }, gloss: "pine" },
  // The pink blossom trees.
  cherry: { words: { es: "el cerezo", de: "der Kirschbaum" }, gloss: "cherry tree" },
  bush: { words: { es: "el arbusto", de: "der Busch" }, gloss: "bush" },
  fence: { words: { es: "la valla", de: "der Zaun" }, gloss: "fence" },
  gate: { words: { es: "la puerta", de: "das Tor" }, gloss: "gate" },
  bench: { words: { es: "el banco", de: "die Bank" }, gloss: "bench" },
  pond: { words: { es: "el estanque", de: "der Teich" }, gloss: "pond" },
  lily: { words: { es: "el nenúfar", de: "die Seerose" }, gloss: "water lily" },
  lantern: { words: { es: "el farol", de: "die Laterne" }, gloss: "lantern" },
  sign: { words: { es: "el letrero", de: "das Schild" }, gloss: "sign" },
  bed: { words: { es: "el bancal", de: "das Beet" }, gloss: "flower bed" },
  path: { words: { es: "el camino", de: "der Weg" }, gloss: "path" },
  grass: { words: { es: "la hierba", de: "das Gras" }, gloss: "grass" },
  // The wildflowers outside the fence.
  flower: { words: { es: "la flor", de: "die Blume" }, gloss: "flower" },
  stone: { words: { es: "la piedra", de: "der Stein" }, gloss: "stone" },
  hills: { words: { es: "las colinas", de: "die Hügel" }, gloss: "hills", lemma: { es: "colina", de: "Hügel" } },
  cloud: { words: { es: "la nube", de: "die Wolke" }, gloss: "cloud" },
  sun: { words: { es: "el sol", de: "die Sonne" }, gloss: "sun" },
  moon: { words: { es: "la luna", de: "der Mond" }, gloss: "moon" },
  sky: { words: { es: "el cielo", de: "der Himmel" }, gloss: "sky" },
};

/** A scenery word as the garden shows it. */
export interface SceneryView extends NounView {
  id: SceneryId;
  /** Article and noun, e.g. "el girasol". */
  word: string;
}

export type SceneryViews = Partial<Record<SceneryId, SceneryView>>;

/** The deck lemma behind a scenery word: the noun after the article, or the singular for a plural. */
export const sceneryLemma = (id: SceneryId, lang: string): string | null => nounLemma(SCENERY[id], lang);

/** Every scenery word for this course (none for a course without them). `isKnown` gets the bare lemma ("sol", not "el sol"). */
export function sceneryViews(lang: string, isKnown: (lemma: string) => boolean = () => false): SceneryViews {
  const out: SceneryViews = {};
  for (const id of Object.keys(SCENERY) as SceneryId[]) {
    const v = nounView(SCENERY[id], lang, isKnown);
    if (v.word) out[id] = { ...v, id, word: v.word };
  }
  return out;
}

// ---- Hit tests ----

/** A ray from the eye: origin and unit direction. */
export interface Ray {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

/**
 * A box. `tag`: where its tag sits; null puts it over the point you tapped,
 * just above the box. `turn`: the box is turned this much round the vertical
 * axis through its middle (like three's rotation.y); min and max are before the turn.
 */
export interface HitBox {
  id: SceneryId;
  min: [number, number, number];
  max: [number, number, number];
  tag: [number, number, number] | null;
  turn?: number;
}

/** The ray in a turned box's own frame (the box turned back by `turn` round its middle). */
export function unturn(r: Ray, b: HitBox): Ray {
  if (!b.turn) return r;
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const c = Math.cos(b.turn);
  const sn = Math.sin(b.turn);
  const x = r.ox - cx;
  const z = r.oz - cz;
  return { ox: cx + c * x - sn * z, oy: r.oy, oz: cz + sn * x + c * z, dx: c * r.dx - sn * r.dz, dy: r.dy, dz: sn * r.dx + c * r.dz };
}

/** A flat, level disc (the pond, a lily pad). Its tag sits over its middle at `tagY`. */
export interface HitDisc {
  id: SceneryId;
  x: number;
  y: number;
  z: number;
  r: number;
  tagY: number;
}

/** Distance along the ray to the box, or Infinity when it misses (slab test). */
export function rayBox(r: Ray, min: readonly number[], max: readonly number[]): number {
  let t0 = 0;
  let t1 = Infinity;
  const o = [r.ox, r.oy, r.oz];
  const d = [r.dx, r.dy, r.dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < min[a] || o[a] > max[a]) return Infinity;
      continue;
    }
    let n = (min[a] - o[a]) / d[a];
    let f = (max[a] - o[a]) / d[a];
    if (n > f) [n, f] = [f, n];
    t0 = Math.max(t0, n);
    t1 = Math.min(t1, f);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Distance along the ray to a level disc, or Infinity. */
export function rayDisc(r: Ray, x: number, y: number, z: number, rad: number): number {
  if (Math.abs(r.dy) < 1e-9) return Infinity;
  const t = (y - r.oy) / r.dy;
  if (t <= 0) return Infinity;
  return Math.hypot(r.ox + r.dx * t - x, r.oz + r.dz * t - z) <= rad ? t : Infinity;
}

/**
 * Distance along the ray to an upright rectangle that faces the world's
 * vertical axis (a cloud: a plane turned to look at the middle), or Infinity.
 */
export function rayCloud(r: Ray, cx: number, cy: number, cz: number, halfW: number, halfH: number): number {
  const len = Math.hypot(cx, cz) || 1;
  const nx = -cx / len;
  const nz = -cz / len;
  const den = r.dx * nx + r.dz * nz;
  if (Math.abs(den) < 1e-9) return Infinity;
  const t = ((cx - r.ox) * nx + (cz - r.oz) * nz) / den;
  if (t <= 0) return Infinity;
  const px = r.ox + r.dx * t - cx;
  const py = r.oy + r.dy * t - cy;
  const pz = r.oz + r.dz * t - cz;
  // Across: the horizontal direction in the plane.
  const across = px * -nz + pz * nx;
  return Math.abs(across) <= halfW && Math.abs(py) <= halfH ? t : Infinity;
}

/** The far hills: a ring round the world's middle, textured `repeat` times round. */
export interface HillRing {
  radius: number;
  bottom: number;
  top: number;
  /** The ridge's texture row (0 = top) per texture column. */
  profile: readonly number[];
  /** The texture's height in rows. */
  rows: number;
  repeat: number;
}

/** The height of the ridge at the ring's angle `theta` (atan2(x, z), as three's cylinder uses it). */
export function hillTopY(h: HillRing, theta: number): number {
  const u = (((theta / (Math.PI * 2)) % 1) + 1) % 1;
  const col = Math.floor((u * h.repeat * h.profile.length) % h.profile.length);
  return h.top - (h.profile[col] / h.rows) * (h.top - h.bottom);
}

/** Does the ray, from inside the ring, meet the hills below their ridge? Returns the point, or null. */
export function rayHills(r: Ray, h: HillRing): [number, number, number] | null {
  const a = r.dx * r.dx + r.dz * r.dz;
  if (a < 1e-9) return null;
  const b = 2 * (r.ox * r.dx + r.oz * r.dz);
  const c = r.ox * r.ox + r.oz * r.oz - h.radius * h.radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b + Math.sqrt(disc)) / (2 * a);
  if (t <= 0) return null;
  const x = r.ox + r.dx * t;
  const y = r.oy + r.dy * t;
  const z = r.oz + r.dz * t;
  if (y < h.bottom || y > hillTopY(h, Math.atan2(x, z))) return null;
  return [x, y, z];
}

/** Everything a tap can meet, built once with the garden (the clouds move, so they are read at tap time). */
export interface SceneryWorld {
  boxes: readonly HitBox[];
  discs: readonly HitDisc[];
  /** Inside the fence the ground is path; outside it is grass. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Things further than this are lost in the fog: only the hills and the sky are named there. */
  far: number;
  hills: HillRing;
  /** Unit vector toward the sun (or the moon at night). */
  sunDir: { x: number; y: number; z: number };
  night: boolean;
  /** The sun's (or moon's) disc, as an angle from its middle (radians). */
  sunRadius: number;
  clouds: readonly { x: number; y: number; z: number }[];
  cloudHalf: [number, number];
}

/** What a tap met: the thing, and where its tag sits. `follow` keeps the tag on something that moves. */
export interface SceneryHit {
  id: SceneryId;
  x: number;
  y: number;
  z: number;
  follow: "sun" | { cloud: number } | null;
}

/** How far over the sun's middle its tag sits, as a fraction of its distance. */
export const SUN_TAG = 0.03;
/** The tag sits this far over the top of a cloud's middle. */
export const CLOUD_TAG = 5;

/**
 * The scenery a ray meets first. Things in the garden (boxes, discs and the
 * ground) come first; past the fog, a cloud, the sun or moon, the hills, and
 * at last the sky. `has` drops things this course has no word for.
 */
export function pickScenery(r: Ray, w: SceneryWorld, has: (id: SceneryId) => boolean = () => true): SceneryHit | null {
  let best: SceneryHit | null = null;
  let bestT = w.far;
  for (const b of w.boxes) {
    if (!has(b.id)) continue;
    const t = rayBox(unturn(r, b), b.min, b.max);
    if (t >= bestT) continue;
    bestT = t;
    best = b.tag
      ? { id: b.id, x: b.tag[0], y: b.tag[1], z: b.tag[2], follow: null }
      : { id: b.id, x: r.ox + r.dx * t, y: b.max[1] + 0.05, z: r.oz + r.dz * t, follow: null };
  }
  for (const d of w.discs) {
    if (!has(d.id)) continue;
    const t = rayDisc(r, d.x, d.y, d.z, d.r);
    if (t >= bestT) continue;
    bestT = t;
    best = { id: d.id, x: d.x, y: d.tagY, z: d.z, follow: null };
  }
  // The ground: path inside the fence, grass outside.
  if (r.dy < 0) {
    const t = -r.oy / r.dy;
    if (t < bestT) {
      const x = r.ox + r.dx * t;
      const z = r.oz + r.dz * t;
      const b = w.bounds;
      const id: SceneryId = x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ ? "path" : "grass";
      if (has(id)) return { id, x, y: 0.05, z, follow: null };
    }
  }
  if (best) return best;
  for (let i = 0; i < w.clouds.length; i++) {
    const c = w.clouds[i];
    if (has("cloud") && rayCloud(r, c.x, c.y, c.z, w.cloudHalf[0], w.cloudHalf[1]) < Infinity) return { id: "cloud", x: c.x, y: c.y + CLOUD_TAG, z: c.z, follow: { cloud: i } };
  }
  const s = w.sunDir;
  const sun: SceneryId = w.night ? "moon" : "sun";
  if (has(sun) && r.dx * s.x + r.dy * s.y + r.dz * s.z > Math.cos(w.sunRadius)) return { id: sun, x: 0, y: 0, z: 0, follow: "sun" };
  // Below the horizon past the fog, you see the foot of the hills.
  const hill = rayHills(r, w.hills) ?? (r.dy < 0 ? [r.ox + r.dx * w.hills.radius, 0, r.oz + r.dz * w.hills.radius] : null);
  if (hill && has("hills")) return { id: "hills", x: hill[0], y: hill[1], z: hill[2], follow: null };
  if (r.dy > 0 && has("sky")) return { id: "sky", x: r.ox + r.dx * 200, y: r.oy + r.dy * 200, z: r.oz + r.dz * 200, follow: null };
  return null;
}

// ---- Hit volumes for sprites, from their pixel art ----

/** The drawn part of each tree kind (textures.ts trees(): 64×128 cells), as half width and height per unit of scale. */
export const TREE_KINDS: readonly { id: SceneryId; half: number; top: number }[] = [
  { id: "tree", half: 0.34, top: 1.64 },
  { id: "pine", half: 0.3, top: 1.72 },
  { id: "cherry", half: 0.34, top: 1.6 },
  { id: "bush", half: 0.37, top: 0.47 },
];

/** The drawn part of each decor kind (textures.ts decor(): 32×64 cells). Kind 2 (plain mushrooms) has no word: the toadstool is a visitor's. */
export const DECOR_KINDS: readonly ({ id: SceneryId; half: number; top: number } | null)[] = [
  { id: "grass", half: 0.25, top: 0.56 },
  { id: "flower", half: 0.38, top: 0.78 },
  null,
  { id: "stone", half: 0.28, top: 0.25 },
];

/** A box round an upright sprite standing at (x, y, z). Never thinner than `min`, so small things stay tappable. */
export function spriteBox(id: SceneryId, x: number, y: number, z: number, half: number, top: number, min = 0.12): HitBox {
  const h = Math.max(half, min);
  const t = Math.max(top, min);
  return { id, min: [x - h, y, z - h], max: [x + h, y + t, z + h], tag: [x, y + t + 0.08, z] };
}

/** A box round a flat board `w` wide at height y0..y1, turned by `turn` round the vertical axis. Its tag sits just over the board, never on its text. */
export function boardBox(x: number, z: number, w: number, y1: number, turn: number): HitBox {
  // The board, and its posts just behind it.
  return { id: "sign", min: [x - w / 2, 0, z - 0.09], max: [x + w / 2, y1, z + 0.09], tag: [x, y1 + 0.06, z], turn };
}
