// Carry, throw and put down (#358): the small loose things in the garden
// (pebbles by the pond), where they lie, and what happens
// when one lands somewhere. What happens is data: one row per place, so a
// new joke is one row. Who answers (the frog, a plant, the well) is a small
// function each, on an interface the scene fills in. Nothing here is saved: a
// pebble thrown in the pond is back by the pond next visit.

import { REACH_SLACK } from "./reach";
import { collide, type Layout } from "./world";

/** Where a thing lands: in the pond, down the orchard's well, in a bed, or on the ground. @internal Exported for tests. */
export type Place = "pond" | "well" | "bed" | "ground";

/** Who answers: the well's answer is its echo (#335 S6). */
export type Answer = "frog" | "plant" | "well";

/** What a landing does. @internal Exported for tests. */
export interface Reaction {
  /**
   * What becomes of the thing: it lies where it lands; or it sinks (and
   * another waits by the pond, so pebbles never run out).
   */
  then: "lie" | "sink";
  /** Rings spread on the water where it goes in. */
  ripple?: true;
  answer?: Answer;
  /** What a screen reader hears. The answer may add to it. */
  said: string;
}

/** Anything that lands where no row says otherwise. */
const LIE: Reaction = { then: "lie", said: "It lands on the ground." };

/** The rows: where a pebble lands → what happens. A place with no row here is the ground. */
const ROWS: Partial<Record<Place, Reaction>> = {
  pond: { then: "sink", ripple: true, answer: "frog", said: "Plop. Rings spread on the water." },
  bed: { then: "lie", answer: "plant", said: "It lands by a plant." },
  well: { then: "sink", answer: "well", said: "It falls a long way. Plop." },
};

/** What a landing at `place` does. @internal Exported for tests. */
export function reaction(place: Place): Reaction {
  return ROWS[place] ?? LIE;
}

/** How many pebbles the frog hops away from in one visit; after that it only looks at you. @internal Exported for tests. */
export const FROG_PATIENCE = 3;

/** Where a thing came down. */
export interface Down {
  x: number;
  z: number;
}

/** What the scene lets an answer do. Each returns false when that one is not here to answer. */
export interface Answerers {
  /** The frog on a lily pad hops to another pad. */
  frogHop(): boolean;
  /** The frog says something in a small bubble. */
  say(id: "frog", text: string): boolean;
  /** The plant nearest (x, z), if one is near, perks up. */
  perk(x: number, z: number): boolean;
  /** A moment later the well's echo says an old word (well.ts), for the `n`th pebble this visit, with its own line. */
  echo(n: number): void;
}

/**
 * Who answers, and what a screen reader then hears. `n`: how many times this
 * one has answered before, this visit.
 */
export const ANSWERS: Record<Answer, (who: Answerers, at: Down, n: number) => string | null> = {
  frog: (who, _, n) => (n < FROG_PATIENCE ? (who.frogHop() ? "The frog hops to another pad." : null) : who.say("frog", "…") ? "The frog looks at you." : null),
  plant: (who, at) => (who.perk(at.x, at.z) ? "A plant perks up." : null),
  // Nothing more now: the echo comes a moment later, and says itself.
  well: (who, _, n) => {
    who.echo(n);
    return null;
  },
};

/** Where a thing that lands at (x, z) has landed. @internal Exported for tests. */
export function placeAt(l: Layout, x: number, z: number): Place {
  if (Math.hypot(x - l.pond.x, z - l.pond.z) < l.pond.r) return "pond";
  // Behind the hedge: with the door shut, nothing thrown or carried gets this far.
  if (Math.hypot(x - l.well.x, z - l.well.z) < l.well.r) return "well";
  if (l.beds.some((b) => Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2)) return "bed";
  return "ground";
}

/** How far (m) a throw goes, ahead of you. */
const THROW = 3.2;

/** Where a throw from (x, z), facing `yaw` (forward is -z at yaw 0), comes down. */
export function aimAt(x: number, z: number, yaw: number): { x: number; z: number } {
  return { x: x - Math.sin(yaw) * THROW, z: z - Math.cos(yaw) * THROW };
}

/**
 * Where a thing that lands at (x, z) comes to rest: in the pond, where it fell;
 * out of the way otherwise: inside the fence, and off a bed onto the path
 * beside it, where a hand can reach it again. @internal Exported for tests.
 */
export function restAt(l: Layout, x: number, z: number, place: Place, doorOpen: boolean): { x: number; z: number } {
  return place === "pond" ? { x, z } : collide(l, x, z, 0.12, doorOpen);
}

