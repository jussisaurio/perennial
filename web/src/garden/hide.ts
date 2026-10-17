// The gnome's hide-and-seek (#379, #335's S3). On some days the gnome is not
// at its bed corner: it hides somewhere new for the day. Which days, and
// where, come from the calendar day and the garden's age (calendar days since
// the first review, never words or study days): an older garden hides it more
// often, and in cleverer places. Pure, and nothing is saved: finding it again
// after a reload is fine.

import { daily, today } from "../core/day";
import { hash32 } from "../lib/seed";
import { DOOR_SIDE } from "./orchard";
import { padByGate, type Spots } from "./spots";
import type { Hideout } from "./kinds/kind";
import { BED_H, type Layout, type PlacedPlant } from "./world";

/** The action button finds it from this near (m), along the ground. */
export const SEEK_REACH = 1.5;

/** How it looks where it hides: crouched with its hat and eyes peeking out, a lily pad on its head, or standing very still. */
export type HideLook = "peek" | "pad" | "front";

/** Where it hides today: on the ground, in a bed or on top of something, and how it looks there. */
export interface Hiding {
  x: number;
  y: number;
  z: number;
  look: HideLook;
  where: Hideout;
}

/** How often it hides: on about this share of days in a new garden, growing to `grown` in a garden `days` old. */
const OFTEN = { young: 0.45, grown: 0.7, days: 120 } as const;

/** Does it hide today, in a garden `age` days old? The same all day. */
export function hidesToday(age: number, now: Date): boolean {
  const share = OFTEN.young + (OFTEN.grown - OFTEN.young) * Math.min(1, age / OFTEN.days);
  return (hash32(`${today(now)}:gnome-hides`) % 1000) / 1000 < share;
}

/**
 * The places it hides, and the garden's age (days) from which each comes. A
 * young garden has the easy ones: behind a plant in the front row of a bed
 * (facing the gate, where you walk in), under the bench, on the sign. Then the
 * pond, the leaf piles, behind any plant at a bed's edge, and the orchard.
 */
export const PLACES = { front: 0, bench: 0, sign: 0, pads: 5, leaves: 10, edges: 14, orchard: 14 } as const;
export type Place = keyof typeof PLACES;

/** A plant this near its bed's edge (m) is in reach from the path. It crouches this far behind it (m), away from the path. */
const EDGE = 0.8;
const BEHIND = 0.2;

/** Crouched behind a plant at its bed's edge, away from the path; null for a plant deeper in its bed, or one not in the front row when `front`. */
function behindPlant(l: Layout, p: PlacedPlant, front: boolean): Hiding | null {
  const bed = l.beds[p.bed];
  // Each edge: how far the plant is from it, and the way away from it. The front (the gate side, +z) first.
  const edges: [number, number, number][] = [
    [bed.z + bed.d / 2 - p.z, 0, -1],
    [p.z - (bed.z - bed.d / 2), 0, 1],
    [p.x - (bed.x - bed.w / 2), 1, 0],
    [bed.x + bed.w / 2 - p.x, -1, 0],
  ];
  const near = edges.reduce((a, e) => (e[0] < a[0] ? e : a));
  if (near[0] > EDGE || (front && near !== edges[0])) return null;
  return { x: p.x + near[1] * BEHIND, y: BED_H, z: p.z + near[2] * BEHIND, look: "peek", where: { text: "behind", word: p.lemma } };
}

/** Every spot of a place in this garden today (none where it has nothing: no plants, no autumn, the door shut). */
function spotsOf(place: Place, l: Layout, s: Spots): Hiding[] {
  switch (place) {
    case "front":
    case "edges":
      // null: a plant deeper in its bed, or not in the front row.
      return l.plants.flatMap((p) => behindPlant(l, p, place === "front") ?? []);
    case "bench":
      // Under the seat (0.42 m up), toward one end, clear of the key's spot at the other.
      return [{ x: s.bench.x - 0.25, y: 0, z: s.bench.z + 0.05, look: "peek", where: { text: "under the bench", word: null } }];
    case "sign":
      return [{ x: s.sign[0], y: s.sign[1], z: s.sign[2], look: "front", where: { text: "on the sign", word: null } }];
    case "pads": {
      // Not the frog's pad, by the gate.
      const frog = padByGate(s, l);
      return s.pads.filter((p) => p !== frog).map(([x, z]) => ({ x, y: 0.05, z, look: "pad", where: { text: "among the lily pads", word: null } }));
    }
    case "leaves":
      return s.piles.map((p) => ({ x: p.x, y: 0, z: p.z - 0.25, look: "peek", where: { text: "behind the leaves", word: null } }));
    case "orchard":
      // Beside the trunk, on the far side from the door.
      return s.orchard.map((t) => ({ x: t.x + t.trunk, y: 0, z: t.z - DOOR_SIDE * 0.3, look: "peek", where: { text: "behind", word: t.lemma } }));
  }
}

/** Where the gnome hides today in a garden `age` days old, or null on a day it stays at its own spot. */
export function hideout(l: Layout, s: Spots, age: number, now: Date): Hiding | null {
  if (!hidesToday(age, now)) return null;
  const places = (Object.keys(PLACES) as Place[]).filter((p) => age >= PLACES[p]);
  const open = places.map((p) => spotsOf(p, l, s)).filter((spots) => spots.length);
  return daily(daily(open, "gnome-hides-place", now), "gnome-hides-spot", now);
}
