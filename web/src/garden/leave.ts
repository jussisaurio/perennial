// Leave it out (#351, the first slice of #335: the bowl). You carry crumbs, or
// a fruit you know, from the basket on the shed's step to the bowl by the gate,
// and leave them there. At night, while you are away, someone comes for them:
// the more nights away, the stranger the guest. Back in the garden, prints lead
// from the bowl to what the guest left, you pick it up, and you keep it on the
// shed's shelf. What came is worked out from calendar days in the synced value
// (contract/garden.ts), never stored, so every device shows the same. Pure.

import { NO_LEFT, type GardenLeft } from "perennial-contract";
import type { GardenWord, OrchardWord } from "../deck/schema";
import { hash32 } from "../lib/seed";
import type { NounDef } from "./nouns";
import { GATE_HALF } from "./visitors";
import type { Layout } from "./world";

export type Left = GardenLeft;
export { NO_LEFT };

/** Who comes to the bowl at night. The dog is the garden's own visitor (#209); the others come from the wild. */
export type Guest = "sparrow" | "mouse" | "dog" | "hedgehog" | "fox";

/** What a guest leaves, to find and keep. Ids are stable: they sync (contract/garden.ts `kept`). */
export const FINDS = {
  feather: { words: { es: "la pluma", de: "die Feder" }, gloss: "feather" },
  acorn: { words: { es: "la bellota", de: "die Eichel" }, gloss: "acorn" },
  button: { words: { es: "el botón", de: "der Knopf" }, gloss: "button" },
  bone: { words: { es: "el hueso", de: "der Knochen" }, gloss: "bone" },
  leaf: { words: { es: "la hoja", de: "das Blatt" }, gloss: "leaf" },
  ribbon: { words: { es: "la cinta", de: "das Band" }, gloss: "ribbon" },
} as const satisfies Record<string, NounDef>;
export type Find = keyof typeof FINDS;

export const isFind = (id: string): id is Find => id in FINDS;

/** Where a find lies: fixed places by the gate, the hedge and the shed, which never move when the beds do. */
export type FindSpot = "post" | "shed" | "hedge" | "corner" | "far";

/**
 * One way the night can go: after at least `nights` nights away, `guest` comes
 * (only if `needs`, a garden word's visitor, lived here by then) and leaves one
 * of `finds` at `at`. Nights are 1, 3, 14 or 42 (#335's tiers: an ordinary
 * guest, a shy one, a stranger one, the strange one).
 */
export interface Row {
  nights: 1 | 3 | 14 | 42;
  needs?: GardenWord;
  guest: Guest;
  finds: readonly Find[];
  at: FindSpot;
}

/**
 * The bowl's table. More rows (other places, seasons, the garden's other
 * visitors) are more lines here. The dog shares the three-night tier with the
 * mouse once it lives in the garden: the seed picks one of the two.
 */
export const ROWS: readonly Row[] = [
  { nights: 1, guest: "sparrow", finds: ["feather"], at: "post" },
  { nights: 3, guest: "mouse", finds: ["acorn", "button"], at: "shed" },
  { nights: 3, needs: "dog", guest: "dog", finds: ["bone"], at: "hedge" },
  { nights: 14, guest: "hedgehog", finds: ["leaf"], at: "corner" },
  { nights: 42, guest: "fox", finds: ["ribbon"], at: "far" },
];

/** What the learner's reviews say for the rows: the calendar day (core/day.ts dayNumber) each garden word brought its visitor. */
export interface LeaveFacts {
  brought: Partial<Record<GardenWord, number>>;
}

/** What came for the thing in the bowl, and what it left where. */
export interface Outcome {
  row: Row;
  find: Find;
  nights: number;
}

/**
 * What came for the thing left in the bowl, as of `conditions.day` (today), or
 * null: nothing left, already found, or not one night yet. The nights are
 * counted in calendar days from the day it was left to the first later day the
 * garden was walked (`seen`), or to today before that: so a find waits, the
 * same, until it is picked up. The highest tier that fits wins; a row whose
 * visitor did not live here by then is skipped; ties and variants are picked
 * by a seed of the day and the thing, never by chance.
 */
export function resolve(left: Left, conditions: { day: number }, facts: LeaveFacts): Outcome | null {
  const b = left.bowl;
  if (!b || b.found) return null;
  const end = b.seen ?? conditions.day;
  const nights = end - b.day;
  if (nights < 1) return null;
  // `?? Infinity`: a visitor never brought never lived here.
  const fits = ROWS.filter((r) => r.nights <= nights && (!r.needs || (facts.brought[r.needs] ?? Infinity) <= end));
  const top = Math.max(...fits.map((r) => r.nights));
  const ties = fits.filter((r) => r.nights === top);
  const seed = hash32(`${b.day}:${b.thing}:bowl`);
  const row = ties[seed % ties.length];
  return { row, find: row.finds[(seed >>> 8) % row.finds.length], nights };
}

