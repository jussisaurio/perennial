import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import es from "../../../decks/es/deck.json";
import de from "../../../decks/de/deck.json";
import { MEANING_WORDS, meaningOf } from "./meaning";
import { genome, Plant, plantTop, stemHeight } from "./plant";

const draw = (word: string, stage: "bud" | "bloom") => renderToStaticMarkup(createElement(Plant, { word, growth: 0.6, stage }));

test("every word with a meaning is a real deck word, so none of them silently does nothing (#214)", () => {
  const lemmas = new Set([...es.words, ...de.words].map((w) => w.lemma.normalize("NFC").toLowerCase()));
  for (const w of MEANING_WORDS) expect(lemmas.has(w)).toBe(true);
  expect(meaningOf("Azul")).toEqual(meaningOf("azul"));
});

test("colour words bloom in their colour, and only once they bloom", () => {
  const blue = "hsl(214 72% 60%)";
  expect(draw("azul", "bloom")).toContain(blue);
  expect(draw("azul", "bud")).not.toContain(blue);
  expect(draw("casa", "bloom")).not.toContain(blue);
});

test("frío has frost on its leaves, agua has drops", () => {
  const frost = (w: string) => (draw(w, "bloom").match(/fill="#fff"/g) ?? []).length;
  expect(frost("frío")).toBeGreaterThan(0);
  expect(frost("casa")).toBe(0);
  expect(draw("agua", "bloom")).toContain("hsl(208 70% 62%)");
  expect(draw("casa", "bloom")).not.toContain("hsl(208 70% 62%)");
});

test("sleepy words sleep: every head stays closed, in its own colours", () => {
  // cansado (daisy) and sueño (star) would open into rings of petals if awake.
  for (const word of ["dormir", "schlafen", "cansado", "müde", "sueño"]) {
    const g = genome(word);
    const markup = draw(word, "bloom");
    // One closed shape in petal colour per head (the main one and each side flower).
    expect(markup.split(`fill="${g.petal}"`).length - 1).toBe(1 + g.branches);
    expect(markup).not.toContain(g.bud); // petal colour, not bud green
  }
});

test("loco scrambles its petals: they are not all the same length", () => {
  const petals = draw("loco", "bloom").match(/rotate\((-?[\d.]+)\)"><path d="M0 0 C [^"]+"/g) ?? [];
  expect(petals.length).toBeGreaterThan(5);
  expect(new Set(petals.map((p) => p.split("C")[1])).size).toBeGreaterThan(3);
});

test("grande is slightly too big, pequeño is small, and caer has a petal on the ground", () => {
  const height = (w: string) => -plantTop(w, 0.5).y;
  expect(height("grande")).toBeCloseTo(stemHeight(0.5) * genome("grande").height * 1.15, 5);
  expect(height("pequeño")).toBeCloseTo(stemHeight(0.5) * genome("pequeño").height * 0.72, 5);
  expect(height("casa")).toBeCloseTo(stemHeight(0.5) * genome("casa").height, 5);
  expect(draw("caer", "bloom")).toContain("rotate(78)");
  expect(draw("caer", "bud")).not.toContain("rotate(78)");
});
