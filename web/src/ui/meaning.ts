// Plants that act out their word (#214): for a few dozen words, the plant
// hints at what it means. "azul" grows blue, "dormir" sleeps with its head
// down, "frío" has frost on its leaves. Found in the garden, never shown in
// sessions; and a picture tied to a word helps it stick.

export type Meaning =
  | { kind: "colour"; petal: string; petalEdge: string; center: string }
  | { kind: "sleep" | "dance" | "cold" | "water" | "fire" | "big" | "small" | "crazy" | "fall" | "happy" };

const colour = (petal: string, petalEdge: string, center: string): Meaning => ({ kind: "colour", petal, petalEdge, center });

const BLUE = colour("hsl(214 72% 60%)", "hsl(214 70% 44%)", "hsl(45 90% 60%)");
const RED = colour("hsl(2 76% 56%)", "hsl(2 72% 40%)", "hsl(40 80% 45%)");
const WHITE = colour("hsl(40 30% 96%)", "hsl(40 15% 72%)", "hsl(45 90% 55%)");
const BLACK = colour("hsl(270 18% 20%)", "hsl(270 20% 10%)", "hsl(45 85% 55%)");
const GREEN = colour("hsl(110 45% 55%)", "hsl(110 45% 36%)", "hsl(60 70% 60%)");
const GOLD = colour("hsl(45 92% 60%)", "hsl(36 80% 42%)", "hsl(28 65% 32%)");

/** By lemma, lower case, for both courses. Only words that are in a deck. */
const MEANINGS: ReadonlyMap<string, Meaning> = new Map<string, Meaning>([
  ["azul", BLUE],
  ["rojo", RED],
  ["blanco", WHITE],
  ["weiß", WHITE],
  ["negro", BLACK],
  ["schwarz", BLACK],
  ["verde", GREEN],
  ["oro", GOLD],
  ["gold", GOLD],
  ...["dormir", "schlafen", "cansado", "müde", "sueño"].map((w) => [w, { kind: "sleep" }] as const),
  ...["bailar", "tanzen"].map((w) => [w, { kind: "dance" }] as const),
  ...["frío", "kalt"].map((w) => [w, { kind: "cold" }] as const),
  ...["agua", "wasser"].map((w) => [w, { kind: "water" }] as const),
  ...["fuego", "feuer", "caliente", "heiß"].map((w) => [w, { kind: "fire" }] as const),
  ...["grande", "groß"].map((w) => [w, { kind: "big" }] as const),
  ...["pequeño", "klein"].map((w) => [w, { kind: "small" }] as const),
  ...["loco", "verrückt"].map((w) => [w, { kind: "crazy" }] as const),
  ...["caer", "fallen"].map((w) => [w, { kind: "fall" }] as const),
  ...["feliz", "glücklich"].map((w) => [w, { kind: "happy" }] as const),
]);

/** Every word with a meaning, for the test that each is a real deck word. */
export const MEANING_WORDS: readonly string[] = [...MEANINGS.keys()];

export function meaningOf(word: string): Meaning | null {
  return MEANINGS.get(word.normalize("NFC").toLowerCase()) ?? null;
}

/** Height of a big or small word's plant, against its usual height. Big is "just slightly too big". */
export function sizeOf(m: Meaning | null): number {
  return m?.kind === "big" ? 1.15 : m?.kind === "small" ? 0.72 : 1;
}

export const FIRE = { petal: "hsl(16 88% 56%)", petalEdge: "hsl(4 80% 40%)", center: "hsl(48 96% 58%)" };
