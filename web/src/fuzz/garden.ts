// The garden fuzzer (#1025): many gardens, made the way the app makes them,
// each walked by a random walker, and checked against the rules of a physical
// garden (CLAUDE.md "The garden is physical", docs/garden-play.md). Pure: no
// browser and no drawing. `bun run fuzz:garden` runs many; garden.test.ts runs
// a few fixed ones in every check.

import { ORCHARD_WORDS } from "../deck/schema";
import { rng } from "../lib/seed";
import { standAt, wayNear, type Ground } from "../garden/ground";
import { backWay, lookoutAt, type Lookout } from "../garden/lookout";
import { orchardBench, orchardTrees, placeTrees, type PlacedTree } from "../garden/orchard";
import { offerAt, offersAt, type Offer, type Things } from "../garden/reachCore";
import { shedAt } from "../garden/shed";
import { STEP, stileAt, type StileSpot } from "../garden/stile";
import { FREE, glideTo, look, newWalker, sit, startTrip, step, stepAhead, toMode, turn, type WalkerWorld } from "../garden/walker";
import { BENCH, benchAt, SUNDIAL, KEY_SPOTS, keyAt, lanternSpots, layout, viewpoint, walkStep, WALKER, type BackWay, type GardenPlant, type Layout, type Planting } from "../garden/world";

/** The back fence (#770): no stile yet, the stile under brambles, or the way over it open. */
const BACKS = ["none", "shut", "open"] as const;
type Back = (typeof BACKS)[number];

/** One garden to try: everything else in it follows from these. */
export interface Case {
  seed: number;
  /** Words with a place in the beds, some of them set aside. */
  plants: number;
  /** The hedge's door is open, so the orchard is there to walk in. */
  door: boolean;
  back: Back;
}

/** The biggest garden tried: about a hundred beds. */
const MAX_PLANTS = 3000;

/** The case a seed makes: plant counts spread evenly on a log scale, so small gardens come up as often as big ones. */
export function caseOf(seed: number): Case {
  const r = rng(stream(seed, 0));
  const plants = Math.max(1, Math.round(Math.exp(r() * Math.log(MAX_PLANTS))));
  return { seed, plants, door: r() < 0.5, back: BACKS[Math.floor(r() * BACKS.length)] };
}

/** A case as one word, for a command that repeats it: s7-p120-door-open. */
export function caseName(c: Case): string {
  return `s${c.seed}-p${c.plants}-${c.door ? "door" : "nodoor"}-${c.back}`;
}

export function parseCase(name: string): Case {
  const m = /^s(\d+)-p(\d+)-(door|nodoor)-(none|shut|open)$/.exec(name);
  if (!m) throw new Error(`not a case: ${name} (like s7-p120-door-open)`);
  return { seed: Number(m[1]), plants: Number(m[2]), door: m[3] === "door", back: m[4] as Back };
}

/** A separate random stream per use, so a smaller garden from the same seed has the same first words. */
function stream(seed: number, use: number): number {
  return (Math.imul(seed, 0x9e3779b1) + use * 0x85ebca6b) >>> 0;
}

/** A rule of the physical garden, each from the written rules (see RULES). */
export type Rule = "standable" | "solid" | "drawn" | "reach" | "way" | "throws" | "nan" | "trapped";

/** What each rule says, and where it is written. */
export const RULES: Record<Rule, string> = {
  standable: "Every spot the app puts you on (the start, a plant's viewpoint, up off a seat, the stile's foot) is ground you may stand on (collide leaves it where it is).",
  solid: "A walker never stands in a thing drawn as solid, and never off the ground (CLAUDE.md: if something is solid, you can't walk there).",
  drawn: "Each thing drawn as solid stops a walker, unless KNOWN lists it with a reason.",
  reach: "Every thing with an action has a spot in its reach that you can walk to from the gate (CLAUDE.md: a button acts on a thing in reach).",
  way: "A tap-walk (wayTo, then walkStep) to any spot you may stand on arrives, and never stalls (world.ts TRIP_STUCK: that should never happen).",
  throws: "No key, tap, step or seat makes the walker throw (world.ts wayTo: no way on foot means a bug).",
  nan: "The walker's place and view are always numbers.",
  trapped: "From anywhere you stand, a tap-walk takes you back to the gate.",
};

