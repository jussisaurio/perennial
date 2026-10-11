import { describe, expect, test } from "bun:test";
import { daily, rareDay } from "./whimsy";

const pool = ["a", "b", "c", "d", "e"];

describe("daily", () => {
  test("stable within a day, changes across days", () => {
    const morning = new Date(2026, 9, 11, 8);
    const night = new Date(2026, 9, 11, 23);
    expect(daily(pool, "k", morning)).toBe(daily(pool, "k", night));
    const week = Array.from({ length: 14 }, (_, d) => daily(pool, "k", new Date(2026, 9, 1 + d)));
    expect(new Set(week).size).toBeGreaterThan(2);
  });
  test("different keys rotate independently", () => {
    const days = Array.from({ length: 10 }, (_, d) => new Date(2026, 9, 1 + d));
    expect(days.map((d) => daily(pool, "a", d))).not.toEqual(days.map((d) => daily(pool, "b", d)));
  });
});

test("rareDay is rare", () => {
  const year = Array.from({ length: 365 }, (_, d) => rareDay(30, "visitor", new Date(2026, 0, 1 + d))).filter(Boolean).length;
  expect(year).toBeGreaterThan(3);
  expect(year).toBeLessThan(30);
});
