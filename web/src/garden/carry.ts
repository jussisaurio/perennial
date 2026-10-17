// Carry, put down, throw (#335 V2, #358): the small loose things in the garden
// (pebbles by the pond, a stick by the shed), where they lie, and what happens
// when one lands somewhere. What happens is data: one row per (thing, place),
// so a new joke is one row. Who answers (the frog, the dog, a plant, the well) is a small
// function each, on an interface the scene fills in. Nothing here is saved: a
// thrown pebble is back by the pond next visit.

import { hash32 } from "../lib/seed";
import { collide, type Layout } from "./world";

/** A loose thing you can pick up. */
export type Loose = "pebble" | "stick";

/** Where a thing lands: in the pond, on the flat stone by the pond (the cairn), down the orchard's well, by the dog, in a bed, or on the ground. */
export type Place = "pond" | "cairn" | "well" | "dog" | "bed" | "ground";

/** Who answers a landing: the well's answer is its echo (#335 S6). */
export type Answer = "frog" | "dog" | "plant" | "well";

/** What a landing does. */
export interface Reaction {
  /**
   * What becomes of the thing: it lies where it lands; it sinks (and another
   * waits by the pond, so pebbles never run out); it floats and drifts back to
   * the edge; or it goes on the cairn.
   */
  then: "lie" | "sink" | "float" | "stack";
  /** Rings spread on the water where it lands. */
  ripple?: true;
  answer?: Answer;
  /** What a screen reader hears. The answer may add to it. */
  said: string;
}

/** Anything that lands where no row says otherwise. */
const LIE: Reaction = { then: "lie", said: "It lands on the ground." };

/** The rows: (thing, place) → what happens. A place with no row here is the ground. */
export const ROWS: Record<Loose, Partial<Record<Place, Reaction>>> = {
  pebble: {
    pond: { then: "sink", ripple: true, answer: "frog", said: "Plop. Rings spread on the water." },
    // Too tall a cairn falls instead (cairnHolds): the scene then says CAIRN_FALLS.
    cairn: { then: "stack", said: "The stones wobble, then stand." },
    bed: { then: "lie", answer: "plant", said: "It lands by a plant." },
    well: { then: "sink", answer: "well", said: "It falls a long way. Plop." },
  },
  stick: {
    pond: { then: "float", ripple: true, said: "Splash. The stick floats." },
    // Fetch (#335 S2) grows from this row: for now the dog only sees the stick.
    dog: { then: "lie", answer: "dog", said: "It lands by the dog." },
    bed: { then: "lie", answer: "plant", said: "It lands by a plant." },
  },
};

export function reaction(thing: Loose, place: Place): Reaction {
  return ROWS[thing][place] ?? LIE;
}

/** How many pebbles the frog hops away from in one visit; after that it only looks at you. */
export const FROG_PATIENCE = 3;

/** What the scene lets an answer do. Each returns false when that one is not here to answer. */
export interface Answerers {
  /** The frog on a lily pad hops to another pad. */
  frogHop(): boolean;
  /** A visitor says something in a small bubble. */
  say(id: "frog" | "dog", text: string): boolean;
  /** The plant nearest (x, z), if one is near, perks up. */
  perk(x: number, z: number): boolean;
  /** A moment later the well's echo says an old word (well.ts), for the `n`th pebble this visit, with its own line. */
  echo(n: number): void;
}

/**
 * Who answers, and what a screen reader then hears. `n`: how many times this
 * one has answered before, this visit. Small functions, so each can move into
 * its visitor's own file (#324).
 */
export const ANSWERS: Record<Answer, (who: Answerers, at: { x: number; z: number }, n: number) => string | null> = {
  frog: (who, _, n) => (n < FROG_PATIENCE ? (who.frogHop() ? "The frog hops to another pad." : null) : who.say("frog", "…") ? "The frog looks at you." : null),
  dog: (who) => (who.say("dog", "!") ? "The dog looks at the stick." : null),
  plant: (who, at) => (who.perk(at.x, at.z) ? "A plant perks up." : null),
  // Nothing more now: the echo comes a moment later, and says itself.
  well: (who, _, n) => {
    who.echo(n);
    return null;
  },
};

/** How near (m) a landing must be to the cairn's stone, or the dog, to count as there. */
const CAIRN_R = 0.35;
const DOG_R = 1.2;

/** Where a thing that lands at (x, z) has landed. */
export function placeAt(l: Layout, x: number, z: number, dog: { x: number; z: number } | null): Place {
  if (Math.hypot(x - l.pond.x, z - l.pond.z) < l.pond.r) return "pond";
  const c = cairnAt(l);
  if (Math.hypot(x - c.x, z - c.z) < CAIRN_R) return "cairn";
  // Behind the hedge: with the door shut, nothing thrown or carried gets this far.
  if (Math.hypot(x - l.well.x, z - l.well.z) < l.well.r) return "well";
  if (dog && Math.hypot(x - dog.x, z - dog.z) < DOG_R) return "dog";
  if (l.beds.some((b) => Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2)) return "bed";
  return "ground";
}

/** How far (m) a throw goes, ahead of you. */
export const THROW = 3.2;

/** Where a throw from (x, z), facing `yaw` (forward is -z at yaw 0), comes down. */
export function aimAt(x: number, z: number, yaw: number, metres = THROW): { x: number; z: number } {
  return { x: x - Math.sin(yaw) * metres, z: z - Math.cos(yaw) * metres };
}

/**
 * Where a thing aimed at (x, z) comes to rest: in the pond, where it fell; out
 * of the ground's way otherwise: inside the fence, and off a bed onto the path
 * beside it, where a hand can reach it again.
 */
export function restAt(l: Layout, x: number, z: number, place: Place, doorOpen: boolean): { x: number; z: number } {
  return place === "pond" ? { x, z } : collide(l, x, z, 0.12, doorOpen);
}

/** The cairn of a visit stands this many pebbles high before the next one makes it fall: 3 to 5, a different height each day. */
export function cairnHolds(day: number): number {
  return 3 + (hash32(`cairn:${day}`) % 3);
}

export const CAIRN_FALLS = "The stones fall over. Plop.";

// ---- Where things lie as the walk opens ----

/** How many pebbles wait by the pond. */
export const PEBBLES = 6;

/** The pebbles, in a small heap at the pond's edge on the gate's side. */
export function pebbleHome(l: Layout, i: number): { x: number; z: number } {
  const a = i * 2.4;
  const r = 0.06 + 0.05 * i;
  return { x: l.pond.x + l.pond.r + 0.55 + Math.cos(a) * r, z: l.pond.z + 0.5 + Math.sin(a) * r };
}

/** The cairn's flat stone, between the pond and the bench's side of the path. */
export function cairnAt(l: Layout): { x: number; z: number } {
  return { x: l.pond.x + l.pond.r + 0.6, z: l.pond.z - 1.1 };
}

/** The stick, on the ground in front of the shed, toward the gate. */
export function stickHome(l: Layout): { x: number; z: number } {
  return { x: l.bounds.maxX - 1.6, z: l.bounds.maxZ - 1.1 };
}
