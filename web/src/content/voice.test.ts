import { expect, test } from "bun:test";
import {
  doneTodayNote,
  EMPTY_WALK,
  firstPlantsLine,
  forgotLine,
  greetingAside,
  loadingLine,
  PLANT_LINES,
  reservedStake,
  restDayLine,
  SLOW_DEVICE_NOTICE,
  startNote,
  summaryHeadline,
  WORM_LINE,
  wordsEmptyLine,
  type WordsFilter,
} from "./voice";

const FILTERS: WordsFilter[] = ["all", "known", "learning", "new", "suspended", "mine"];

// docs/voice.md: short, simple, no "!" in English; the clear sentence comes first.
const days = Array.from({ length: 60 }, (_, d) => new Date(2026, 8, 1 + d, [8, 14, 20, 23][d % 4]));
const english = [
  ...Object.values(PLANT_LINES).flat(),
  ...days.flatMap((d) => [loadingLine(d), startNote(d), doneTodayNote(d), forgotLine(true, d), greetingAside(d) ?? ""]),
  ...days.map((d) => summaryHeadline("es", d)).flatMap((h) => (h.small ? [h.small] : [h.line])),
  ...Object.values(EMPTY_WALK),
  WORM_LINE,
  SLOW_DEVICE_NOTICE,
  restDayLine("Oct 3"),
  reservedStake("Spanish", "es").line,
  firstPlantsLine(1),
  firstPlantsLine(5),
  ...FILTERS.flatMap((f) => [wordsEmptyLine(f, false), wordsEmptyLine(f, true)]),
].filter(Boolean);

test("English lines: no exclamation marks, short sentences", () => {
  for (const line of english) {
    expect(line).not.toContain("!");
    for (const sentence of line.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(16);
  }
});

test("after 'I forgot', what happens next always comes first", () => {
  for (const d of days) expect(forgotLine(true, d).startsWith("You will see this word again soon.")).toBe(true);
});

test("lines rotate across days", () => {
  expect(new Set(days.map((d) => summaryHeadline("de", d).line)).size).toBeGreaterThan(4);
});

test("quiet copy: the clear part comes first, the wink after (#58, #68)", () => {
  expect(SLOW_DEVICE_NOTICE.startsWith("The garden was slow on this device, so it now uses bigger pixels.")).toBe(true);
  expect(restDayLine("Oct 3").startsWith("Oct 3: rest day.")).toBe(true);
  for (const f of FILTERS) expect(wordsEmptyLine(f, false)).toMatch(/^No /);
  expect(wordsEmptyLine("known", true)).toBe("No word here. Maybe it is still a seed.");
  expect(reservedStake("Spanish", "es")).toEqual({ line: "Reserved for Spanish words", local: "Reservado" });
  expect(reservedStake("German", "de").local).toBe("Reserviert");
  expect(reservedStake("French", "fr").local).toBeUndefined();
  expect(firstPlantsLine(1)).toBe("Your first plant.");
  expect(firstPlantsLine(5)).toBe("Your first 5 plants.");
});
