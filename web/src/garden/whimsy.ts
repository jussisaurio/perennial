// Small jokes in the walk-in garden: two signs whose text changes each day,
// and a sunflower that only looks at you when you stand in its sun.
// Pure functions, so they are easy to test.

import { daily, rareDay } from "../core/day";
import { inLang, type PerLang } from "./nouns";

export interface SignLine {
  text: string;
  /** Drawn upside down, for "This side up". */
  upsideDown?: boolean;
  /** BCP 47 code when the line is in the course language. */
  lang?: string;
}

/**
 * Lines for either sign. Every line must be true in the garden: Shift is the
 * run key, the pond has no fish, the lanterns come on in the evening.
 */
export const SIGN_POOL: readonly SignLine[] = [
  { text: "Please walk slowly. Words are growing." },
  { text: "No running during your Shift." },
  { text: "Do not feed the verbs." },
  { text: "Quiet, please. Words sleeping." },
  { text: "Snail crossing" },
  { text: "This side up", upsideDown: true },
  { text: "Please do not pick the words." },
  { text: "Keep off the soil." },
  { text: "No fishing. No fish." },
  { text: "Lanterns come on at dusk." },
  { text: "Words may grow without warning." },
  { text: "This is a sign." },
  { text: "Gate: always open." },
  { text: "Slow growth area" },
  { text: "The sky is free." },
  { text: "Water the words, not the sign." },
  { text: "Please admire the plants." },
];

/** Extra lines that only make sense in one place. */
export const BENCH_LINES: readonly SignLine[] = [{ text: "Bench: for sitting." }, { text: "Bench. Pond. View." }];
export const FENCE_LINES: readonly SignLine[] = [{ text: "Fence: keeps the words in." }, { text: "End of garden. For now." }];

/** About one day in four, one sign is in the language you are learning. */
export const LOCAL_LINES: PerLang<readonly string[]> = {
  es: ["Silencio, por favor", "Agua: sí", "Despacio, por favor", "Prohibido pisar la tierra"],
  de: ["Bitte leise", "Kein Eis", "Langsam gehen, bitte", "Erde nicht betreten"],
};

/** Today's text for the back-fence sign and the bench sign. Never the same line twice. */
export function pickSigns(lang: string, now = new Date()): { fence: SignLine; bench: SignLine } {
  const fencePool = [...SIGN_POOL, ...FENCE_LINES];
  const benchPool = [...SIGN_POOL, ...BENCH_LINES];
  const local = inLang(LOCAL_LINES, lang);
  const fence: SignLine = local && rareDay(4, "sign-lang", now) ? { text: daily(local, "sign-local", now), lang } : daily(fencePool, "sign-fence", now);
  let bench = daily(benchPool, "sign-bench", now);
  if (bench.text === fence.text) bench = benchPool[(benchPool.indexOf(bench) + 1) % benchPool.length];
  return { fence, bench };
}

/**
 * Does the sunflower show its face? Only by day or at dusk, and only when the
 * viewer stands roughly between it and the sun (within about 60° of the sun's
 * direction as seen from the flower). At night it sleeps with its back to everyone.
 */
export function sunflowerFaces(flowerX: number, flowerZ: number, camX: number, camZ: number, sunX: number, sunZ: number, night: boolean): boolean {
  if (night) return false;
  const dx = camX - flowerX;
  const dz = camZ - flowerZ;
  const d = Math.hypot(dx, dz);
  const s = Math.hypot(sunX, sunZ);
  if (d < 1e-6 || s < 1e-6) return false;
  return (dx * sunX + dz * sunZ) / (d * s) > 0.5;
}

// ---- A plant that sleeps at night (#62) ----

/** The strip's sleeper snores only late at night (real clock). */
export const isSleepyHour = (now: Date = new Date()): boolean => now.getHours() >= 22 || now.getHours() < 5;

/** The verb "to sleep" per course language, for the sleeper's card in the walk. */
const SLEEP_VERB: PerLang<string> = { es: "dormir", de: "schlafen" };

/**
 * Tonight's sleeper: one blooming plant, picked by the date. The ids are
 * sorted first, so the strip and the walk agree whatever order they keep.
 */
export function sleeperId(bloomIds: readonly string[], now: Date = new Date()): string | null {
  if (!bloomIds.length) return null;
  return daily([...bloomIds].sort(), "sleeper", now);
}

/** The line on the sleeper's card: the snore first, then the verb it teaches. */
export function snoreLine(lang: string): string {
  const verb = inLang(SLEEP_VERB, lang);
  return verb ? `Zzz... (${verb} = to sleep)` : "Zzz...";
}

// ---- The plant hears its name (#60) ----

/** A perk: how long it takes to grow and to settle back (s). Under half a second in all. */
export const PERK = { rise: 0.15, fall: 0.25 } as const;
/** The neighbour's mistake: it starts a moment late and settles back slowly. */
export const NEIGHBOUR = { delay: 0.12, rise: 0.2, fall: 1.1 } as const;
/** How much a perking plant grows (fraction of its height). */
export const PERK_SCALE = 0.04;
/** On about one listen in this many, the neighbour perks up too, as if you called it. */
export const NEIGHBOUR_PERK = 30;

/** Does the neighbour think you called it this time? */
export const neighbourPerks = (rand: () => number = Math.random): boolean => rand() * NEIGHBOUR_PERK < 1;

/** The plant nearest to plant `i` (index), or -1 when it is alone. */
export function nearestPlant(plants: readonly { x: number; z: number }[], i: number): number {
  const p = plants[i];
  if (!p) return -1;
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < plants.length; k++) {
    if (k === i) continue;
    const d = Math.hypot(plants[k].x - p.x, plants[k].z - p.z);
    if (d < bestD) [best, bestD] = [k, d];
  }
  return best;
}

/** How far a perk has grown (0 to 1) `t` seconds after it began: up quickly, then down. 0 before and after. */
export function perkEnvelope(t: number, rise: number, fall: number): number {
  if (t <= 0 || t >= rise + fall) return 0;
  return t < rise ? Math.sin((t / rise) * (Math.PI / 2)) : 0.5 + 0.5 * Math.cos(((t - rise) / fall) * Math.PI);
}

// ---- The first-word keepsake (#61) ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The keepsake post's text: the first word and the day it was planted, e.g. "casa · 3 Oct". */
export function keepsakeLabel(lemma: string, at: number): string {
  const d = new Date(at);
  return `${lemma} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
