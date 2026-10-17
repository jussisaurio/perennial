import { describe, expect, test } from "bun:test";
import { COMPANY, due, glance, GLANCE, LAPSE, lapseLook, lapseRate, settle, sunPath, SUN_AT, type Companion, type Look } from "./bench";

/** Sit for `seconds`, frame by frame (60 a second), as the scene does: how far time has run on, in parts of the day. */
function sitFor(seconds: number): number {
  let lapse = 0;
  for (let t = 0; t < seconds; t += 1 / 60) lapse += lapseRate(t) * (1 / 60);
  return lapse;
}

const look = (): Look => ({ from: "day", to: "day", k: 0 });

describe("the time-lapse on the bench (#362)", () => {
  test("time runs as usual for the first seconds, then speeds up gently to one part of the day per LAPSE.part seconds", () => {
    expect(lapseRate(0)).toBe(0);
    expect(lapseRate(LAPSE.still - 0.1)).toBe(0);
    expect(lapseRate(LAPSE.still + LAPSE.ramp / 2)).toBeCloseTo(0.5 / LAPSE.part);
    expect(lapseRate(LAPSE.still + LAPSE.ramp)).toBeCloseTo(1 / LAPSE.part);
    expect(lapseRate(600)).toBeCloseTo(1 / LAPSE.part);
  });

  test("sitting from midday: dusk, then night, then day again, each lingering before the next", () => {
    const at = (s: number) => lapseLook("day", sitFor(s), look());
    expect(at(5)).toEqual({ from: "day", to: "dusk", k: 0 });
    // Half way to dusk about LAPSE.part / 2 s after full speed.
    const mid = at(LAPSE.still + LAPSE.ramp / 2 + LAPSE.part / 2);
    expect(mid.from).toBe("day");
    expect(mid.k).toBeCloseTo(0.5, 1);
    const dusk = at(LAPSE.still + LAPSE.ramp / 2 + LAPSE.part);
    expect([dusk.from, dusk.to]).toEqual(["dusk", "night"]);
    expect(dusk.k).toBeLessThan(0.01);
    const night = at(LAPSE.still + LAPSE.ramp / 2 + LAPSE.part * 2.5);
    expect([night.from, night.to]).toEqual(["night", "day"]);
    expect(at(LAPSE.still + LAPSE.ramp / 2 + LAPSE.part * 3.2).from).toBe("day");
    // From night the next part of the day is morning.
    expect(lapseLook("night", 0.5, look())).toEqual({ from: "night", to: "day", k: 0.5 });
  });

  test("standing up runs time back to the real time of day: back from part of a day, on from most of one", () => {
    const stand = (lapse: number) => {
      let frames = 0;
      while (lapse !== 0 && frames < 1000) {
        const next = settle(lapse, 1 / 60);
        // A small step each frame, the short way round (0 and 3 are the same time of day).
        if (next !== 0) {
          expect(Math.abs(next - lapse)).toBeCloseTo(LAPSE.back / 60);
          expect(Math.sign(next - lapse)).toBe(lapse % 3 < 1.5 ? -1 : 1);
        }
        lapse = next;
        frames++;
      }
      return frames / 60;
    };
    expect(stand(0)).toBe(0);
    // A little dusk: about a second back to the real day.
    expect(stand(1.2)).toBeCloseTo(1.2 / LAPSE.back, 1);
    // Nearly a whole day: it runs on to the same time of day, not back through it all.
    expect(stand(2.7)).toBeCloseTo(0.3 / LAPSE.back, 1);
    expect(stand(4)).toBeCloseTo(1 / LAPSE.back, 1);
  });

  test("the sun moves from day to dusk; at nightfall it sets and the moon rises in the east", () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(sunPath({ from: "day", to: "dusk", k: 0 }, out)).toEqual([...SUN_AT.day]);
    expect(sunPath({ from: "day", to: "dusk", k: 1 }, out)).toEqual([...SUN_AT.dusk]);
    // Half way between dusk and night, neither is up.
    expect(sunPath({ from: "dusk", to: "night", k: 0.5 }, out)[1]).toBeLessThan(0);
    // The sun goes down where it is (in the west)...
    const setting = sunPath({ from: "dusk", to: "night", k: 0.25 }, out);
    expect(setting[0]).toBe(SUN_AT.dusk[0]);
    expect(setting[1]).toBeLessThan(SUN_AT.dusk[1]);
    // ...and the moon comes up in the east, to its place.
    expect(sunPath({ from: "dusk", to: "night", k: 0.75 }, out)[0]).toBe(SUN_AT.night[0]);
    expect(sunPath({ from: "dusk", to: "night", k: 1 }, out)).toEqual([...SUN_AT.night]);
  });
});

describe("company on the bench (#362)", () => {
  const all = () => true;
  const none = new Set<Companion>();

  test("the bird comes first, then the cat, and after a long pause the gnome", () => {
    expect(due(9.9, all, none)).toBeNull();
    expect(due(10, all, none)).toBe("bird");
    expect(due(25, all, new Set<Companion>(["bird"]))).toBe("cat");
    expect(due(39, all, new Set<Companion>(["bird", "cat"]))).toBeNull();
    expect(due(40, all, new Set<Companion>(["bird", "cat"]))).toBe("gnome");
    expect(due(600, all, new Set<Companion>(["bird", "cat", "gnome"]))).toBeNull();
    expect(COMPANY.map((c) => c.id)).toEqual(["bird", "cat", "gnome"]);
  });

  test("only visitors in the garden today come; someone missing does not hold up the rest", () => {
    const noBird = (id: Companion) => id !== "bird";
    expect(due(15, noBird, none)).toBeNull();
    expect(due(20, noBird, none)).toBe("cat");
    expect(due(600, () => false, none)).toBeNull();
    // Late: everyone due comes, one after the other.
    expect(due(45, all, none)).toBe("bird");
  });

  test("the head turns toward who came, looks a while, and turns back", () => {
    expect(glance(0)).toBe(0);
    expect(glance(GLANCE.turn / 2)).toBeCloseTo(0.5);
    expect(glance(GLANCE.turn)).toBe(1);
    expect(glance(GLANCE.turn + GLANCE.hold)).toBe(1);
    expect(glance(GLANCE.turn * 1.5 + GLANCE.hold)).toBeCloseTo(0.5);
    expect(glance(2 * GLANCE.turn + GLANCE.hold)).toBe(0);
    expect(glance(60)).toBe(0);
  });
});