// ---- Where things lie as the walk opens ----

/** How many pebbles wait by the pond. @internal Exported for tests. */
export const PEBBLES = 6;

/** The pebbles, in a small heap at the pond's edge on the gate's side. @internal Exported for tests. */
export function pebbleHome(l: Layout, i: number): { x: number; z: number } {
  const a = i * 2.4;
  const r = 0.06 + 0.05 * i;
  return { x: l.pond.x + l.pond.r + 0.55 + Math.cos(a) * r, z: l.pond.z + 0.5 + Math.sin(a) * r };
}

// ---- The pebbles in play ----

/** What the action button does with pebbles: pick one up, throw the one you hold where you face, or drop it in the well. */
export type CarryAct = "lift-pebble" | "throw" | "well";

/** What a tap or the action button acts on: a loose thing, the well, a point on the water to throw at, or the ground in reach to put a thing down on. */
export type CarryTarget = { at: "thing"; i: number } | { at: "well" } | { at: "water"; x: number; z: number } | { at: "ground"; x: number; z: number };

/** What a carry did, for the page to count (#335); and once a thing is down, what a screen reader hears. */
export type CarryDone = { did: "lift" | "throw" | "put" | "well" } | { did: "land"; said: string };

/** A thing came down: which one, where it was aimed, the place and its row, and what a screen reader hears (the game adds who answers). */
export interface Landing extends Down {
  i: number;
  place: Place;
  reaction: Reaction;
  said: string;
}

/** Near enough (m) to a loose thing to pick it up, or to a point on the water or ground to put a thing there. */
const REACH = 1.1;
/** Near enough (m) to the well's middle to drop a pebble in: a step from its stones. */
const WELL_REACH = 1.8;
/** A walk to the well heads for this far (m) in front of its stones, on the door's side. */
const WELL_FRONT = 0.5;
/** A walk to a loose thing, or to where a thing goes, stops this short of it. */
export const CARRY_STAND = 0.6;
/** A throw: it starts this far in front of you at this height, peaks this much above the line (plus some per metre), and flies this long (plus some per metre). */
const FLIGHT = { ahead: 0.3, from: 0.8, peak: 0.15, peakPerM: 0.05, s: 0.3, sPerM: 0.06 };

/** A pebble: where it is, and whether it lies free, is in your hand, or is in the air. */
export interface Pebble {
  x: number;
  y: number;
  z: number;
  at: "rest" | "held" | "flying";
  home: { x: number; z: number };
}

const near = (x: number, z: number, p: { x: number; z: number }, r: number) => Math.hypot(x - p.x, z - p.z) < r;

/**
 * The pebbles in play: which lies where, which you hold, the one in the air,
 * and the well once the door is open. It says what the action button can do
 * with them where you stand, does it, and tells `land` where one came down.
 */
export class Pebbles {
  readonly things: Pebble[];
  /** What you hold, by its index in `things`. */
  held: number | null = null;
  /** The well stands once the door is open (showWell). */
  wellShown = false;
  /** Counts each splash, and where the last one was: sceneCarry.ts spreads rings when `n` changes. */
  readonly ripple = { n: 0, x: 0, z: 0 };
  /** Every target reachAt can point at, and what it returns, made once: it allocates nothing. */
  private targets: { things: CarryTarget[]; well: CarryTarget };
  private reach: { a: CarryAct; target: CarryTarget | null } = { a: "throw", target: null };
  private flight: { i: number; from: [number, number, number]; to: [number, number, number]; peak: number; t: number; s: number; landing: Landing } | null = null;
  private layout: Layout;
  private reducedMotion: boolean;
  private doorOpen: () => boolean;
  private land: (l: Landing) => void;

  constructor(layout: Layout, reducedMotion: boolean, doorOpen: () => boolean, land: (l: Landing) => void) {
    this.layout = layout;
    this.reducedMotion = reducedMotion;
    this.doorOpen = doorOpen;
    this.land = land;
    this.things = Array.from({ length: PEBBLES }, (_, i): Pebble => ({ ...pebbleHome(layout, i), y: 0.01, at: "rest", home: pebbleHome(layout, i) }));
    this.targets = { things: this.things.map((_, i) => ({ at: "thing", i })), well: { at: "well" } };
  }