/** One broken rule: in which garden, where, and what. */
export interface Finding {
  rule: Rule;
  c: Case;
  at: [number, number] | null;
  what: string;
}

/** A garden made from a case, as the scene makes it (scene.ts constructor). */
interface Garden {
  c: Case;
  l: Layout;
  g: Ground;
  world: WalkerWorld;
  stile: StileSpot | null;
  hill: Lookout | null;
  back: BackWay | null;
  trees: PlacedTree[];
  /** Where the walker starts: inside the gate, the first bed in view. */
  spawn: { x: number; z: number };
  solids: Solid[];
}

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 14, 12);

function gardenOf(c: Case): Garden {
  const r = rng(stream(c.seed, 1));
  const plants: GardenPlant[] = [];
  const aside: Planting[] = [];
  let planted = NOW - 400 * DAY;
  for (let i = 0; i < c.plants; i++) {
    // A few words a day, and now and then a word set aside: it keeps its place, empty.
    planted += Math.floor(r() * DAY);
    const at = { id: `w${Math.floor(r() * 1e9).toString(36)}${i}`, lemma: `word${i}`, rank: Math.floor(r() * 5000), planted };
    if (r() < 0.05) aside.push(at);
    else plants.push({ ...at, gloss: "", pos: "noun", s: 10, r: 0.9, stage: "bloom", growth: r(), listen: false, write: false, forms: [] });
  }
  const l = layout(plants, aside);
  const t = rng(stream(c.seed, 2));
  // Any of the kinds, at any age: a tree's trunk grows with it.
  const kinds = ORCHARD_WORDS.filter(() => t() < 0.7);
  const trees = c.door ? placeTrees(l.orchard, orchardTrees(kinds.map((k) => ({ id: k, lemma: k, gloss: k, kind: k, planted: NOW - t() * 1000 * DAY, read: { s: t() * 300, reps: Math.floor(t() * 40), lapses: 0 } })), NOW)) : [];
  const stile = c.back === "none" ? null : stileAt(l);
  const hill = stile && lookoutAt(stile);
  const back = stile && hill ? backWay(stile, hill, c.back === "open") : null;
  const g: Ground = { layout: l, doorOpen: () => c.door, trees: () => trees, back };
  const first = l.beds[0];
  const spawn = { x: l.gate.x, z: Math.min(l.gate.z - 1.2, first.z + first.d / 2 + 3.2) };
  const garden: Garden = { c, l, g, world: { ground: g, stile, hill, reducedMotion: false }, stile, hill, back, trees, spawn, solids: [] };
  garden.solids = solids(garden);
  return garden;
}

// ---- What is drawn as solid ----

/** A thing's footprint on the ground: a box or a disc. */
type Shape = { box: [x0: number, x1: number, z0: number, z1: number] } | { round: [x: number, z: number, r: number] };

/** A thing the scene draws that a walker should not walk through, by its footprint. `known`: it does not stop a walker yet, and why. */
interface Solid {
  name: string;
  shape: Shape;
  known: string | null;
}

/**
 * Drawn things a walker passes through today, each with its issue. The rules
 * skip them; the run counts them. Visitors, the key, pebbles, dandelions and
 * the leaf piles are not here: they are small or move, and are walked over or
 * round by design (docs/garden-play.md).
 */
const KNOWN = {
  lantern: "the garden's lantern posts are drawn but not solid; the hill's post is (lookout.ts POST_R) (#1032)",
  sunflower: "the sunflower's stem is drawn but not solid (#1032)",
  shed: "the shed's walls are drawn (shed.ts buildShed) but not solid (#1032)",
} as const;

/** How far into a thing's footprint a walker's edge may come (m): collide rounds, and wayTo's legs clear things by a hair less than a walker (world.ts LEG_CLEAR). */
const TOL = 0.02;

