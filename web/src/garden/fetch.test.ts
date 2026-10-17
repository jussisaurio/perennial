import { describe, expect, test } from "bun:test";
import { fetchFruit, fetchSeed, pickFetch, SURPRISE, USUAL, type Fetchable, type Surprise } from "./fetch";
import type { Fruit } from "./leave";

const ALL = Object.keys(SURPRISE) as Surprise[];
/** A calendar day (core/day.ts dayNumber): 2026-06-01. */
const DAY = 20_605;

describe("what the dog brings back", () => {
  test("pinned seeds: what you threw for the first USUAL, then each surprise in turn, by its weight", () => {
    const total = USUAL + ALL.reduce((n, s) => n + SURPRISE[s], 0);
    expect(pickFetch(0, "stick", ALL, null)).toBe("stick");
    expect(pickFetch(USUAL - 1, "stick", ALL, null)).toBe("stick");
    expect(pickFetch(USUAL, "stick", ALL, null)).toBe(ALL[0]);
    expect(pickFetch(USUAL + SURPRISE[ALL[0]], "stick", ALL, null)).toBe(ALL[1]);
    expect(pickFetch(total - 1, "stick", ALL, null)).toBe(ALL[ALL.length - 1]);
    // The seed wraps round the table.
    expect(pickFetch(total, "stick", ALL, null)).toBe("stick");
  });

  test("seeded per throw: the same day and throw bring the same thing; throws differ", () => {
    const day = (n: number) => pickFetch(fetchSeed(DAY, n), "stick", ALL, null);
    expect(Array.from({ length: 20 }, (_, n) => day(n))).toEqual(Array.from({ length: 20 }, (_, n) => day(n)));
    expect(new Set(Array.from({ length: 20 }, (_, n) => day(n))).size).toBeGreaterThan(1);
  });

  test("usually what you threw; every surprise comes sometimes; the gnome only once in a long while", () => {
    const n = 5000;
    const count = new Map<Fetchable, number>();
    for (let i = 0; i < n; i++) {
      const got = pickFetch(fetchSeed(DAY + (i % 50), i), "stick", ALL, null);
      count.set(got, (count.get(got) ?? 0) + 1);
    }
    expect(count.get("stick")! / n).toBeGreaterThan(0.5);
    for (const s of ALL) expect(count.get(s)).toBeGreaterThan(0);
    expect(count.get("gnome")! / n).toBeLessThan(0.04);
  });

  test("only what can come now: nothing out in the garden already, nothing when nothing can", () => {
    for (let i = 0; i < 300; i++) {
      expect(["sock", "sign"]).toContain(pickFetch(USUAL + (i % 22), "sock", ["sign"], null));
      expect(pickFetch(fetchSeed(DAY, i), "hat", [], null)).toBe("hat");
    }
  });

  test("the same surprise never comes twice in a row", () => {
    let last: Surprise | null = null;
    let surprises = 0;
    for (let i = 0; i < 2000; i++) {
      const got = pickFetch(fetchSeed(DAY, i), "stick", ALL, last);
      if (got === "stick") continue;
      expect(got).not.toBe(last);
      last = got;
      surprises++;
    }
    expect(surprises).toBeGreaterThan(300);
  });
});

describe("the fruit it may find", () => {
  const fruit = (kind: Fruit["kind"], lemma: string): Fruit => ({ id: lemma, lemma, gloss: kind, kind });

  test("a lemon, when the learner knows one; another fruit they know, by the day; none without", () => {
    const apple = fruit("apple", "manzana");
    const lemon = fruit("lemon", "limón");
    expect(fetchFruit([apple, lemon], DAY)).toBe(lemon);
    expect(fetchFruit([apple], DAY)).toBe(apple);
    expect(fetchFruit([], DAY)).toBeNull();
    const pear = fruit("pear", "pera");
    const days = Array.from({ length: 30 }, (_, i) => fetchFruit([apple, pear], DAY + i)!.kind);
    expect(new Set(days)).toEqual(new Set(["apple", "pear"]));
  });
});
