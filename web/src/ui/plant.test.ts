import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { genome, Plant, PlantForm } from "./plant";

test("a word always grows the same plant; different words grow different ones", () => {
  expect(genome("casa")).toEqual(genome("casa"));
  expect(genome("Casa")).toEqual(genome("casa")); // seeded by the word, not its capitalisation
  const words = ["casa", "perro", "mañana", "Blume", "Haus", "gracias", "schön", "agua", "Zeit", "libro"];
  const looks = new Set(words.map((w) => { const g = genome(w); return `${g.flower}|${g.petal}|${g.leafShape}`; }));
  expect(looks.size).toBe(words.length);
});

test("a bud stays green: a word's flower colour shows only when it blooms (#207)", () => {
  for (const word of ["casa", "perro", "mañana", "Haus"]) {
    const { petal } = genome(word);
    const draw = (stage: "sprout" | "bud" | "bloom") => renderToStaticMarkup(createElement(Plant, { word, growth: 0.5, stage }));
    expect(draw("sprout")).not.toContain(petal);
    expect(draw("bud")).not.toContain(petal);
    expect(draw("bud")).not.toContain(genome(word).petalEdge);
    expect(draw("bud")).toContain(genome(word).bud);
    // On the way from sprout to bud, nothing of the flower shows either.
    expect(renderToStaticMarkup(createElement(PlantForm, { word, growth: 0.5, form: 1.9 }))).not.toContain(petal);
    expect(draw("bloom")).toContain(petal);
  }
});

test("the bud colour changed nothing else about a word's plant", () => {
  // genome("casa") as it was before #207 added the bud colour: the same word must still grow the same plant.
  const { bud: _bud, budEdge: _edge, ...rest } = genome("casa");
  expect(rest).toEqual({ flower: "bell", petals: 8, petalShape: "long", petal: "hsl(328 62% 68%)", petalEdge: "hsl(328 62% 54%)", center: "hsl(60 30% 92%)", leafShape: "lance", leaves: 2, opposite: false, leaf: "hsl(126 32% 55%)", stem: "hsl(120 35% 40%)", curve: 0.14680757652968168, height: 1.0114070583321153, branches: 0, lean: -13.545660031959414 });
});