/** The things the scene draws as solid, where the scene draws them. */
function solids({ l, c, back, trees }: Garden): Solid[] {
  const out: Solid[] = [];
  const box = (name: string, x0: number, x1: number, z0: number, z1: number, known: string | null = null) => out.push({ name, shape: { box: [x0, x1, z0, z1] }, known });
  const round = (name: string, x: number, z: number, r: number, known: string | null = null) => out.push({ name, shape: { round: [x, z, r] }, known });
  l.beds.forEach((b, i) => box(`bed ${i}`, b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2));
  // scene.ts benchModel, from BENCH; its seat faces +z.
  const b = benchAt(l);
  box("bench", b.x - BENCH.half, b.x + BENCH.half, b.z - BENCH.back, b.z + BENCH.front);
  // sceneJokes.ts draws its stone top at world.ts SUNDIAL (#1033).
  box("sundial", b.x + SUNDIAL.dx - SUNDIAL.half, b.x + SUNDIAL.dx + SUNDIAL.half, b.z - SUNDIAL.half, b.z + SUNDIAL.half);
  round("pond", l.pond.x, l.pond.z, l.pond.r);
  // shed.ts buildShed: the back wall against the right fence, and two side walls.
  const s = shedAt(l);
  box("shed's back wall", s.x - 0.03, s.x + 0.03, s.z - 0.8, s.z + 0.8, KNOWN.shed);
  for (const side of [-1, 1]) box("shed's side wall", s.x - 0.7, s.x, s.z + side * 0.8 - 0.025, s.z + side * 0.8 + 0.025, KNOWN.shed);
  // sceneLanterns.ts LANTERN: a post under the lamp, drawn on a sprite 0.42 m wide; the post is about a tenth of that.
  for (const [x, z] of lanternSpots(l)) round("lantern", x, z, 0.05, KNOWN.lantern);
  round("sunflower", l.bounds.maxX - 1, l.bounds.minZ + 0.45, 0.05, KNOWN.sunflower);
  if (c.door) {
    round("well", l.well.x, l.well.z, l.well.r);
    // orchardScene.ts: the same bench as by the pond, turned by `turn` (0: its seat faces +z).
    const ob = orchardBench(l.orchard);
    box("orchard's bench", ob.x - BENCH.half, ob.x + BENCH.half, ob.z - BENCH.back, ob.z + BENCH.front);
    for (const t of trees) round(`${t.kind} tree's trunk`, t.x, t.z, t.trunk);
  }
  if (back?.open === false) box("brambles", ...back.brambles);
  if (back?.open) for (const [i, t] of back.things.entries()) round(["hill's lantern post", "stool", "diary's stone"][i], t.x, t.z, t.r);
  return out;
}

/** How far (x, z) is from a footprint's edge: below 0 inside it. */
function gap(s: Shape, x: number, z: number): number {
  if ("round" in s) return Math.hypot(x - s.round[0], z - s.round[1]) - s.round[2];
  const [x0, x1, z0, z1] = s.box;
  const dx = Math.max(x0 - x, 0, x - x1);
  const dz = Math.max(z0 - z, 0, z - z1);
  if (dx > 0 || dz > 0) return Math.hypot(dx, dz);
  return -Math.min(x - x0, x1 - x, z - z0, z1 - z);
}

/** Is a walker's middle at (x, z) on ground, by the drawn world: inside the fence, through the open door into the orchard, or over the open stile onto the hill? */
function onGround({ l, c, back }: Garden, x: number, z: number): boolean {
  const b = l.bounds;
  const k = WALKER - TOL;
  if (x >= b.minX + k && x <= b.maxX - k && z >= b.minZ + k && z <= b.maxZ - k) return true;
  const o = l.orchard;
  // The door, 1.1 m wide, then the orchard inside its hedge (world.ts DOOR_HALF).
  if (c.door && z > b.maxZ - k && Math.abs(x - l.gate.x) <= 0.55 - k + 1e-9 && z <= o.z + o.d / 2 - k) return true;
  if (c.door && x >= o.x - o.w / 2 + k && x <= o.x + o.w / 2 - k && z >= o.z - o.d / 2 + k && z <= o.z + o.d / 2 - k) return true;
  if (back?.open && z < b.minZ + k) {
    // Over the stile between its rails, up the cut way, or on the hilltop.
    if (Math.abs(x - back.stile.x) <= STEP.w / 2 - k && z >= back.stile.z - back.stile.out - WALKER - 0.05) return true;
    const w = back.way;
    const along = (x - w.x) * w.dx + (z - w.z) * w.dz;
    const across = -(x - w.x) * w.dz + (z - w.z) * w.dx;
    if (along >= -TOL && along <= w.len + TOL && Math.abs(across) <= w.half - k) return true;
    return Math.hypot(x - back.top.x, z - back.top.z) <= back.top.r - k;
  }
  return false;
}

