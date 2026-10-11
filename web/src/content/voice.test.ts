import { expect, test } from "bun:test";
import { doneTodayNote, forgotLine, greetingAside, loadingLine, PLANT_LINES, startNote, summaryHeadline } from "./voice";

// docs/voice.md: short, simple, no "!" in English; the clear sentence comes first.
const days = Array.from({ length: 60 }, (_, d) => new Date(2026, 8, 1 + d, [8, 14, 20, 23][d % 4]));
const english = [
  ...Object.values(PLANT_LINES).flat(),
  ...days.flatMap((d) => [loadingLine(d), startNote(d), doneTodayNote(d), forgotLine(true, d), greetingAside(d) ?? ""]),
  ...days.map((d) => summaryHeadline("es", d)).flatMap((h) => (h.small ? [h.small] : [h.line])),
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
