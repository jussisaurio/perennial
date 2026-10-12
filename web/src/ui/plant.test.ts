import { expect, test } from "bun:test";
import { genome } from "./plant";

test("a word always grows the same plant; different words grow different ones", () => {
  expect(genome("casa")).toEqual(genome("casa"));
  expect(genome("Casa")).toEqual(genome("casa")); // seeded by the word, not its capitalisation
  const words = ["casa", "perro", "mañana", "Blume", "Haus", "gracias", "schön", "agua", "Zeit", "libro"];
  const looks = new Set(words.map((w) => { const g = genome(w); return `${g.flower}|${g.petal}|${g.leafShape}`; }));
  expect(looks.size).toBe(words.length);
});
