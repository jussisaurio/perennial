// Fetch (#335 S2): throw a loose thing near the dog, and it runs after it and
// proudly brings back... something. Usually what you threw; sometimes a thing
// from somewhere else in the garden (a fruit, the "This is a sign." sign, one
// sock), the gnome's hat, or, once in a long while, the gnome itself. What it
// brings is seeded per throw, so it varies, and the same surprise never comes
// twice in a row. Each one is a loose thing (carry.ts) you can pick up and
// throw again. Nothing is saved: next visit the sock is gone again. Pure.

import { hash32 } from "../lib/seed";
import type { Fruit } from "./leave";
import type { NounDef } from "./nouns";
import { visitor } from "./visitors";

/** A loose thing the dog runs after, and brings back. */
export type Fetchable = "stick" | "sock" | "sign" | "hat" | "gnome" | "fruit";
/** What it may bring instead of what you threw. The stick is always in the garden already, so it is never a surprise. */
export type Surprise = Exclude<Fetchable, "stick">;

/** How often it brings back what you threw, next to the surprises' weights. */
export const USUAL = 60;
/** How often each surprise comes, when it can. The gnome is the rare one: about one throw in a hundred. */
export const SURPRISE: Record<Surprise, number> = { fruit: 12, sign: 10, sock: 12, hat: 8, gnome: 1 };

/** The seed of the visit's `n`th fetch (0 first) on calendar day `day`: the same throws bring the same things all day. */
export const fetchSeed = (day: number, n: number): number => hash32(`fetch:${day}:${n}`);

/**
 * What the dog brings back for `thrown`. `can`: the surprises that can come
 * now (not out in the garden already; the gnome's only while it is here with
 * its hat on). `last`: the last surprise it brought, which never comes twice
 * in a row.
 */
export function pickFetch(seed: number, thrown: Fetchable, can: readonly Surprise[], last: Surprise | null): Fetchable {
  let total = USUAL;
  for (const s of can) if (s !== thrown && s !== last) total += SURPRISE[s];
  let r = seed % total;
  if (r < USUAL) return thrown;
  r -= USUAL;
  for (const s of can) {
    if (s === thrown || s === last) continue;
    if (r < SURPRISE[s]) return s;
    r -= SURPRISE[s];
  }
  throw new Error("pickFetch: the weights do not add up");
}

/** The words on the tag of what it brings (the gnome's is its visitor word; a fruit's is its own deck word). */
export const FETCH_WORDS: Record<Exclude<Fetchable, "fruit">, NounDef> = {
  stick: { words: { es: "el palo", de: "der Stock" }, gloss: "stick" },
  sock: { words: { es: "el calcetín", de: "die Socke" }, gloss: "sock" },
  sign: { words: { es: "el letrero", de: "das Schild" }, gloss: "sign" },
  hat: { words: { es: "el gorro", de: "die Mütze" }, gloss: "hat" },
  gnome: visitor("gnome"),
};

/** What a screen reader hears when it drops it at your feet; the tag's word follows. */
export const BROUGHT: Record<Fetchable, string> = {
  stick: "The dog brings back the stick.",
  sock: "The dog brings back a sock. Nobody knows whose.",
  sign: "The dog brings back a sign. It says: This is a sign.",
  hat: "The dog brings back the gnome's hat. The gnome turns to the fence.",
  gnome: "The dog brings back the gnome. It is very stiff.",
  fruit: "The dog brings back a fruit.",
};

/** The gnome has its hat back. */
export const HAT_BACK = "The gnome puts its hat back on.";

/** The fruit the dog may find today, from the fruits the learner knows: a lemon if they know it, or another, by the day. None: no fruit. */
export function fetchFruit(fruits: readonly Fruit[], day: number): Fruit | null {
  if (!fruits.length) return null;
  return fruits.find((f) => f.kind === "lemon") ?? fruits[hash32(`fetch-fruit:${day}`) % fruits.length];
}
