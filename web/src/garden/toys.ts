// Lawn toys (#360): dandelion clocks to blow. The day's wind carries their
// seeds. Everything here comes from the calendar day and seeded hashes, never
// from the clock or Math.random, so it is the same on every device and nothing
// is synced. Pure.

import { hash01 } from "../lib/seed";
import { REACH_SLACK } from "./reach";
import { shedAt } from "./shed";
import { collide, type Layout } from "./world";

type XZ = { x: number; z: number };

/** The toys as the walk opens: the calendar day, for the wind and the clocks. */
export interface ToysWalk {
  day: number;
}

/** The day's wind: which way and how fast it blows (m/s along x and z). The same all day, a new one tomorrow. @internal Exported for tests. */
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
 * Whether or not the learner blew it, the wind did: no state is kept. @internal Exported for tests.
 */
export function dandelions(l: Layout, day: number): Head[] {
  const heads = baseHeads(l);
  for (let k = SPREAD_DAYS; k >= 1; k--) {
    const d = day - k;
    // The day picks the clock to start from; a wind that takes all its seeds over the fence tries the next.
    const start = Math.floor(hash01(`${d}:dandelion`) * BASE);
    const grew = (from: Head): Head | null => {
      for (let i = 0; i < SEEDS; i++) {
        // Not flight(): it looks for a plant under each seed, and a clock needs only where it came down (#459).
        const { to } = seedWay(from, d, i);
        if (onGround(l, to) && !heads.some((h) => Math.hypot(h.x - to.x, h.z - to.z) < APART)) return { id: `grew:${d}`, x: to.x, z: to.z };
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
}

/** The height of a clock's fluff above the ground (m), where the seeds start. @internal Exported for tests. */
export const HEAD_TOP = 0.32;
/** A seed coming down this near a plant's middle (m) lands on it. */
const ON_PLANT = 0.3;
/** How long a seed lies on the ground before it is gone (s). */
const SETTLE = 2.5;
/** With reduced motion, the seeds fade where they are over this long (s). */
const FADE = 1.5;

/** Where seed `i` of clock `h`, blown on calendar day `day`, comes down, and how long it is in the air (s); `r` is its random sequence. */
function seedWay(h: Head, day: number, i: number): { to: XZ; time: number; r: (salt: number) => number } {
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
  return { to: { x: h.x + ax * along - az * side, z: h.z + az * along + ax * side }, time, r };
}

/** Open ground inside the fence: not in a bed, the pond or anything else the walker cannot stand in. */
function onGround(l: Layout, to: XZ): boolean {
  const free = collide(l, to.x, to.z, 0.3);
  return inside(l, to) && Math.abs(free.x - to.x) < 1e-9 && Math.abs(free.z - to.z) < 1e-9;
}

function inside(l: Layout, to: XZ): boolean {
  const b = l.bounds;
  return to.x > b.minX && to.x < b.maxX && to.z > b.minZ && to.z < b.maxZ;
}

/** Seed `i` of clock `h`, blown on calendar day `day`: where the wind takes it, and what it lands on. @internal Exported for tests. */
export function flight(l: Layout, h: Head, day: number, i: number, bedTop: number): Flight {
  const { to, time, r } = seedWay(h, day, i);
  const plant = plantAt(l, to);
  const inBed = l.beds.some((bed) => Math.abs(to.x - bed.x) < bed.w / 2 && Math.abs(to.z - bed.z) < bed.d / 2);
  return { from: { x: h.x, z: h.z }, to, delay: r(4) * 0.6, time, lift: 0.5 + r(5) * 0.9, land: plant >= 0 || (inside(l, to) && inBed) ? bedTop : 0.02, phase: r(6) * Math.PI * 2, plant };
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

/** How long a blow lasts, until every seed has settled and gone (s). @internal Exported for tests. */
export function blowEnds(flights: readonly Flight[], reducedMotion: boolean): number {
  return Math.max(...flights.map((f) => f.delay + (reducedMotion ? FADE : f.time + SETTLE)));
}

// ---- The clocks in play ----

/** What the action button does here: blow a dandelion clock. */
export type ToyAct = "blow";
/** A clock a tap or the action button acts on. */
export type ToyTarget = { at: "clock"; i: number };
/** What a toy did, for the page to count and to say. */
export type ToyDone = { did: "blow" };

/** Near enough to a clock (m) to blow it. */
const REACH = 1.2;
/** A walk to a clock stops this short of it, so it is still in view. */
export const TOY_STAND = 0.8;

/** One clock's blow: when it began (the game's clock, s), its seeds' ways, and which of them have landed yet. */
export interface Blow {
  at: number;
  flights: Flight[];
  landed: Uint8Array;
  ends: number;
}

/**
 * Today's clocks in play: which are blown, and the seeds of each blow under
 * way. It says what the action button can do where you stand, and does it; a
 * seed that lands on a plant makes it sneeze (`sneeze`).
 */
export class Clocks {
  readonly heads: Head[];
  readonly blown: boolean[];
  /** Each clock's blow while its seeds are in the air or on the ground, else null. */
  readonly blows: (Blow | null)[];
  /** Every target the action button can point at, and what reachAt returns, made once: it allocates nothing. */
  private targets: ToyTarget[];
  private reach: { a: ToyAct; target: ToyTarget };
  private layout: Layout;
  private day: number;
  private bedTop: number;
  private reducedMotion: boolean;
  private sneeze: (plant: number) => void;

  constructor(layout: Layout, day: number, bedTop: number, reducedMotion: boolean, sneeze: (plant: number) => void) {
    this.layout = layout;
    this.day = day;
    this.bedTop = bedTop;
    this.reducedMotion = reducedMotion;
    this.sneeze = sneeze;
    this.heads = dandelions(layout, day);
    this.blown = this.heads.map(() => false);
    this.blows = this.heads.map(() => null);
    this.targets = this.heads.map((_, i) => ({ at: "clock", i }));
    this.reach = { a: "blow", target: this.targets[0] };
  }

  /** The nearest clock still to blow within reach of (x, z), or -1. The one the button shows now (`held`) stays in reach REACH_SLACK farther (#838). */
  private clockNear(x: number, z: number, held: ToyTarget | null): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.heads.length; i++) {
      const d = Math.hypot(this.heads[i].x - x, this.heads[i].z - z);
      if (!this.blown[i] && d < bestD && d < REACH + (held === this.targets[i] ? REACH_SLACK : 0)) [best, bestD] = [i, d];
    }
    return best;
  }

  /** What the action button can do from (x, z), and on what: blow a clock in reach. Null when nothing here. */
  reachAt(x: number, z: number, held: ToyTarget | null): { a: ToyAct; target: ToyTarget } | null {
    const i = this.clockNear(x, z, held);
    if (i < 0) return null;
    this.reach.target = this.targets[i];
    return this.reach;
  }

  /** The target for clock `i`, the same object reachAt returns. */
  clock(i: number): ToyTarget {
    return this.targets[i];
  }

  /** Where to walk to blow a clock from afar, and whether you are near enough already. */
  standFor(i: number, x: number, z: number): { x: number; z: number; near: boolean } {
    const h = this.heads[i];
    return { x: h.x, z: h.z, near: Math.hypot(x - h.x, z - h.z) < REACH };
  }

  /** Blow clock `i` at `now` (s): its seeds go with today's wind, and it stands bare for the rest of the walk. False when it is blown already. */
  blow(i: number, now: number): boolean {
    if (this.blown[i]) return false;
    this.blown[i] = true;
    const flights = Array.from({ length: SEEDS }, (_, k) => flight(this.layout, this.heads[i], this.day, k, this.bedTop));
    this.blows[i] = { at: now, flights, landed: new Uint8Array(SEEDS), ends: blowEnds(flights, this.reducedMotion) };
    return true;
  }

  /** The seeds as of `elapsed` (s): one that lands on a plant makes it sneeze; a blow whose seeds have all gone ends. Allocates nothing. */
  step(elapsed: number) {
    for (let h = 0; h < this.blows.length; h++) {
      const b = this.blows[h];
      if (!b) continue;
      const t = elapsed - b.at;
      for (let i = 0; i < SEEDS; i++) {
        const f = b.flights[i];
        if (b.landed[i] || t < f.delay + f.time) continue;
        b.landed[i] = 1;
        // With reduced motion nothing lands: the seeds fade on the clock.
        if (f.plant >= 0 && !this.reducedMotion) this.sneeze(f.plant);
      }
      if (t > b.ends) this.blows[h] = null;
    }
  }
}