/** Why a walker's middle may not be at (x, z), or null: off the ground, or in a solid thing (known ones aside). */
function badSpot(gd: Garden, x: number, z: number): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return "not a number";
  if (!onGround(gd, x, z)) return "off the ground";
  for (const s of gd.solids) if (!s.known && gap(s.shape, x, z) < WALKER - TOL) return `in the ${s.name}`;
  return null;
}

// ---- Checks ----

/** Is (x, z) where a walker may stand, by the game's own collisions? */
function standable(gd: Garden, x: number, z: number): boolean {
  const p = standAt(gd.g, x, z);
  return Math.hypot(p.x - x, p.z - z) < 1e-6;
}

const WALK_DT = 1 / 30;
/** world.ts walker pace (walker.ts WALK): metres a frame at WALK_DT. */
const WALK_STEP = 3.6 * WALK_DT;

/**
 * Walk on foot from `from` to `to` as a tap does (ground.ts wayNear, world.ts
 * walkStep), checking every frame's spot. The problem, or null when it arrives.
 */
function walkTo(gd: Garden, from: { x: number; z: number }, to: { x: number; z: number }): { rule: Rule; at: [number, number]; what: string } | null {
  let way: [number, number][];
  try {
    way = wayNear(gd.g, from.x, from.z, to.x, to.z, 0);
  } catch (e) {
    return { rule: "way", at: [from.x, from.z], what: `no way from ${pt(from)} to ${pt(to)}: ${e instanceof Error ? e.message : String(e)}` };
  }
  // A single corner: already there.
  if (way.length < 2) return null;
  const trip = { way, leg: 1, stop: 0, stuck: 0 };
  let len = 0;
  for (let i = 1; i < way.length; i++) len += Math.hypot(way[i][0] - way[i - 1][0], way[i][1] - way[i - 1][1]);
  const at = { x: from.x, z: from.z };
  // Twice the frames the way's length needs, and a second more: a walk that takes longer has gone wrong.
  const frames = (2 * len) / WALK_STEP + 30;
  for (let f = 0; f < frames; f++) {
    const now = walkStep(gd.l, trip, at, WALK_STEP, WALK_DT, gd.c.door, gd.trees, gd.back);
    const bad = badSpot(gd, at.x, at.z);
    if (bad) return { rule: "solid", at: [at.x, at.z], what: `walking from ${pt(from)} to ${pt(to)}, at ${pt(at)}: ${bad}` };
    if (now === "arrived") return null;
    if (now === "stalled") return { rule: "way", at: [at.x, at.z], what: `the walk from ${pt(from)} to ${pt(to)} stalled at ${pt(at)}` };
  }
  return { rule: "way", at: [at.x, at.z], what: `the walk from ${pt(from)} to ${pt(to)} did not arrive in ${Math.round(frames)} frames (at ${pt(at)})` };
}

function pt(p: { x: number; z: number }): string {
  return `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})`;
}

/** A thing with an action, and where to look for a spot in its reach. */
interface Target {
  name: string;
  x: number;
  z: number;
  /** As far as its reach goes (m), or a little farther: spots are tried out to this. */
  reach: number;
  things: Things;
  offered: (o: Offer) => boolean;
}

/** The things the button acts on, as the scene keeps them; parts with no pure place yet (pebbles, toys, visitors, notes) offer nothing. */
function thingsOf(gd: Garden, key: { x: number; z: number } | null, dark: boolean): Things {
  const lamps = lanternSpots(gd.l);
  return {
    door: { state: gd.c.door ? "open" : key ? "key" : "locked", key },
    gate: gd.l.gate,
    bench: benchAt(gd.l),
    lanterns: { at: lamps.map(([x, z]) => [x, 0, z] as const), on: lamps.map(() => false), dark, lookout: -1 },
    lookout: gd.hill && { hill: gd.hill, pages: [0] },
    plants: [],
    carry: { held: null, reachAt: () => null },
    toys: { reachAt: () => null },
    hiders: { hiderNear: () => null },
    mat: { noteInReach: () => null },
    note: () => null,
  };
}

