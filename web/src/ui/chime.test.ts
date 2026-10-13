import { expect, test } from "bun:test";
import { noteFor } from "./chime";

test("every word has its own note on the five-note scale, the same everywhere (#215)", () => {
  const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21].map((s) => 440 * 2 ** (s / 12));
  const words = ["casa", "perro", "mañana", "Haus", "gato", "vez", "agua", "Zeit"];
  for (const w of words) expect(scale).toContain(noteFor(w));
  expect(noteFor("Casa")).toBe(noteFor("casa"));
  expect(new Set(words.map(noteFor)).size).toBeGreaterThan(3); // a tune, not one note
});
