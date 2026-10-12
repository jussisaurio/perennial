import { describe, expect, test } from "bun:test";
import { daily, dayNumber, rareDay, startOfDay, today } from "./day";

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

test("today keeps its unpadded format: it seeds daily pools", () => {
  expect(today(new Date(2026, 0, 5, 13))).toBe("2026-1-5");
  expect(today(new Date(2026, 9, 11))).toBe("2026-10-11");
});

test("startOfDay is local midnight", () => {
  const t = new Date(2026, 2, 29, 15, 30).getTime();
  expect(startOfDay(t)).toBe(new Date(2026, 2, 29).getTime());
  expect(startOfDay(new Date(t))).toBe(new Date(t).setHours(0, 0, 0, 0));
});

test("dayNumber counts calendar days across a clock change", () => {
  const at = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h).getTime();
  expect(dayNumber(at(2026, 2, 30, 1)) - dayNumber(at(2026, 2, 28, 23))).toBe(2);
});