function targets(gd: Garden): Target[] {
  const day = thingsOf(gd, null, false);
  const out: Target[] = [{ name: "the bench", ...benchAt(gd.l), reach: 1.6, things: day, offered: (o) => o.on === "bench" }];
  if (!gd.c.door) {
    out.push({ name: "the door", ...gd.l.gate, reach: 2.6, things: day, offered: (o) => o.on === "door" });
    for (const spot of KEY_SPOTS) {
      const k = keyAt(gd.l, spot);
      out.push({ name: `the key by the ${spot}`, ...k, reach: 2, things: thingsOf(gd, k, false), offered: (o) => o.on === "key" });
    }
  }
  const night = thingsOf(gd, null, true);
  for (const [i, [x, z]] of lanternSpots(gd.l).entries()) out.push({ name: `lantern ${i}`, x, z, reach: 1.5, things: night, offered: (o) => o.on === "lantern" && o.target === i });
  if (gd.hill && gd.back?.open) {
    out.push({ name: "the stool", x: gd.hill.stool[0], z: gd.hill.stool[1], reach: 1, things: day, offered: (o) => o.on === "stool" });
    out.push({ name: "the diary's stone", x: gd.hill.stone[0], z: gd.hill.stone[1], reach: 1, things: day, offered: (o) => o.on === "diary" });
  }
  return out;
}

/** Spots round a thing, nearest first, out to `reach`: 24 ways round, every 0.15 m. */
function around(x: number, z: number, reach: number): [number, number][] {
  const out: [number, number][] = [];
  for (let d = 0.15; d < reach; d += 0.15) for (let i = 0; i < 24; i++) out.push([x + Math.cos((i * Math.PI) / 12) * d, z + Math.sin((i * Math.PI) / 12) * d]);
  return out;
}

/** The static rules: the spots the app puts you on, things drawn as solid, and every thing with an action in reach. */
function checkPlaces(gd: Garden, plantWalks: number, r: () => number): Finding[] {
  const out: Finding[] = [];
  const add = (rule: Rule, at: [number, number] | null, what: string) => out.push({ rule, c: gd.c, at, what });
  const spot = (name: string, x: number, z: number) => {
    if (!standable(gd, x, z)) add("standable", [x, z], `${name} at ${pt({ x, z })} is not ground a walker may stand on (collide moves it to ${pt(standAt(gd.g, x, z))})`);
    const bad = badSpot(gd, x, z);
    if (bad) add("solid", [x, z], `${name} at ${pt({ x, z })}: ${bad}`);
  };
  spot("the start", gd.spawn.x, gd.spawn.z);
  for (const p of gd.l.plants) {
    const v = viewpoint(gd.l, p);
    spot(`the viewpoint of plant ${p.id} (bed ${p.bed})`, v.x, v.z);
  }
  // Up off each seat, as the walker stands you up.
  for (const seat of gd.back?.open ? (["bench", "stool"] as const) : (["bench"] as const)) {
    const w = newWalker(0, 0);
    sit(w, seat, gd.world);
    toMode(w, FREE, gd.world);
    spot(`up off the ${seat}`, w.x, w.z);
  }
  if (gd.stile) spot("the stile's foot", gd.stile.foot[0], gd.stile.foot[1]);

  for (const s of gd.solids) {
    if (s.known) continue;
    const [x, z] = "round" in s.shape ? [s.shape.round[0], s.shape.round[1]] : [(s.shape.box[0] + s.shape.box[1]) / 2, (s.shape.box[2] + s.shape.box[3]) / 2];
    if (standable(gd, x, z)) add("drawn", [x, z], `the ${s.name} is drawn at ${pt({ x, z })}, but a walker may stand in its middle`);
  }

  const w = newWalker(0, 0);
  const all = targets(gd);
  // A walk in a big garden takes a while to plan: walk to a few lanterns, and to everything else.
  const lanterns = all.filter((t) => t.name.startsWith("lantern"));
  const walked = new Set([...all.filter((t) => !lanterns.includes(t)), ...Array.from({ length: 4 }, () => lanterns[Math.floor(r() * lanterns.length)])]);
  for (const t of all) {
    const spots = around(t.x, t.z, t.reach).filter(([x, z]) => {
      [w.x, w.z] = [x, z];
      return standable(gd, x, z) && !badSpot(gd, x, z) && offersAt(w, t.things, null).some(t.offered);
    });
    if (!spots.length) {
      add("reach", [t.x, t.z], `no spot to stand on within reach of ${t.name} at ${pt(t)}`);
      continue;
    }
    if (!walked.has(t)) continue;
    // Of the three spots nearest the thing, one that a walk from the gate reaches.
    let fail: ReturnType<typeof walkTo> = null;
    for (const [x, z] of spots.slice(0, 3)) {
      fail = walkTo(gd, gd.spawn, { x, z });
      if (!fail) break;
    }
    if (fail) add("reach", [t.x, t.z], `you cannot walk to ${t.name} at ${pt(t)}: ${fail.what}`);
  }
  if (gd.stile) {
    const f = walkTo(gd, gd.spawn, { x: gd.stile.foot[0], z: gd.stile.foot[1] });
    if (f) add("reach", gd.stile.foot, `you cannot walk to the stile's foot: ${f.what}`);
  }
  // A few plants, tapped from the gate: walk to its viewpoint (scene.ts tapPlant).
  for (let i = 0; i < plantWalks && gd.l.plants.length; i++) {
    const p = gd.l.plants[Math.floor(r() * gd.l.plants.length)];
    const v = viewpoint(gd.l, p);
    const f = walkTo(gd, gd.spawn, v);
    if (f) add(f.rule, f.at, `to plant ${p.id}: ${f.what}`);
  }
  return out;
}

