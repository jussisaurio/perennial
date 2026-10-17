import { describe, expect, test } from "bun:test";
import { FULL_MOON, moonPhase } from "./moon";

describe("tonight's moon", () => {
  test("matches the real sky on known nights", () => {
    // Full moons: 15 December 2024 and 26 October 2026; new moons: 30 December 2024 and 10 October 2026.
    expect(moonPhase(Date.UTC(2024, 11, 15, 9))).toBe(FULL_MOON);
    expect(moonPhase(Date.UTC(2026, 9, 26, 4))).toBe(FULL_MOON);
    expect(moonPhase(Date.UTC(2024, 11, 30, 22))).toBe(0);
    expect(moonPhase(Date.UTC(2026, 9, 10, 16))).toBe(0);
    // First quarter, 18 October 2026: half lit, waxing.
    expect(moonPhase(Date.UTC(2026, 9, 18, 16))).toBe(2);
  });

  test("goes through every phase in order, once a month", () => {
    const seen: number[] = [];
    for (let d = 0; d < 30; d++) {
      const p = moonPhase(Date.UTC(2026, 9, 10, 16) + d * 86_400_000);
      if (seen[seen.length - 1] !== p) seen.push(p);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0]);
  });

  test("works before the reference new moon too", () => {
    // Full moon, 21 January 1989 (02:33 UTC).
    expect(moonPhase(Date.UTC(1989, 0, 21, 3))).toBe(FULL_MOON);
  });
});
