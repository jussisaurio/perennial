// Lawn and pond toys (#360): dandelion clocks to blow, and a paper boat to
// fold at the pond. The day's wind carries both. Everything here comes from the
// calendar day and seeded hashes, never from the clock or Math.random, so it is
// the same on every device and nothing is synced. Pure.

import { hash01 } from "../lib/seed";
import { shedAt } from "./leave";
import { collide, type Layout } from "./world";

type XZ = { x: number; z: number };

/** The word the boat carries: one practised today, else the newest (ui/visitors.ts boatWord). */
export interface BoatWord {
  lemma: string;
  gloss: string;
}
/** The toys as the walk opens: the calendar day (for the wind and the clocks), and the boat's word (null: no words yet, no boat). */
export interface ToysWalk {
  day: number;
  boat: BoatWord | null;
}

/** The day's wind: which way and how fast it blows (m/s along x and z). The same all day, a new one tomorrow. */
export function windFor(day: number): XZ {
  const a = hash01(`${day}:wind`) * Math.PI * 2;
  const speed = WIND.min + hash01(`${day}:wind`, 1) * (WIND.max - WIND.min);
  return { x: Math.cos(a) * speed, z: Math.sin(a) * speed };
}
const WIND = { min: 0.35, max: 0.9 };

/** A dandelion clock: where it grows, and its id (the seed of its seeds' flights). */
export interface Head {
  id: string;
  x: number;
  z: number;
}

/** Seeds on one clock: few, so a phone draws them easily. */
export const SEEDS = 20;
/** How many clocks always grow by the fence, and how many days a clock that grew from a seed lasts. */
const BASE = 3;
const SPREAD_DAYS = 3;
/** Two clocks never grow closer than this (m), so a tap or the button means one of them. */
const APART = 0.9;

/**
 * The clocks that always grow, by the fence: one on the back, one on each
 * side. Away from the bench and the pond on the left, the shed on the right,
 * and the notice board and the sunflower on the back. Seeded places: the same
 * every day for this garden.
 */
function baseHeads(l: Layout): Head[] {
  const b = l.bounds;
  const k = (i: number) => 0.15 + hash01("dandelion", i) * 0.7;
  const lerp = (a: number, c: number, t: number) => a + (c - a) * t;
  const leftTop = l.pond.z - l.pond.r - 1.7;
  const rightTop = shedAt(l).z - 2.4;
  // The back fence's notice board stands at the gate's x: the clock grows to its left.
  return [
    { id: "base:0", x: lerp(b.minX + 1, l.gate.x - 1, k(0)), z: b.minZ + 0.45 },
    { id: "base:1", x: b.minX + 0.45, z: lerp(b.minZ + 1.2, leftTop, k(1)) },
    { id: "base:2", x: b.maxX - 0.45, z: lerp(b.minZ + 1.6, rightTop, k(2)) },
  ];
}

/**
 * Today's dandelion clocks: those by the fence, and one for each of the last
 * few days where a seed from that day's wind came down on open ground (on a
 * day when the wind took every seed over the fence, none).
 * Whether or not the learner blew it, the wind did: no state is kept.
 */
export function dandelions(l: Layout, day: number, bedTop: number): Head[] {
  const heads = baseHeads(l);
  for (let k = SPREAD_DAYS; k >= 1; k--) {
    const d = day - k;
    // The day picks the clock to start from; a wind that takes all its seeds over the fence tries the next.
    const start = Math.floor(hash01(`${d}:dandelion`) * BASE);
    const grew = (from: Head): Head | null => {
      for (let i = 0; i < SEEDS; i++) {
        const f = flight(l, from, d, i, bedTop);
        if (f.ground && !heads.some((h) => Math.hypot(h.x - f.to.x, h.z - f.to.z) < APART)) return { id: `grew:${d}`, x: f.to.x, z: f.to.z };
      }
      return null;
    };
    for (let j = 0; j < BASE; j++) {
      const h = grew(heads[(start + j) % BASE]);
      if (!h) continue;
      heads.push(h);
      break;
    }
  }
  return heads;
}

/** One seed's way through the air, from its clock to where it comes down. Times in seconds after the blow. */
export interface Flight {
  from: XZ;
  to: XZ;
  /** It lets go of the clock this long after the blow, and is in the air this long. */
  delay: number;
  time: number;
  /** How high it rises above the straight line, and the height it comes down to. */
  lift: number;
  land: number;
  /** A sideways sway, so the seeds do not fly in straight lines. */
  phase: number;
  /** The plant it lands on (an index into the layout's plants), or -1. */
  plant: number;
  /** It came down on open ground inside the fence: a clock can grow there. */
  ground: boolean;
}

/** The height of a clock's fluff above the ground (m), where the seeds start. */
export const HEAD_TOP = 0.32;
/** A seed coming down this near a plant's middle (m) lands on it. */
const ON_PLANT = 0.3;
/** How long a seed lies on the ground before it is gone (s). */
const SETTLE = 2.5;
/** With reduced motion, the seeds fade where they are over this long (s). */
const FADE = 1.5;

