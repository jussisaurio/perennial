import { expect, test } from "bun:test";
import { didLine, EMPTY_WALK, firstPlantsLine, reservedStake, wordsEmptyLine, type WordsFilter } from "./voice";

const FILTERS: WordsFilter[] = ["all", "known", "learning", "new", "suspended", "mine"];

// docs/voice.md: short, simple, no "!" in English.
const english = [
  ...Object.values(EMPTY_WALK),
  reservedStake("Spanish", "es").line,
  firstPlantsLine(1),
  firstPlantsLine(5),
  ...FILTERS.flatMap((f) => [wordsEmptyLine(f, false), wordsEmptyLine(f, true)]),
];

test("English lines: no exclamation marks, short sentences", () => {
  for (const line of english) {
    expect(line).not.toContain("!");
    for (const sentence of line.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(16);
  }
});

test("plain copy says what is there (#58, #262)", () => {
  for (const f of FILTERS) expect(wordsEmptyLine(f, false)).toMatch(/^No /);
  expect(wordsEmptyLine("new", true)).toBe("No new word like this. Try All.");
  expect(reservedStake("Spanish", "es")).toEqual({ line: "Reserved for Spanish words", local: "Reservado" });
  expect(reservedStake("German", "de").local).toBe("Reserviert");
  expect(reservedStake("French", "fr").local).toBeUndefined();
  expect(firstPlantsLine(1)).toBe("Your first plant.");
  expect(firstPlantsLine(5)).toBe("Your first 5 plants.");
  expect(didLine(3, 21)).toBe("You planted 3 seeds and watered 21 plants.");
  expect(didLine(1, 0)).toBe("You planted 1 seed.");
  expect(didLine(0, 1)).toBe("You watered 1 plant.");
});