/** The bowl today: empty, holding what was left today, or empty with prints leading off to what came. */
export type BowlNow = { kind: "empty" } | { kind: "holds"; thing: string } | { kind: "came"; outcome: Outcome };

export function bowlNow(left: Left, today: number, facts: LeaveFacts): BowlNow {
  const b = left.bowl;
  if (!b || b.found) return { kind: "empty" };
  const outcome = resolve(left, { day: today }, facts);
  return outcome ? { kind: "came", outcome } : { kind: "holds", thing: b.thing };
}

/**
 * The garden is walked on a day after the night: from now on the nights are
 * counted to today, so what came stays what it is until it is found. Null when
 * nothing changes.
 */
export function walked(left: Left, today: number): Left | null {
  const b = left.bowl;
  if (!b || b.found || b.seen !== null || today <= b.day) return null;
  return { ...left, bowl: { ...b, seen: today } };
}

/** Leave a thing in the bowl today. Only while the bowl is empty (bowlNow): one thing at a time, and what came waits to be found. */
export function leave(left: Left, thing: string, today: number): Left {
  return { ...left, n: left.n + 1, bowl: { thing, day: today, seen: null, found: false } };
}

/** Pick up what came: it is kept from now on, on every device, even before it hangs on the shelf. */
export function pickUp(left: Left, find: Find): Left {
  const b = left.bowl!;
  return { ...left, bowl: { ...b, found: true }, kept: left.kept.includes(find) ? left.kept : [...left.kept, find] };
}

/** Hang a kept thing on a hook (what hung there goes back on the board), or take it down (null). */
export function hang(left: Left, hook: number, find: Find | null): Left {
  const hooks = left.hooks.map((h, i) => (i === hook ? find : h === find ? null : h)) as Left["hooks"];
  return { ...left, hooks };
}

/** The kept things that hang on no hook: they lie on the shelf's board. */
export const onBoard = (left: Left): Find[] => left.kept.filter((k): k is Find => isFind(k) && !left.hooks.includes(k));

/** What the basket offers: the crumbs, and up to this many fruits the learner knows. */
export const BASKET_FRUITS = 3;

/** A fruit word the learner knows, as the basket offers it. */
export interface Fruit {
  id: string;
  lemma: string;
  gloss: string;
  kind: Exclude<OrchardWord, "tree">;
}

/** A thing to carry from the basket: the crumbs, or a fruit (a deck word). */
export type BasketThing = { id: "crumbs" } | ({ id: string } & Fruit);

/** The basket: the crumbs, then the first BASKET_FRUITS known fruits (in the order given), never quizzed. */
export function basket(fruits: readonly Fruit[]): BasketThing[] {
  return [{ id: "crumbs" }, ...fruits.slice(0, BASKET_FRUITS)];
}

// ---- Places: fixed spots by the gate, the hedge and the shed (the beds can grow; these stay) ----

/** The bowl by the gate, a little in from it, to the right of the path. */
export function bowlAt(l: Layout): { x: number; z: number } {
  return { x: l.gate.x + 1.8, z: l.bounds.maxZ - 2.9 };
}

/** The little shed against the right fence: the middle of its back wall, where the shelf hangs; it faces into the garden (−x). */
export function shedAt(l: Layout): { x: number; z: number } {
  return { x: l.bounds.maxX - 0.3, z: l.bounds.maxZ - 2.4 };
}

/** The basket, on the shed's step at its far end. */
export function basketAt(l: Layout): { x: number; z: number } {
  const s = shedAt(l);
  return { x: s.x - 0.75, z: s.z - 0.75 };
}

/** Where a find lies. */
export function findAt(l: Layout, spot: FindSpot): { x: number; z: number } {
  const { gate, bounds: b } = l;
  switch (spot) {
    case "post":
      // At the foot of the gate's right post.
      return { x: gate.x + GATE_HALF + 0.25, z: b.maxZ - 0.22 };
    case "shed":
      // Round the shed's far end, by the fence.
      return { x: b.maxX - 0.35, z: shedAt(l).z - 1.5 };
    case "hedge":
      // Under the hedge, left of the door.
      return { x: gate.x - 2.6, z: b.maxZ - 0.3 };
    case "corner":
      // The corner by the hedge, past the shed.
      return { x: b.maxX - 0.4, z: b.maxZ - 0.35 };
    case "far":
      // The far corner past the pond.
      return { x: b.minX + 0.5, z: b.maxZ - 0.45 };
  }
}
