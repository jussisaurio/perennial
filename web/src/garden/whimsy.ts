// Small jokes in the walk-in garden: two signs whose text changes each day,
// a sunflower that only looks at you when you stand in its sun, and the
// deadpan scenery (#364): a sundial that tells the time, and a fish.
// Pure functions, so they are easy to test.

import { daily, dailyIndex } from "../core/day";
import type { DeckLang } from "../deck/langs";
import type { PerLang } from "./nouns";

export interface SignLine {
  text: string;
  /** Drawn upside down, for "This side up". */
  upsideDown?: boolean;
  /** Put right by hand (#364): `strike` (the end of the text) is crossed out, and `write` written in after it. */
  fix?: { strike: string; write: string };
}

/**
 * What the garden's own signs say (#650). They are in the world, so they are
 * in the course language, written as a sign there would put it: the learner
 * works a line out, or doesn't.
 */
interface Signs {
  /** Lines for either notice board. Every line must be true in the garden: Shift is the run key, and the lanterns come on in the evening. */
  pool: readonly SignLine[];
  /** Extra lines that only make sense by the bench, or on the back fence. */
  bench: readonly SignLine[];
  fence: readonly SignLine[];
  /** The bench's sign while the cat sits on the bench. */
  taken: string;
  /** The sign that turns out to be wrong (#364): the pond has no fish until the learner brings it, and then `strike` is crossed out for `write`. */
  noFish: { text: string; strike: string; write: string };
}

export const SIGNS: PerLang<Signs> = {
  es: {
    pool: [
      { text: "Despacio. Las palabras están creciendo." },
      { text: "Prohibido correr. Sí, también con Shift." },
      { text: "No alimentar a los verbos." },
      { text: "Silencio. Palabras durmiendo." },
      { text: "Paso de caracoles" },
      { text: "Este lado hacia arriba", upsideDown: true },
      { text: "No arranquen las palabras." },
      { text: "Prohibido pisar la tierra." },
      { text: "Los farolillos se encienden al anochecer." },
      { text: "Las palabras crecen sin previo aviso." },
      { text: "Esto es un cartel." },
      { text: "Verja: siempre abierta." },
      { text: "Zona de crecimiento lento" },
      { text: "El cielo es gratis." },
      { text: "Regar las palabras, no el cartel." },
      { text: "Se ruega admirar las plantas." },
      { text: "Agua: sí." },
    ],
    bench: [{ text: "Banco: para sentarse." }, { text: "Banco. Estanque. Vistas." }],
    fence: [{ text: "Valla. Las palabras, dentro." }, { text: "Fin del jardín. De momento." }],
    taken: "Banco: ocupado.",
    noFish: { text: "Prohibido pescar. No hay peces.", strike: "No hay peces.", write: "Hay uno." },
  },
  de: {
    pool: [
      { text: "Langsam gehen. Wörter wachsen." },
      { text: "Rennen verboten. Auch mit Shift." },
      { text: "Verben bitte nicht füttern." },
      { text: "Ruhe bitte. Wörter schlafen." },
      { text: "Achtung: Schneckenwanderung" },
      { text: "Diese Seite nach oben", upsideDown: true },
      { text: "Wörter pflücken verboten." },
      { text: "Erde nicht betreten." },
      { text: "Laternen gehen abends an." },
      { text: "Wörter wachsen ohne Vorwarnung." },
      { text: "Dies ist ein Schild." },
      { text: "Tor: immer offen." },
      { text: "Wachstumsberuhigte Zone" },
      { text: "Der Himmel ist gratis." },
      { text: "Wörter gießen, nicht das Schild." },
      { text: "Pflanzen bitte bewundern." },
      { text: "Kein Eis." },
    ],
    bench: [{ text: "Bank: zum Sitzen." }, { text: "Bank. Teich. Aussicht." }],
    fence: [{ text: "Zaun: hält die Wörter drin." }, { text: "Ende des Gartens. Vorerst." }],
    taken: "Bank: besetzt.",
    noFish: { text: "Angeln verboten. Keine Fische.", strike: "Keine Fische.", write: "Ein Fisch." },
  },
};