/** A random spot to tap: mostly in the garden, sometimes in the orchard or on the hill, sometimes past the fence or in a solid. */
function tapSpot(gd: Garden, r: () => number): [number, number] {
  const b = gd.l.bounds;
  const u = r();
  if (u < 0.15 && gd.c.door) {
    const o = gd.l.orchard;
    return [o.x + (r() - 0.5) * o.w, o.z + (r() - 0.5) * o.d];
  }
  if (u < 0.3 && gd.hill) return [gd.hill.top[0] + (r() - 0.5) * 12, gd.hill.top[1] + (r() - 0.5) * 12];
  // A little past every fence.
  return [b.minX - 1 + r() * (b.maxX - b.minX + 2), b.minZ - 1 + r() * (b.maxZ - b.minZ + 2)];
}

/**
 * The random walker: keys, taps, turns, looks, steps, glides to a plant, and
 * sitting down where the button offers it, for `frames` frames. After every
 * frame it stands where a walker may; now and then, it must be able to walk
 * back to the gate.
 */
function checkWalker(gd: Garden, frames: number, r: () => number): Finding[] {
  const out: Finding[] = [];
  const w = newWalker(gd.spawn.x, gd.spawn.z);
  const day = thingsOf(gd, null, false);
  let move = { x: 0, y: 0 };
  let run = false;
  let left = 0;
  let last = "start";
  // A look stops a glide where it is, which may be over a bed, until the next move (#1031): known, so not checked then.
  let glideCut = false;
  for (let f = 0; f < frames && out.length < 3; f++) {
    let end: ReturnType<typeof step>;
    try {
      end = frame();
    } catch (e) {
      // In the app this throw ends the frame loop: a finding, and this walker stops here.
      out.push({ rule: "throws", c: gd.c, at: [w.x, w.z], what: `after ${last}, frame ${f}, at ${pt(w)}: ${e instanceof Error ? e.message : String(e)}` });
      break;
    }
    const at: [number, number] = [w.x, w.z];
    if (![w.x, w.z, w.yaw, w.pitch, w.seat].every(Number.isFinite)) out.push({ rule: "nan", c: gd.c, at, what: `after ${last}, frame ${f}: x ${w.x} z ${w.z} yaw ${w.yaw} pitch ${w.pitch}` });
    if (end?.end === "stalled") out.push({ rule: "way", c: gd.c, at, what: `after ${last}, frame ${f}: the walk stalled at ${pt(w)}` });
    // On a seat you sit on the bench; on a glide (Next plant, for a screen reader) you pass over beds.
    if ((w.mode.kind === "free" && !glideCut) || w.mode.kind === "trip") {
      const bad = badSpot(gd, w.x, w.z);
      if (bad) out.push({ rule: "solid", c: gd.c, at, what: `after ${last}, frame ${f}: the walker at ${pt(w)} is ${bad}` });
    }
    if (w.mode.kind === "free" && !glideCut && (f % 600 === 599 || f === frames - 1)) {
      const back = walkTo(gd, w, gd.spawn);
      if (back) out.push({ rule: "trapped", c: gd.c, at, what: `after ${last}, frame ${f}, from ${pt(w)}: ${back.what}` });
    }
  }
  return out;

  /** One frame: now and then a new thing to do, then the walker's step. */
  function frame() {
    if (left <= 0) {
      left = 0.2 + r() * 1.8;
      move = { x: 0, y: 0 };
      const a = r();
      // Every choice but a look or idling moves the walker, out of any bed (#1031).
      if (a < 0.68 || (a >= 0.76 && a < 0.84)) glideCut = false;
      // Each `last` is set before its call, so a throw names what threw.
      if (a < 0.35) {
        move = { x: r() * 2 - 1, y: r() * 2 - 1 };
        run = r() < 0.3;
        last = `keys (${move.x.toFixed(2)}, ${move.y.toFixed(2)})${run ? " running" : ""}`;
      } else if (a < 0.6) {
        const [x, z] = tapSpot(gd, r);
        last = `tap at ${pt({ x, z })}`;
        startTrip(w, x, z, r() < 0.5 ? 0 : r() * 1.5, null, gd.world);
      } else if (a < 0.68 && gd.l.plants.length) {
        const v = viewpoint(gd.l, gd.l.plants[Math.floor(r() * gd.l.plants.length)]);
        last = `glide to ${pt(v)}`;
        glideTo(w, v.x, v.z, v.yaw, 0, gd.world);
      } else if (a < 0.76) {
        if (w.mode.kind === "glide") glideCut = true;
        last = "turn";
        turn(w, (r() - 0.5) * 4, gd.world);
        look(w, (r() - 0.5) * 400, (r() - 0.5) * 200, gd.world);
      } else if (a < 0.84) {
        // Ctrl and the wheel: a step of up to 2 m.
        last = "step";
        stepAhead(w, (r() - 0.5) * 4, gd.world);
      } else {
        const o = offerAt(w, day, null);
        if (o?.a === "sit") sit(w, "bench", gd.world);
        else if (o?.a === "stool") sit(w, "stool", gd.world);
        last = o?.a === "sit" || o?.a === "stool" ? `sit (${o.a})` : "idle";
      }
    }
    left -= WALK_DT;
    return step(w, { move, run }, WALK_DT, gd.world);
  }
}

