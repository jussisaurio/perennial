import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import es from "../../../decks/es/deck.json";
import de from "../../../decks/de/deck.json";
import { genome, Plant, PlantForm, rareOf } from "./plant";

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

test("rare flowers: about 1 word in 40, the same for everyone, and each kind shows only at bloom (#208)", () => {
  for (const deck of [es, de]) {
    const lemmas = deck.words.map((w) => w.lemma);
    const share = lemmas.filter((l) => rareOf(l)).length / lemmas.length;
    expect(share).toBeGreaterThan(0.01);
    expect(share).toBeLessThan(0.04);
  }
  expect(rareOf("perro")).toBe(rareOf("Perro")); // from the word, not its capitalisation
  const draw = (word: string, stage: "bud" | "bloom") => renderToStaticMarkup(createElement(Plant, { word, growth: 0.6, stage }));
  // One word of each kind, from the Spanish deck.
  const of = (kind: string) => es.words.map((w) => w.lemma).find((l) => rareOf(l) === kind)!;
  const bee = "hsl(46 92% 55%)";
  const gold = "hsl(45 92% 60%)";
  expect(draw(of("bee"), "bloom")).toContain(bee);
  expect(draw(of("bee"), "bud")).not.toContain(bee);
  expect(draw(of("golden"), "bloom")).toContain(gold);
  expect(draw(of("golden"), "bud")).not.toContain(gold);
  // Twin: one more head, so one more ring of petals than the plant's own flowers (main + branches).
  const petalCount = (word: string, stage: "bud" | "bloom") => draw(word, stage).split(`fill="${genome(word).petal}"`).length - 1;
  const twin = es.words.map((w) => w.lemma).find((l) => rareOf(l) === "twin" && ["daisy", "star"].includes(genome(l).flower))!;
  const g = genome(twin);
  expect(petalCount(twin, "bloom")).toBe(g.petals * (g.branches + 2));
  expect(petalCount(twin, "bud")).toBe(0);
  // Striped: a stripe on every petal of the bloom, none on the bud.
  const striped = of("striped");
  // A stripe is a straight line up the middle of a petal: "M0 a L0 b".
  const stripes = (stage: "bud" | "bloom") => (draw(striped, stage).match(/d="M0 -?[\d.]+ L0 -?[\d.]+"/g) ?? []).length;
  expect(stripes("bloom")).toBeGreaterThanOrEqual(genome(striped).petals);
  expect(stripes("bud")).toBe(0);
});
