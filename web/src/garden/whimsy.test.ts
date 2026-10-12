import { describe, expect, test } from "bun:test";
import { BENCH_LINES, FENCE_LINES, LOCAL_LINES, pickSigns, SIGN_POOL, sunflowerFaces } from "./whimsy";

const days = Array.from({ length: 120 }, (_, d) => new Date(2026, 0, 1 + d, 12));

describe("garden signs", () => {
  test("every line is short, plain and calm", () => {
    expect(SIGN_POOL.length).toBeGreaterThanOrEqual(15);
    for (const { text } of [...SIGN_POOL, ...BENCH_LINES, ...FENCE_LINES]) {
      const words = text.split(" ").length;
      expect(words).toBeGreaterThanOrEqual(2);
      expect(words).toBeLessThanOrEqual(6);
      expect(text).not.toContain("!");
    }
  });

  test("the two signs never say the same thing, and the text is stable all day", () => {
    for (const d of days) {
      const s = pickSigns("es", d);
      expect(s.fence.text).not.toBe(s.bench.text);
      expect(pickSigns("es", new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23))).toEqual(s);
    }
  });

  test("bench lines stay by the bench, fence lines on the fence", () => {
    for (const d of days) {
      const s = pickSigns("de", d);
      expect(BENCH_LINES).not.toContainEqual(s.fence);
      expect(FENCE_LINES).not.toContainEqual(s.bench);
    }
  });

  test("about one day in four, a sign is in the course language", () => {
    const local = days.map((d) => pickSigns("es", d).fence).filter((l) => l.lang === "es");
    expect(local.length).toBeGreaterThan(days.length / 8);
    expect(local.length).toBeLessThan(days.length / 2);
    for (const l of local) expect(LOCAL_LINES.es).toContain(l.text);
    // A course with no local lines only gets English ones.
    expect(days.every((d) => !pickSigns("fr", d).fence.lang)).toBe(true);
  });

  test("the pool rotates: a month shows many different lines", () => {
    const month = days.slice(0, 30).map((d) => pickSigns("de", d).bench.text);
    expect(new Set(month).size).toBeGreaterThan(10);
  });
});

describe("the sunflower", () => {
  // Sun in the south-west (-x, -z), flower at the origin.
  const sun = [-0.5, -0.7] as const;
  test("shows its face only to someone between it and the sun", () => {
    expect(sunflowerFaces(0, 0, -2, -3, ...sun, false)).toBe(true);
    expect(sunflowerFaces(0, 0, 2, 3, ...sun, false)).toBe(false); // behind it
    expect(sunflowerFaces(0, 0, 3, -1, ...sun, false)).toBe(false); // off to the side
  });
  test("sleeps with its back to everyone at night", () => {
    expect(sunflowerFaces(0, 0, -2, -3, ...sun, true)).toBe(false);
  });
  test("standing on it shows the back", () => {
    expect(sunflowerFaces(1, 1, 1, 1, ...sun, false)).toBe(false);
  });
});
