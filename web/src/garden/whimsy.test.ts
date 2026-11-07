import { describe, expect, test } from "bun:test";
import { DECK_LANGS } from "../deck/langs";
import { fishSign, lapsDone, lapStep, pickSigns, POND_LAPS, SIGNS, sundialAngle, sunflowerFaces, type Laps } from "./whimsy";

const days = Array.from({ length: 120 }, (_, d) => new Date(2026, 0, 1 + d, 12));

describe("garden signs", () => {
  test("every line is short, plain and calm, in every course", () => {
    for (const lang of DECK_LANGS) {
      const s = SIGNS[lang];
      expect(s.pool.length).toBeGreaterThanOrEqual(15);
      for (const { text } of [...s.pool, ...s.bench, ...s.fence, { text: s.noFish.text }]) {
        const words = text.split(" ").length;
        expect(words).toBeGreaterThanOrEqual(2);
        expect(words).toBeLessThanOrEqual(6);
        expect(text).not.toContain("!");
      }
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
      expect(SIGNS.de.bench).not.toContainEqual(s.fence);
      expect(SIGNS.de.fence).not.toContainEqual(s.bench);
    }
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

describe("the deadpan scenery (#364)", () => {
  test("the sundial's shadow: noon straight up, 15° an hour, west in the morning and east after noon", () => {
    expect(sundialAngle(new Date(2026, 5, 1, 12, 0))).toBe(0);
    expect(sundialAngle(new Date(2026, 5, 1, 15, 0))).toBeCloseTo(Math.PI / 4);
    expect(sundialAngle(new Date(2026, 5, 1, 6, 0))).toBeCloseTo(-Math.PI / 2);
    expect(sundialAngle(new Date(2026, 5, 1, 9, 30))).toBeCloseTo((-2.5 * Math.PI) / 12);
  });

  const pond = { x: 2, z: -1 };
  /** Walk `turns` times round the pond (negative: the other way) at `r` m from its middle, in steps of `step` radians, from angle `from`. */
  const walkRound = (s: Laps, turns: number, r = 2, step = 0.2, from = 0) => {
    const total = Math.abs(turns) * Math.PI * 2;
    for (let i = 0; i <= Math.ceil(total / step); i++) {
      const a = from + Math.sign(turns) * Math.min(i * step, total);
      lapStep(s, pond.x + Math.cos(a) * r, pond.z + Math.sin(a) * r, pond);
    }
  };

  test("laps round the pond: whole turns, either way round", () => {
    const s: Laps = { turned: 0, last: null };
    walkRound(s, 2.9);
    expect(lapsDone(s)).toBe(2);
    walkRound(s, 0.15, 2, 0.2, 2.9 * Math.PI * 2);
    expect(lapsDone(s)).toBe(POND_LAPS.jump);
    const back: Laps = { turned: 0, last: null };
    walkRound(back, -3.05);
    expect(lapsDone(back)).toBe(3);
  });

  test("back and forth on one side of the pond is no lap", () => {
    const s: Laps = { turned: 0, last: null };
    for (let i = 0; i < 20; i++) {
      walkRound(s, 0.4);
      walkRound(s, -0.4, 2, 0.2, 0.4 * Math.PI * 2);
    }
    expect(lapsDone(s)).toBe(0);
  });

  test("away from the pond nothing counts and nothing is lost; coming back on another side adds no jump", () => {
    const s: Laps = { turned: 0, last: null };
    walkRound(s, 1.5);
    // Off across the garden, and back to the pond a quarter turn on.
    lapStep(s, pond.x + 20, pond.z, pond);
    expect(s.last).toBeNull();
    walkRound(s, 1.4, 3, 0.2, Math.PI * 1.5);
    expect(lapsDone(s)).toBe(2);
    walkRound(s, 0.2, 3, 0.2, Math.PI * 1.5 + 1.4 * Math.PI * 2);
    expect(lapsDone(s)).toBe(3);
    // Walking round far out, beyond the ring, counts for nothing.
    const far: Laps = { turned: 0, last: null };
    walkRound(far, 4, POND_LAPS.ring + 1);
    expect(lapsDone(far)).toBe(0);
  });

  test("the fish sign is put right only when the fish is in the pond, and only that sign", () => {
    const noFish = { text: "Prohibido pescar. No hay peces." };
    expect(fishSign(noFish, false, "es")).toEqual(noFish);
    expect(fishSign(noFish, true, "es")).toEqual({ text: "Prohibido pescar. No hay peces.", fix: { strike: "No hay peces.", write: "Hay uno." } });
    const other = SIGNS.es.pool[0];
    expect(fishSign(other, true, "es")).toEqual(other);
    // The other course's sign is put right in its own words.
    expect(fishSign({ text: SIGNS.de.noFish.text }, true, "de").fix).toEqual({ strike: "Keine Fische.", write: "Ein Fisch." });
  });
});
