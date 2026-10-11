// Small jokes in the walk-in garden: two signs whose text changes each day,
// and a sunflower that only looks at you when you stand in its sun.
// Pure functions, so they are easy to test.

import { daily, rareDay } from "../ui/whimsy";

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
  { text: "No running. (Shift is OK.)" },
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
export const LOCAL_LINES: Record<string, readonly string[]> = {
  es: ["Silencio, por favor", "Agua: sí", "Despacio, por favor", "Prohibido pisar la tierra"],
  de: ["Bitte leise", "Kein Eis", "Langsam gehen, bitte", "Erde nicht betreten"],
};

/** Today's text for the back-fence sign and the bench sign. Never the same line twice. */
export function pickSigns(lang: string, now = new Date()): { fence: SignLine; bench: SignLine } {
  const fencePool = [...SIGN_POOL, ...FENCE_LINES];
  const benchPool = [...SIGN_POOL, ...BENCH_LINES];
  const local = LOCAL_LINES[lang];
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
