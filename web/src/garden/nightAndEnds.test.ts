import { describe, expect, test } from "bun:test";
import { rng } from "../lib/seed";
import { isSleepyHour, keepsakeLabel, NEIGHBOUR, NEIGHBOUR_PERK, nearestPlant, neighbourPerks, PERK, perkEnvelope, sleeperId, snoreLine } from "./whimsy";
import { MOLE_ONE_IN, moleVisits, stripVisitor, visitorsFor, NO_FACTS } from "./visitors";

const days = Array.from({ length: 400 }, (_, d) => new Date(2026, 0, 1 + d, 12));

describe("a plant that sleeps at night (#62)", () => {
  test("only late at night", () => {
    expect([21, 22, 23, 0, 4, 5, 12].map((h) => isSleepyHour(new Date(2026, 9, 11, h)))).toEqual([false, true, true, true, true, false, false]);
  });

  test("one bloom, the same all day, whatever the order; a different one on other days", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `w${i}`);
    const night = new Date(2026, 9, 11, 23);
    const s = sleeperId(ids, night);
    expect(ids).toContain(s!);
    expect(sleeperId([...ids].reverse(), new Date(2026, 9, 11, 2))).toBe(s);
    expect(new Set(days.slice(0, 30).map((d) => sleeperId(ids, d))).size).toBeGreaterThan(10);
    expect(sleeperId([], night)).toBeNull();
  });

  test("the card teaches the verb, after the snore", () => {
    expect(snoreLine("es")).toBe("Zzz... (dormir = to sleep)");
    expect(snoreLine("de")).toBe("Zzz... (schlafen = to sleep)");
    expect(snoreLine("fr")).toBe("Zzz...");
  });
});

describe("the plant hears its name (#60)", () => {
  test("a perk grows and settles in under half a second", () => {
    expect(PERK.rise + PERK.fall).toBeLessThan(0.5);
    expect(perkEnvelope(0, PERK.rise, PERK.fall)).toBe(0);
    expect(perkEnvelope(PERK.rise, PERK.rise, PERK.fall)).toBeCloseTo(1);
    expect(perkEnvelope(PERK.rise + PERK.fall, PERK.rise, PERK.fall)).toBe(0);
    for (let t = -1; t < 2; t += 0.01) {
      const v = perkEnvelope(t, PERK.rise, PERK.fall);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test("the neighbour settles back slowly", () => {
    expect(NEIGHBOUR.fall).toBeGreaterThan(PERK.fall * 3);
  });

  test("the neighbour's mistake is rare: about one listen in 30", () => {
    expect(NEIGHBOUR_PERK).toBeGreaterThanOrEqual(25);
    const rand = rng(7);
    const hits = Array.from({ length: 30_000 }, () => neighbourPerks(rand)).filter(Boolean).length;
    expect(hits).toBeGreaterThan(700);
    expect(hits).toBeLessThan(1300);
  });

  test("the neighbour is the nearest other plant", () => {
    const ps = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 0.5, z: 0.2 },
    ];
    expect(nearestPlant(ps, 0)).toBe(2);
    expect(nearestPlant(ps, 1)).toBe(2);
    expect(nearestPlant([{ x: 0, z: 0 }], 0)).toBe(-1);
  });
});

describe("the ends of the strip (#61) and the empty garden (#58)", () => {
  test("the keepsake: the first word and the day", () => {
    expect(keepsakeLabel("casa", new Date(2026, 9, 3, 18).getTime())).toBe("casa · 3 Oct");
  });

  test("the mole comes on about one day in four, all day; the dev override brings it", () => {
    const hits = days.filter((d) => moleVisits(d)).length;
    expect(hits).toBeGreaterThan(days.length / MOLE_ONE_IN / 1.6);
    expect(hits).toBeLessThan(days.length / MOLE_ONE_IN * 1.6);
    for (const d of days.slice(0, 50)) expect(moleVisits(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 1))).toBe(moleVisits(d));
    expect(moleVisits(days[0], "all")).toBe(true);
    expect(moleVisits(days[0], ["mole"])).toBe(true);
    expect(moleVisits(days[0], ["cat"])).toBe(false);
  });

  test("strip-only visitors are words with their article, and never walk visitors", () => {
    expect(stripVisitor("worm", "es")).toEqual({ id: "worm", word: "el gusano", gloss: "worm" });
    expect(stripVisitor("worm", "de")?.word).toBe("der Wurm");
    expect(stripVisitor("mole", "es")?.word).toBe("el topo");
    expect(stripVisitor("mole", "de")?.word).toBe("der Maulwurf");
    expect(stripVisitor("mole", "fr")).toBeNull();
    // The walk never gets them, even with every visitor on.
    expect(visitorsFor(NO_FACTS, days[0], "all").present).not.toContain("mole");
    expect(visitorsFor(NO_FACTS, days[0], ["mole", "worm"]).present).toEqual([]);
  });
});