/** How much of each case to run: the walker's frames, and how many plants to walk to from the gate. */
export interface Effort {
  frames: number;
  plantWalks: number;
}

/** Every rule on one case. */
export function check(c: Case, effort: Effort): Finding[] {
  const gd = gardenOf(c);
  const r = rng(stream(c.seed, 3));
  return [...checkPlaces(gd, effort.plantWalks, r), ...checkWalker(gd, effort.frames, r)];
}

/** The things drawn but not yet solid in this case, by name: counted, not failed. */
export function knownIn(c: Case): string[] {
  return [...new Set(gardenOf(c).solids.flatMap((s) => (s.known ? [s.name] : [])))];
}

/**
 * The smallest garden like `c` that still breaks `rule`: fewer plants, the
 * door shut, no back way, each kept only if the rule still breaks.
 */
export function shrink(c: Case, rule: Rule, effort: Effort): Case {
  const breaks = (k: Case) => check(k, effort).some((f) => f.rule === rule);
  let best = c;
  if (best.door && breaks({ ...best, door: false })) best = { ...best, door: false };
  if (best.back !== "none" && breaks({ ...best, back: "none" })) best = { ...best, back: "none" };
  // Halve the plants while it still breaks, then step down a bed at a time.
  for (let n = Math.floor(best.plants / 2); n >= 1 && breaks({ ...best, plants: n }); n = Math.floor(n / 2)) best = { ...best, plants: n };
  for (let n = best.plants - 30; n >= 1 && breaks({ ...best, plants: n }); n -= 30) best = { ...best, plants: n };
  return best;
}