/** Seed `i` of clock `h`, blown on calendar day `day`: where the wind takes it, and what it lands on. */
export function flight(l: Layout, h: Head, day: number, i: number, bedTop: number): Flight {
  // What changes comes first: FNV mixes a change at the end of a key poorly.
  const key = `${i}:${day}:${h.id}`;
  const r = (salt: number) => hash01(key, salt);
  const w = windFor(day);
  const time = 4 + r(1) * 3;
  // Mostly downwind; a little ahead, behind and to the side, so they come down spread out.
  const speed = Math.hypot(w.x, w.z);
  const [ax, az] = [w.x / speed, w.z / speed];
  const along = speed * time * (0.75 + r(2) * 0.4);
  const side = (r(3) - 0.5) * 1.6;
  const to = { x: h.x + ax * along - az * side, z: h.z + az * along + ax * side };
  const plant = plantAt(l, to);
  const b = l.bounds;
  const inside = to.x > b.minX && to.x < b.maxX && to.z > b.minZ && to.z < b.maxZ;
  const inBed = l.beds.some((bed) => Math.abs(to.x - bed.x) < bed.w / 2 && Math.abs(to.z - bed.z) < bed.d / 2);
  const free = collide(l, to.x, to.z, 0.3);
  const ground = inside && Math.abs(free.x - to.x) < 1e-9 && Math.abs(free.z - to.z) < 1e-9;
  return { from: { x: h.x, z: h.z }, to, delay: r(4) * 0.6, time, lift: 0.5 + r(5) * 0.9, land: plant >= 0 || (inside && inBed) ? bedTop : 0.02, phase: r(6) * Math.PI * 2, plant, ground };
}

/** The plant whose middle is nearest a point, within reach of a landing seed; -1 for none. */
function plantAt(l: Layout, p: XZ): number {
  let best = -1;
  let bestD = ON_PLANT;
  l.plants.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** Where a seed is, and how much of it shows (0 to 1), `t` seconds after the blow. Fills `out` in place: it runs every frame. */
export function seedAt(f: Flight, t: number, reducedMotion: boolean, out: { x: number; y: number; z: number; a: number }) {
  if (reducedMotion) {
    // Nothing drifts: the seeds fade on the clock.
    out.x = f.from.x;
    out.y = HEAD_TOP;
    out.z = f.from.z;
    out.a = Math.max(0, 1 - Math.max(0, t - f.delay) / FADE);
    return;
  }
  const s = Math.max(0, Math.min(1, (t - f.delay) / f.time));
  const arc = Math.sin(Math.PI * s);
  const sway = Math.sin(s * Math.PI * 4 + f.phase) * 0.15 * arc;
  const dx = f.to.x - f.from.x;
  const dz = f.to.z - f.from.z;
  // `|| 1`: a seed that comes down on its own clock has no way to sway across; any length will do.
  const len = Math.hypot(dx, dz) || 1;
  out.x = f.from.x + dx * s - (dz / len) * sway;
  out.z = f.from.z + dz * s + (dx / len) * sway;
  // Up on the gust, then slowly down: the end of the way is gentle.
  out.y = HEAD_TOP + (f.land - HEAD_TOP) * s + f.lift * arc;
  out.a = 1 - Math.max(0, Math.min(1, (t - f.delay - f.time) / SETTLE));
}

/** How long a blow lasts, until every seed has settled and gone (s). */
export function blowEnds(flights: readonly Flight[], reducedMotion: boolean): number {
  return Math.max(...flights.map((f) => f.delay + (reducedMotion ? FADE : f.time + SETTLE)));
}

/** A paper boat's way on the pond: where it sets off (just inside the rim, nearest the folder), the way it is pushed, and the day's wind. */
export interface Voyage {
  pond: Layout["pond"];
  from: XZ;
  push: XZ;
  wind: XZ;
}

/** The boat stays this far inside the rim (m). */
const BOAT_RIM = 0.25;
/** The push from the folder's hand: how far it carries the boat (m), and how fast it dies away (s). */
const PUSH = { far: 0.9, slow: 2.5 };
/** How much of the wind's speed the boat drifts with. */
const DRIFT = 0.12;

/** The boat folded by someone standing at (x, z), on calendar day `day`. */
export function voyage(pond: Layout["pond"], x: number, z: number, day: number): Voyage {
  // `|| 1`: no one stands in the pond's middle (world.ts collide), but a boat folded there would set off along +x.
  const d = Math.hypot(x - pond.x, z - pond.z) || 1;
  const [ux, uz] = [(x - pond.x) / d, (z - pond.z) / d];
  const r = pond.r - BOAT_RIM;
  return { pond, from: { x: pond.x + ux * r, z: pond.z + uz * r }, push: { x: -ux, z: -uz }, wind: windFor(day) };
}

/**
 * Where the boat is `t` seconds after it sets off: pushed out, then carried
 * by the wind until it rests against the rim downwind, sliding round it.
 * Fills `out` in place: it runs every frame.
 */
export function boatAt(v: Voyage, t: number, out: XZ) {
  const pushed = PUSH.far * (1 - Math.exp(-t / PUSH.slow));
  let x = v.from.x + v.push.x * pushed + v.wind.x * DRIFT * t;
  let z = v.from.z + v.push.z * pushed + v.wind.z * DRIFT * t;
  const dx = x - v.pond.x;
  const dz = z - v.pond.z;
  const d = Math.hypot(dx, dz);
  const r = v.pond.r - BOAT_RIM;
  if (d > r) [x, z] = [v.pond.x + (dx / d) * r, v.pond.z + (dz / d) * r];
  out.x = x;
  out.z = z;
}

/** The frog climbs on when the boat comes this near its lily pad (m). */
export const FROG_BOARDS = 0.4;

/** Near enough to the pond (m past its edge) to fold a boat there. */
export const FOLD_REACH = 1.2;
