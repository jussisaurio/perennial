// Sitting on the bench (#362, #335's V4): sit still and the garden comes to
// you. Time speeds up (the light moves on through the day, the clouds race)
// and the visitors already in the garden come to sit with you. Only how it is
// timed lives here, as pure functions of the seconds sat, so it is easy to
// test; the scene (scene.ts) counts those seconds from its Frame and draws it.
// None of it changes the real clock, the time-of-day button or saved data.

import type { TimeOfDay } from "./scene";
import type { PerLang } from "./nouns";
import type { VisitorId } from "./visitors";

/**
 * The time-lapse: sit still `still` s and time starts to speed up, reaching
 * full speed over `ramp` s; then one part of the day passes every `part` s.
 * Standing up runs it back to the time it was at `back` parts a second.
 */
export const LAPSE = { still: 6, ramp: 4, part: 15, back: 1.2 };

/** The parts of the day, in the order time passes them. */
const DAY: readonly TimeOfDay[] = ["day", "dusk", "night"];

const ease = (k: number) => k * k * (3 - 2 * k);

/** How fast time runs (parts of the day a second) once you have sat still for `sat` seconds. */
export function lapseRate(sat: number): number {
  return ease(Math.max(0, Math.min(1, (sat - LAPSE.still) / LAPSE.ramp))) / LAPSE.part;
}

/**
 * Standing up: how fast time runs back (parts of the day a second, negative
 * for back) from `lapse` parts of the day past the real time. It goes to the
 * nearest same time of day, so after most of a day it runs on, not back.
 */
export function backRate(lapse: number): number {
  const to = Math.round(lapse / DAY.length) * DAY.length;
  return Math.sign(to - lapse) * LAPSE.back;
}

/** One frame of standing up: `lapse` runs at backRate for `dt` seconds, and is 0 once it is back to the real time. */
export function settle(lapse: number, dt: number): number {
  const to = Math.round(lapse / DAY.length) * DAY.length;
  const next = lapse + backRate(lapse) * dt;
  return (lapse < to ? next >= to : next <= to) ? 0 : next;
}

/** A look between two parts of the day: `k` 0 is all `from`, 1 all `to`. */
export interface Look {
  from: TimeOfDay;
  to: TimeOfDay;
  k: number;
}

/**
 * The look `lapse` parts of the day after `start`, into `out` (the scene calls
 * this every frame). Eased, so each part of the day lingers before the next.
 */
export function lapseLook(start: TimeOfDay, lapse: number, out: Look): Look {
  const i = DAY.indexOf(start) + Math.floor(lapse);
  out.from = DAY[i % DAY.length];
  out.to = DAY[(i + 1) % DAY.length];
  out.k = ease(lapse - Math.floor(lapse));
  return out;
}

/** Toward the sun by day (high in the south-west) and at dusk (low in the west), and the moon at night (in the east). */
export const SUN_AT: Record<TimeOfDay, readonly [number, number, number]> = {
  day: [-0.5, 0.55, -0.7],
  dusk: [-0.95, 0.12, -0.3],
  night: [0.6, 0.45, -0.65],
};
/** How far below the horizon the sun sets and the moon rises from (the height of the unnormalised direction). */
const BELOW = -0.3;

/**
 * Toward the sun or the moon, part way through a look (not normalised), into
 * `out`. The sun moves from day to dusk; between the sun and the moon, the
 * one sets in the first half and the other rises in the second.
 */
export function sunPath(look: Look, out: [number, number, number]): [number, number, number] {
  const a = SUN_AT[look.from];
  const b = SUN_AT[look.to];
  const k = look.k;
  // No arrays made here: the scene calls this every frame.
  if ((look.from === "night") === (look.to === "night")) for (let i = 0; i < 3; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  else {
    const p = k < 0.5 ? a : b;
    out[0] = p[0];
    out[1] = k < 0.5 ? a[1] + (BELOW - a[1]) * k * 2 : BELOW + (b[1] - BELOW) * (k - 0.5) * 2;
    out[2] = p[2];
  }
  return out;
}

/** Who comes to sit with you, if they are in the garden today, and after how many seconds of sitting. */
export const COMPANY = [
  { id: "bird", after: 10 },
  { id: "cat", after: 20 },
  { id: "gnome", after: 40 },
] as const satisfies readonly { id: VisitorId; after: number }[];

export type Companion = (typeof COMPANY)[number]["id"];

/**
 * Where each sits, from the bench's middle in metres (along the seat, up,
 * forward; the bench faces +z and you sit near its left end): the bird on the
 * backrest, the cat curled up beside you, and the gnome on the grass past the
 * far end, where the cat does not hide it from you and you do not see it come.
 */
export const COMPANY_SPOT: Record<Companion, readonly [number, number, number]> = {
  bird: [0.6, 0.8, -0.2],
  cat: [0.25, 0.45, 0.02],
  gnome: [1.1, 0, 1],
};

/** The next visitor due on the bench after `sat` seconds, of those `here` today that have not `come` yet; or null. */
export function due(sat: number, here: (id: Companion) => boolean, come: ReadonlySet<Companion>): Companion | null {
  for (const c of COMPANY) if (sat >= c.after && here(c.id) && !come.has(c.id)) return c.id;
  return null;
}

/** The one word the gnome says when it sits down, in the course language. */
export const GNOME_WORD: PerLang<string> = { es: "Bonito.", de: "Schön." };

/** The head turns toward who just came over `turn` s, looks a while (`hold` s), and turns back to the pond. */
export const GLANCE = { turn: 1.2, hold: 2.8 };

/** How far the head has turned toward who came (0 to 1), `t` seconds after they came. */
export function glance(t: number): number {
  const { turn, hold } = GLANCE;
  if (t <= 0 || t >= 2 * turn + hold) return 0;
  return ease(t < turn ? t / turn : t < turn + hold ? 1 : 1 - (t - turn - hold) / turn);
}
