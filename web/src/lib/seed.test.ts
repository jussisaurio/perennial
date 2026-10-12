import { expect, test } from "bun:test";
import { fuzz } from "../core/fsrs";
import { hash01, hash32, rng } from "./seed";

test("hash32 is FNV-1a, and a salt gives another stream", () => {
  expect(hash32("")).toBe(0x811c9dc5);
  expect(hash32("a")).toBe(0xe40c292c);
  expect(hash32("casa", 7)).not.toBe(hash32("casa"));
  expect(hash01("casa")).toBe(hash32("casa") / 4294967296);
});

test("fsrs fuzz stays pinned: due dates replay the same on every device and release", () => {
  expect(fuzz(3, "casa:1")).toBeCloseTo(2.61822, 9);
  expect(fuzz(10, "perro:read:4")).toBeCloseTo(10.94314, 9);
  expect(fuzz(40, "w:listen:9")).toBeCloseTo(41.82664, 9);
});

test("rng is seeded and stays in [0, 1)", () => {
  const a = rng(42);
  const b = rng(42);
  const xs = Array.from({ length: 1000 }, () => a());
  expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
  expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
});
