import { describe, expect, test } from "bun:test";
import { ANSWER_NOTE, FAR_HOUSE, lightAnswers, lookoutAt, LookoutLight } from "./lookout";
import { NOTES } from "./notes";
import { HILLS } from "./sceneSky";
import { HILL_ROWS, hillProfile } from "./textures";
import { layout } from "./world";

describe("the far light's answer (#683)", () => {
  test("it answers once note n12 is on the shed's nails, in every course", () => {
    for (const notes of Object.values(NOTES)) {
      const before = notes.filter((n) => n.id !== ANSWER_NOTE).map((n) => n.id);
      expect(lightAnswers(notes, before)).toBe(false);
      expect(lightAnswers(notes, [...before, ANSWER_NOTE])).toBe(true);
    }
  });

  test("a course without note n12 fails loudly", () => {
    expect(() => lightAnswers(NOTES.es.filter((n) => n.id !== ANSWER_NOTE), [])).toThrow();
  });

  test("at night, the first raise once it answers gets two blinks; later raises get none", () => {
    const light = new LookoutLight(true);
    expect(light.raise(10, false)).toBe("dusk");
    expect(light.raise(20, true)).toBe("blink");
    // Steady, then out, on, out, and on for good.
    const seen = [21, 22.1, 22.4, 22.8, 23.5, 100].map((t) => light.on(t));
    expect(seen).toEqual([true, false, true, false, true, true]);
    expect(light.raise(200, true)).toBe("steady");
    expect([202.1, 202.8].map((t) => light.on(t))).toEqual([true, true]);
  });

  test("before it answers, a raise at night leaves the light shining", () => {
    const light = new LookoutLight(false);
    expect(light.raise(5, true)).toBe("steady");
    expect([7.1, 7.8].map((t) => light.on(t))).toEqual([true, true]);
  });

  test("the lantern rises, holds, and comes back down", () => {
    const light = new LookoutLight(false);
    expect(light.lift(0)).toBe(0);
    light.raise(1, true);
    expect(light.lift(1.2)).toBeGreaterThan(0);
    expect(light.lift(2)).toBe(1);
    expect(light.lift(10)).toBe(0);
  });
});

describe("the far house (#683)", () => {
  test("it stands on the hills, not against the sky, and in view through the gap", () => {
    const { turn, r, y, h } = FAR_HOUSE;
    // The hills' texture column at this turn (repeated round the ring), and the hill top's height there.
    const col = Math.floor((((turn / (Math.PI * 2)) * HILLS.repeat) % 1) * 256);
    const top = HILLS.y + HILLS.height / 2 - (hillProfile()[col] / HILL_ROWS) * HILLS.height;
    expect(y + h).toBeLessThan(top - 0.5);
    expect(y).toBeGreaterThan(HILLS.y - HILLS.height / 2);
    // From the gap, a little right of straight ahead.
    const gap = lookoutAt(layout([]).orchard);
    const across = Math.atan2(Math.sin(turn) * r - gap.x, Math.cos(turn) * r - gap.z);
    expect(Math.abs(across)).toBeLessThan(0.3);
  });
});
