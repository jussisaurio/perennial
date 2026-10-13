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

// Made-up words: a large, even sample that does not depend on what a deck holds.
const SAMPLE = Array.from({ length: 20_000 }, (_, i) => `palabra${i}`);

test("rare flowers: about 1 word in 40, the same for everyone, every kind on every flower (#208)", () => {
  for (const deck of [es, de]) {
    const lemmas = deck.words.map((w) => w.lemma);
    const share = lemmas.filter((l) => rareOf(l)).length / lemmas.length;
    expect(share).toBeGreaterThan(0.01);
    expect(share).toBeLessThan(0.04);
  }
  expect(rareOf("perro")).toBe(rareOf("Perro")); // from the word, not its capitalisation
  // Each kind gets its share: daisies and stars can be any of 4 kinds, other flowers any of 3.
  const kinds = (petalled: boolean) => {
    const n = new Map<string, number>();
    for (const w of SAMPLE) {
      const r = rareOf(w);
      if (r && ["daisy", "star"].includes(genome(w).flower) === petalled) n.set(r, (n.get(r) ?? 0) + 1);
    }
    return n;
  };
  const petalled = kinds(true);
  const total = [...petalled.values()].reduce((a, b) => a + b, 0);
  for (const k of ["golden", "twin", "bee", "striped"]) expect(petalled.get(k) ?? 0).toBeGreaterThan(total * 0.15);
  const others = kinds(false);
  expect(others.get("striped")).toBeUndefined();
  const rest = [...others.values()].reduce((a, b) => a + b, 0);
  for (const k of ["golden", "twin", "bee"]) expect(others.get(k) ?? 0).toBeGreaterThan(rest * 0.25);
});

test("rare flowers show only at bloom (#208)", () => {
  const draw = (word: string, stage: "bud" | "bloom") => renderToStaticMarkup(createElement(Plant, { word, growth: 0.6, stage }));
  const of = (kind: string, petalled = false) => SAMPLE.find((w) => rareOf(w) === kind && (!petalled || ["daisy", "star"].includes(genome(w).flower)))!;
  const bee = "hsl(46 92% 55%)";
  const gold = "hsl(45 92% 60%)";
  expect(draw(of("bee"), "bloom")).toContain(bee);
  expect(draw(of("bee"), "bud")).not.toContain(bee);
  expect(draw(of("golden"), "bloom")).toContain(gold);
  expect(draw(of("golden"), "bud")).not.toContain(gold);
  // Twin: one more head, so one more ring of petals than the plant's own flowers (main + branches).
  const petalCount = (word: string, stage: "bud" | "bloom") => draw(word, stage).split(`fill="${genome(word).petal}"`).length - 1;
  const twin = of("twin", true);
  expect(petalCount(twin, "bloom")).toBe(genome(twin).petals * (genome(twin).branches + 2));
  expect(petalCount(twin, "bud")).toBe(0);
  // Striped: a straight line up the middle of every petal ("M0 a L0 b"), on the main flower and each branch flower.
  const striped = of("striped");
  const stripes = (stage: "bud" | "bloom") => (draw(striped, stage).match(/d="M0 -?[\d.]+ L0 -?[\d.]+"/g) ?? []).length;
  expect(stripes("bloom")).toBe(genome(striped).petals * (genome(striped).branches + 1));
  expect(stripes("bud")).toBe(0);
});
