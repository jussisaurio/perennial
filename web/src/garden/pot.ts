// Two seeds, one pot (#387, #335 S7): take a seed from a visitor's word plant
// (the plant is not harmed), carry two to the clay pot by the shed, and put
// them in. In the night after the second, a little creature hatches: the first
// seed's animal with one trait of the second's (a cat with wings, a green
// snail). Let it out and it wanders the garden. Two seeds of one kind hatch a
// little one. What is in the pot and who hatched is the synced value
// (contract/garden.ts); whether it has hatched is worked out from calendar
// days, so every device shows the same. Pure.

import { NO_POT, POT_LIMITS, type GardenPot } from "perennial-contract";
import type { GardenWord } from "../deck/schema";
import { shedAt } from "./leave";
import type { Layout } from "./world";

export type Pot = GardenPot;
export { NO_POT };

/** The visitors whose word's plant gives seeds: the garden-word visitors that are drawn. Ids are stable: they sync. */
export const POT_KINDS = ["cat", "bird", "dog", "fish", "butterfly", "frog", "snail"] as const satisfies readonly GardenWord[];
export type PotKind = (typeof POT_KINDS)[number];

const isPotKind = (id: string): id is PotKind => (POT_KINDS as readonly string[]).includes(id);

/** What each kind gives the other: one natural trait. */
export type Trait = "whiskers" | "wings" | "ears" | "fins" | "antennae" | "green" | "shell";
export const TRAITS: Record<PotKind, Trait> = {
  cat: "whiskers",
  bird: "wings",
  dog: "ears",
  fish: "fins",
  butterfly: "antennae",
  frog: "green",
  snail: "shell",
};

/** A creature: the first seed's kind, with the second one's trait; the same kind twice is a little one, with no trait. */
export interface Creature {
  base: PotKind;
  trait: PotKind;
}

/** The trait a creature has, or null for a little one (two seeds of its own kind). */
export const traitOf = (c: Creature): Trait | null => (c.base === c.trait ? null : TRAITS[c.trait]);

/** The seed a plant gives: its word's visitor, if that is one of the pot's kinds. */
export function seedOf(p: { garden?: GardenWord }): PotKind | null {
  return p.garden && isPotKind(p.garden) ? p.garden : null;
}

/** At most this many creatures wander the garden: when another comes out, the oldest goes off over the fence. */
export const WANDER = 6;

/** The pot today: empty, holding one or two seeds, or with a creature hatched in it, waiting to be let out. */
export type PotNow = { kind: "empty" } | { kind: "seeds"; seeds: readonly PotKind[] } | { kind: "hatched"; creature: Creature };

/**
 * The pot as of `today` (core/day.ts dayNumber). Two seeds hatch in the night
 * after the second went in, and the creature waits in the pot until it is let
 * out. Seeds of a kind this app does not draw (a newer app's) wait in the pot.
 */
export function potNow(pot: Pot, today: number): PotNow {
  const [a, b] = pot.seeds;
  if (a === undefined) return { kind: "empty" };
  if (b !== undefined && pot.day !== null && today > pot.day && isPotKind(a) && isPotKind(b)) return { kind: "hatched", creature: { base: a, trait: b } };
  return { kind: "seeds", seeds: pot.seeds.filter(isPotKind) };
}

/** Can a seed go in the pot now: it holds fewer than two. */
export const takes = (pot: Pot): boolean => pot.seeds.length < 2;

/** Put a seed in the pot on `day`; the second one fixes the night it hatches. Only while it `takes` one. */
export function sow(pot: Pot, kind: PotKind, day: number): Pot {
  const seeds = [...pot.seeds, kind];
  return { ...pot, sown: pot.sown + 1, seeds, day: seeds.length === 2 ? day : null };
}

/** Let the hatched creature out of the pot: it joins the list, and the pot is empty again. Only once it has hatched (potNow). */
export function letOut(pot: Pot, c: Creature): Pot {
  return { ...pot, out: pot.out + 1, seeds: [], day: null, hatched: [...pot.hatched, c].slice(-POT_LIMITS.hatched) };
}

/** The creatures that wander the garden: the newest WANDER let out, oldest first. Kinds this app does not draw stay away. */
export function wandering(pot: Pot): Creature[] {
  return pot.hatched
    .slice(-WANDER)
    .flatMap((c) => (isPotKind(c.base) && isPotKind(c.trait) ? [{ base: c.base, trait: c.trait }] : []));
}

/**
 * What the walk is given: the synced value and the calendar day as the walk
 * opened (whether it hatched is fixed for the walk). `dayNow`: the day when a
 * seed goes in, so a walk open past midnight sows it on the new day.
 */
export interface PotWalk {
  pot: Pot;
  today: number;
  dayNow: () => number;
}

/** The clay pot: on the ground in front of the shed, at its end away from the gate. */
export function potAt(l: Layout): { x: number; z: number } {
  const s = shedAt(l);
  return { x: s.x - 1.1, z: s.z - 1.2 };
}