/** Today's text for the back-fence sign and the bench sign. Never the same line twice. */
export function pickSigns(lang: DeckLang, now = new Date()): { fence: SignLine; bench: SignLine } {
  const s = SIGNS[lang];
  const pool = [...s.pool, { text: s.noFish.text }];
  const fencePool = [...pool, ...s.fence];
  const benchPool = [...pool, ...s.bench];
  const fence = daily(fencePool, "sign-fence", now);
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

/**
 * Tonight's sleeper: one blooming plant, picked by the date. It is the k-th id
 * in sorted order, so the strip and the walk agree whatever order they keep.
 */
export function sleeperId(bloomIds: readonly string[], now: Date = new Date()): string | null {
  if (!bloomIds.length) return null;
  return kthSmallest([...bloomIds], dailyIndex(bloomIds.length, "sleeper", now));
}

/** The k-th smallest string (as `sort()` orders them), without sorting them all: quickselect, O(n) (#569). Reorders `xs`. */
function kthSmallest(xs: string[], k: number): string {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const pivot = xs[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (xs[i] < pivot) i++;
      while (xs[j] > pivot) j--;
      if (i <= j) {
        [xs[i], xs[j]] = [xs[j], xs[i]];
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return xs[k];
  }
  return xs[k];
}

// ---- The plant hears its name (#60) ----

/** A perk: how long it takes to grow and to settle back (s). Under half a second in all. */
export const PERK = { rise: 0.15, fall: 0.25 } as const;
/** The neighbour's mistake: it starts a moment late and settles back slowly. */
export const NEIGHBOUR = { delay: 0.12, rise: 0.2, fall: 1.1 } as const;
/** How much a perking plant grows (fraction of its height). */
export const PERK_SCALE = 0.04;
/** A sneeze (#360, a dandelion seed lands on the plant): a quick squash (fraction of its height), then it pops back (s). */
export const SNEEZE = { rise: 0.08, fall: 0.35, squash: 0.18 } as const;
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

/**
 * The keepsake post's text: the first word and the day it was planted, e.g.
 * "casa · 3 oct". `locale`: the course language in the walk, where the post
 * is in the world (#650); "en-GB" in the strip, a picture on the Today page.
 */
export function keepsakeLabel(lemma: string, at: number, locale: string): string {
  return `${lemma} · ${new Date(at).toLocaleDateString(locale, { day: "numeric", month: "short" })}`;
}

// ---- Deadpan scenery (#364) ----

/**
 * The fish swims in the pond once the learner has brought it (#209: they know
 * pez or Fisch): then "no fish" is crossed out by hand, and "one fish" written
 * in after it. Any other line stays as it is.
 */
export function fishSign(line: SignLine, fishHere: boolean, lang: DeckLang): SignLine {
  const { text, strike, write } = SIGNS[lang].noFish;
  return fishHere && line.text === text ? { ...line, fix: { strike, write } } : line;
}

/** What the sundial and the mouse door say when tapped: the dial only at night, when it has no shadow. In the course language (#650). */
export const JOKE_LINES: PerLang<{ sundial: string; mouseDoor: string }> = {
  es: { sundial: "Reloj de sol: cerrado hasta el amanecer.", mouseDoor: "Cerrado. No es tu talla." },
  de: { sundial: "Sonnenuhr: geschlossen bis Sonnenaufgang.", mouseDoor: "Abgeschlossen. Falsche Größe." },
};

/** The same jokes as a screen reader hears them: what the line means, in English. */
export const JOKE_SPOKEN = { sundial: "Sundial: closed until morning.", mouseDoor: "Locked. Wrong size." } as const;

/**
 * The sundial's shadow (#364) at the clock time `now`: radians round from the
 * dial's noon mark, 15° an hour, as the sun goes. Negative in the morning
 * (the shadow points west), positive after noon (east).
 */
export const sundialAngle = (now: Date): number => ((now.getHours() + now.getMinutes() / 60 - 12) * Math.PI) / 12;

/** Walking round the pond (#364): within `ring` m of its middle it counts; `jump` laps in one visit make a fish jump, once. */
export const POND_LAPS = { ring: 4, jump: 3 } as const;

/** How far round the pond the walker has gone this visit (radians, one way minus the other), and the angle they were last at (null: away from the pond). */
export interface Laps {
  turned: number;
  last: number | null;
}

/**
 * One frame of walking round the pond: add the angle the walker went round
 * its middle since the last frame, while they are near it. Away from the pond
 * nothing counts, and nothing is lost. Changes `s` in place: it runs every
 * frame, and a frame allocates nothing (DESIGN.md, Garden code).
 */
export function lapStep(s: Laps, x: number, z: number, pond: { x: number; z: number }) {
  const dx = x - pond.x;
  const dz = z - pond.z;
  if (Math.hypot(dx, dz) > POND_LAPS.ring) {
    s.last = null;
    return;
  }
  const a = Math.atan2(dz, dx);
  if (s.last !== null) {
    // The short way round: one frame never goes half round the pond.
    const d = a - s.last;
    s.turned += d - Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  }
  s.last = a;
}

/** Whole laps round the pond, either way round. Back and forth cancels out. */
export const lapsDone = (s: Laps): number => Math.floor(Math.abs(s.turned) / (Math.PI * 2));
