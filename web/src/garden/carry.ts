// Carry, throw and put down (#358): the small loose things in the garden
// (pebbles by the pond), where they lie, and what happens
// when one lands somewhere. What happens is data: one row per (thing, place), so a
// new joke is one row. Who answers (the frog, a plant, the well) is a small
// function each, on an interface the scene fills in. Nothing here is saved: a
// pebble thrown in the pond is back by the pond next visit.

import { collide, type Layout } from "./world";

/** A loose thing you can pick up. */
export type Loose = "pebble";

/** Where a thing lands: in the pond, down the orchard's well, in a bed, or on the ground. */
export type Place = "pond" | "well" | "bed" | "ground";

/** Who answers: the well's answer is its echo (#335 S6). */
export type Answer = "frog" | "plant" | "well";

/** What a landing does. */
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

/** The rows: (thing, place) → what happens. A place with no row here is the ground. */
const ROWS: Record<Loose, Partial<Record<Place, Reaction>>> = {
  pebble: {
    pond: { then: "sink", ripple: true, answer: "frog", said: "Plop. Rings spread on the water." },
    bed: { then: "lie", answer: "plant", said: "It lands by a plant." },
    well: { then: "sink", answer: "well", said: "It falls a long way. Plop." },
  },
};

export function reaction(thing: Loose, place: Place): Reaction {
  return ROWS[thing][place] ?? LIE;
}

/** How many pebbles the frog hops away from in one visit; after that it only looks at you. */
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

/** Where a thing that lands at (x, z) has landed. */
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
 * beside it, where a hand can reach it again.
 */
export function restAt(l: Layout, x: number, z: number, place: Place, doorOpen: boolean): { x: number; z: number } {
  return place === "pond" ? { x, z } : collide(l, x, z, 0.12, doorOpen);
}

// ---- Where things lie as the walk opens ----

/** How many pebbles wait by the pond. */
export const PEBBLES = 6;

/** The pebbles, in a small heap at the pond's edge on the gate's side. */
export function pebbleHome(l: Layout, i: number): { x: number; z: number } {
  const a = i * 2.4;
  const r = 0.06 + 0.05 * i;
  return { x: l.pond.x + l.pond.r + 0.55 + Math.cos(a) * r, z: l.pond.z + 0.5 + Math.sin(a) * r };
}

