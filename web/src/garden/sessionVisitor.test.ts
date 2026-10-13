import { expect, test } from "bun:test";
import { sessionVisit, WATCH_CARDS } from "./sessionVisitor";

test("a visitor watches about one chunk in two, one the learner has, for a few cards after the first two (#210)", () => {
  const brought = ["cat", "bird"] as const;
  let visits = 0;
  const who = new Set<string>();
  for (let d = 1; d <= 28; d++)
    for (let chunk = 0; chunk < 10; chunk++) {
      const v = sessionVisit(`2026-10-${String(d).padStart(2, "0")}`, chunk * 12, brought);
      if (!v) continue;
      visits++;
      who.add(v.id);
      expect(brought).toContain(v.id);
      expect(v.from).toBeGreaterThanOrEqual(3);
      expect(v.from).toBeLessThanOrEqual(7);
      expect(v.to - v.from).toBe(WATCH_CARDS);
    }
  expect(visits / 280).toBeGreaterThan(0.4);
  expect(visits / 280).toBeLessThan(0.6);
  expect(who.size).toBe(2); // both take turns
  // The same day and chunk: the same visit.
  expect(sessionVisit("2026-10-13", 7, brought)).toEqual(sessionVisit("2026-10-13", 7, brought));
  // None brought: nobody comes.
  for (let c = 0; c < 20; c++) expect(sessionVisit("2026-10-13", c, [])).toBeNull();
});