  /**
   * What the action button can do with pebbles from (x, z): holding one by
   * the well, drop it in; holding one elsewhere, throw it where you face;
   * empty-handed, pick up the nearest one in reach. What the button shows now
   * (`held`) stays in reach REACH_SLACK farther (#838).
   */
  reachAt(x: number, z: number, held: CarryTarget | null): { a: CarryAct; target: CarryTarget | null } | null {
    const r = this.reach;
    if (this.held !== null) {
      if (this.wellShown && near(x, z, this.layout.well, WELL_REACH + (held === this.targets.well ? REACH_SLACK : 0))) [r.a, r.target] = ["well", this.targets.well];
      else [r.a, r.target] = ["throw", null];
      return r;
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.things.length; i++) {
      const t = this.things[i];
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < bestD && d < REACH + (held === this.targets.things[i] ? REACH_SLACK : 0) && t.at === "rest") [best, bestD] = [i, d];
    }
    if (best < 0) return null;
    r.a = "lift-pebble";
    r.target = this.targets.things[best];
    return r;
  }

  /** The target for pebble `i`, the same object reachAt returns. */
  thing(i: number): CarryTarget {
    return this.targets.things[i];
  }

  /** Where to walk to act on a target from afar, and whether you are near enough already. */
  standFor(t: CarryTarget, x: number, z: number): { x: number; z: number; near: boolean } {
    const w = this.layout.well;
    // In front of its stones: a walker may not stand on the well's middle.
    if (t.at === "well") return { x: w.x, z: w.z - w.r - WELL_FRONT, near: near(x, z, w, WELL_REACH) };
    const at = t.at === "thing" ? this.things[t.i] : t;
    return { x: at.x, z: at.z, near: near(x, z, at, REACH) };
  }

  /** Pick a thing up. */
  lift(i: number): boolean {
    if (this.held !== null || this.things[i].at !== "rest") return false;
    this.things[i].at = "held";
    this.held = i;
    return true;
  }

  /**
   * Let go of what you hold, standing at (x, z), toward (ax, az): thrown in an
   * arc (`arc`), or put there by hand. What happens where it lands is its row
   * (ROWS). With reduced motion a throw lands at once.
   */
  letGo(x: number, z: number, ax: number, az: number, arc: boolean): boolean {
    const i = this.held;
    if (i === null) return false;
    const th = this.things[i];
    const place = placeAt(this.layout, ax, az);
    const rx = reaction(place);
    const rest = restAt(this.layout, ax, az, place, this.doorOpen());
    // Put down by hand on the ground: that is all that happened.
    const said = !arc && place === "ground" ? "You put it down." : rx.said;
    const landing: Landing = { i, place, x: ax, z: az, reaction: rx, said };
    this.held = null;
    th.at = "flying";
    if (!arc || this.reducedMotion) {
      [th.x, th.y, th.z] = [rest.x, 0.01, rest.z];
      this.down(i, landing);
      return true;
    }
    // Land any earlier throw still in the air: one flight at a time.
    if (this.flight) this.endFlight();
    const d = Math.hypot(ax - x, az - z);
    const k = FLIGHT.ahead / Math.max(d, 0.01);
    this.flight = { i, from: [x + (ax - x) * k, FLIGHT.from, z + (az - z) * k], to: [rest.x, 0.01, rest.z], peak: FLIGHT.peak + d * FLIGHT.peakPerM, t: 0, s: FLIGHT.s + d * FLIGHT.sPerM, landing };
    return true;
  }

  /** The flight, `dt` s on: a small arc. Allocates nothing. */
  step(dt: number) {
    const fl = this.flight;
    if (!fl) return;
    fl.t = Math.min(1, fl.t + dt / fl.s);
    const th = this.things[fl.i];
    const { from: a, to: b } = fl;
    th.x = a[0] + (b[0] - a[0]) * fl.t;
    th.z = a[2] + (b[2] - a[2]) * fl.t;
    th.y = a[1] + (b[1] - a[1]) * fl.t + Math.sin(Math.PI * fl.t) * fl.peak;
    if (fl.t >= 1) this.endFlight();
  }

  private endFlight() {
    const f = this.flight!;
    this.flight = null;
    const th = this.things[f.i];
    [th.x, th.y, th.z] = f.to;
    this.down(f.i, f.landing);
  }

  /** A thing came down: it sinks or lies, by its row; then the game hears where. */
  private down(i: number, l: Landing) {
    const th = this.things[i];
    const rx = l.reaction;
    if (rx.ripple) [this.ripple.n, this.ripple.x, this.ripple.z] = [this.ripple.n + 1, l.x, l.z];
    // Another waits by the pond: pebbles never run out.
    if (rx.then === "sink") [th.x, th.y, th.z, th.at] = [th.home.x, 0.01, th.home.z, "rest"];
    else th.at = "rest";
    this.land(l);
  }
}

