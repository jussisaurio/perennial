import { describe, expect, test } from "bun:test";
import { conditions } from "../conditions";
import type { Frame } from "../scenePart";
import type { Spots } from "../spots";
import { layout, lanternSpots, type GardenPlant } from "../world";
import { KINDS } from ".";
import type { Arrival, Home, Visitor } from "./kind";

// Each kind is pure: these drive it with a fixed `now` and a fixed dt, as the runtime would.

const NOW = new Date(2026, 9, 15, 12, 0);
const DT = 1 / 60;
const plant = (i: number): GardenPlant => ({ id: `w${i}`, lemma: `word${i}`, gloss: "", pos: "noun", rank: i, s: 10, r: 0.95, stage: "bloom", growth: 0.5, listen: false, write: false, forms: [] });
const L = layout([plant(1), plant(2), plant(3)]);
const SPOTS: Spots = {
  bench: { x: 0, z: 2 },
  pads: [
    [L.pond.x + 0.5, L.pond.z],
    [L.pond.x, L.pond.z + 0.5],
  ],
  lanterns: lanternSpots(L),
  perches: [[1, 1.19, 1]],
  trees: [],
};
const HOME: Home = { x: 1, z: 1, soil: 0.3, top: 0.9, thirsty: false };

function arrive(id: keyof typeof KINDS, a: Partial<Arrival> = {}): Visitor<string> {
  const it = KINDS[id].arrive({ spots: SPOTS, layout: L, home: null, now: NOW, reducedMotion: false, ...a });
  if (!it) throw new Error(`${id} stayed away`);
  return it;
}

/** Steps a visitor `s` seconds with the viewer standing at (x, z); returns whether it was ever startled. */
function run(v: Visitor<string>, s: number, x: number, z: number, seen = true, from = 0): boolean {
  const f: Frame = { dt: DT, elapsed: from, x, z, yaw: 0 };
  let startled = false;
  for (let t = 0; t < s; t += DT) {
    f.elapsed += DT;
    if (v.step?.(f, seen) === "startled") startled = true;
  }
  return startled;
}

describe("visitor kinds", () => {
  test("every kind's frames have art, and every kind that comes starts on one of them", () => {
    for (const k of Object.values(KINDS)) {
      expect(Object.keys(k.art).length).toBeGreaterThan(0);
      const it = k.arrive({ spots: SPOTS, layout: L, home: HOME, now: NOW, reducedMotion: false });
      expect(it).not.toBeNull();
      expect(Object.keys(k.art)).toContain(it!.body.frame);
    }
  });

  test("the dog and the butterfly stay away without their word's plant", () => {
    expect(KINDS.dog.arrive({ spots: SPOTS, layout: L, home: null, now: NOW, reducedMotion: false })).toBeNull();
    expect(KINDS.butterfly.arrive({ spots: SPOTS, layout: L, home: null, now: NOW, reducedMotion: false })).toBeNull();
  });

  test("the frog sleeps by day and does not answer a tap; awake at dusk, it croaks a known word, puffed up for a moment", () => {
    const frog = arrive("frog");
    frog.onConditions!(conditions("day"));
    expect(frog.body.frame).toBe("asleep");
    expect(frog.onTap!({ elapsed: 1, known: ["casa"], lang: "es" })).toBeNull();
    frog.onConditions!(conditions("dusk"));
    // About one day in 25 it sleeps all day: this one is not.
    expect(frog.body.frame).toBe("awake");
    expect(frog.onTap!({ elapsed: 1, known: ["casa"], lang: "es" })).toBe("croac… casa");
    expect(frog.body.frame).toBe("croak");
    run(frog, 1, 50, 50, true, 1);
    expect(frog.body.frame).toBe("awake");
    frog.onConditions!(conditions("day"));
    expect(frog.body.mute).toBe(true);
  });

  test("a pebble in the pond: the frog on a pad hops to the next pad in an arc and stays; at its plant it does not", () => {
    const frog = arrive("frog");
    const from = { ...frog.body.at };
    expect(frog.onSplash!()).toBe(true);
    expect(frog.body.at).not.toEqual(from);
    run(frog, 0.2, 50, 50);
    expect(frog.body.y).toBeGreaterThan(from.y);
    run(frog, 1, 50, 50);
    expect([frog.body.x, frog.body.z]).toEqual([frog.body.at.x, frog.body.at.z]);
    // Landed: sin(π) leaves a rounding error, not a height.
    expect(frog.body.y).toBeCloseTo(from.y, 9);
    expect(arrive("frog", { home: HOME }).onSplash!()).toBe(false);
  });

  test("the bird hops away when you come close, is gone, and comes back to its spot when you walk off", () => {
    const bird = arrive("bird");
    const at = { ...bird.body.at };
    expect(at).toEqual({ x: 1, y: 1.19, z: 1 });
    expect(run(bird, 0.1, at.x + 0.5, at.z)).toBe(true);
    expect(bird.body.frame).toBe("hop");
    run(bird, 1, at.x + 0.5, at.z);
    expect(bird.body.visible).toBe(false);
    run(bird, 0.1, at.x + 10, at.z);
    expect(bird.body).toMatchObject({ visible: true, frame: "sit", x: at.x, y: at.y, z: at.z });
  });

  test("the bird sits in its orchard tree on its days there", () => {
    const bird = arrive("bird", { home: HOME, spots: { ...SPOTS, trees: [{ who: "bird", tree: "t1", x: 5, y: 3, z: -20 }] } });
    expect(bird.body.at).toEqual({ x: 5, y: 3, z: -20 });
  });

  test("the heron steps back once when you come near, and home when you are well away; with reduced motion it stays", () => {
    const heron = arrive("heron");
    const { x, z } = heron.body.at;
    run(heron, 2, x + 1, z);
    // Half a metre away from you, less where the garden stops it.
    const step = Math.hypot(heron.body.x - x, heron.body.z - z);
    expect(step).toBeGreaterThan(0.2);
    expect(step).toBeLessThanOrEqual(0.5);
    expect(heron.body.x).toBeLessThan(x);
    run(heron, 2, x + 10, z);
    expect([heron.body.x, heron.body.z]).toEqual([x, z]);
    const still = arrive("heron", { reducedMotion: true });
    run(still, 2, x + 1, z);
    expect([still.body.x, still.body.z]).toEqual([x, z]);
  });

  test("the gnome looks away after a few seconds out of view, hiding its name, and faces you again", () => {
    const gnome = arrive("gnome");
    gnome.onConditions!(conditions("day"));
    run(gnome, 3, 0, 0, false);
    expect(gnome.body.frame).toBe("side");
    expect(gnome.body.tag).toBe(0);
    run(gnome, 1, 0, 0, true, 3);
    expect(gnome.body.frame).toBe("front");
    expect(gnome.body.tag).toBe(1);
    gnome.onConditions!(conditions("night"));
    expect(gnome.body).toMatchObject({ frame: "frontLit", glow: true });
  });

  test("the moth is out only at dusk and night, and the butterfly goes at night", () => {
    const moth = arrive("moth");
    const butterfly = arrive("butterfly", { home: HOME });
    moth.onConditions!(conditions("day"));
    butterfly.onConditions!(conditions("day"));
    expect([moth.body.visible, butterfly.body.visible]).toEqual([false, true]);
    moth.onConditions!(conditions("night"));
    butterfly.onConditions!(conditions("night"));
    expect([moth.body.visible, butterfly.body.visible]).toEqual([true, false]);
  });

  test("the snail creeps along the rail with the walk's own clock, and stays on its plant when it has one", () => {
    const snail = arrive("snail");
    const start = { ...snail.body.at };
    run(snail, 600, 0, 0);
    const moved = Math.hypot(snail.body.at.x - start.x, snail.body.at.z - start.z);
    // About a millimetre a second.
    expect(moved).toBeGreaterThan(0.2);
    expect(moved).toBeLessThan(2);
    const home = arrive("snail", { home: HOME });
    run(home, 10, 0, 0);
    expect(home.body.at).toEqual({ x: 1.05, y: 0.3 + 0.6 * 0.45, z: 1.09 });
  });

  test("the fish swims round the pond head first", () => {
    const fish = arrive("fish");
    run(fish, 5, 0, 0);
    const a = 5 * 0.2;
    expect(fish.body.turn).toBeCloseTo(a + Math.PI / 2, 1);
    expect(Math.hypot(fish.body.x - L.pond.x, fish.body.z - L.pond.z)).toBeCloseTo(L.pond.r * 0.45, 5);
  });

  test("the moth's lantern blown out (#361): it flies, a little hurt, to the nearest lit one; with none lit it sits in the dark, and goes to the first lit again", () => {
    const moth = arrive("moth");
    moth.onConditions!(conditions("night"));
    const spot = (v: Visitor<string>) => SPOTS.lanterns.findIndex(([x, z]) => x === v.body.at.x && z === v.body.at.z);
    const home = spot(moth);
    const on = SPOTS.lanterns.map(() => true);
    on[home] = false;
    expect(moth.onLanterns!(on)).toBe("…");
    const to = spot(moth);
    const dist = (i: number) => Math.hypot(SPOTS.lanterns[i][0] - SPOTS.lanterns[home][0], SPOTS.lanterns[i][1] - SPOTS.lanterns[home][1]);
    expect(to).not.toBe(home);
    for (let i = 0; i < on.length; i++) if (i !== home) expect(dist(to)).toBeLessThanOrEqual(dist(i));
    // It gets there.
    run(moth, 2, 0, 0);
    expect(Math.hypot(moth.body.x - SPOTS.lanterns[to][0], moth.body.z - SPOTS.lanterns[to][1])).toBeLessThan(0.3);
    // Every lantern out: it sits on its dark lantern, saying nothing, and stays.
    expect(moth.onLanterns!(on.map(() => false))).toBeNull();
    run(moth, 1, 0, 0);
    expect([moth.body.x, moth.body.z, moth.body.frame]).toEqual([SPOTS.lanterns[to][0], SPOTS.lanterns[to][1], "closed"]);
    // One lit again: it goes there, not hurt this time.
    const lit = on.map((_, i) => i === home);
    expect(moth.onLanterns!(lit)).toBeNull();
    expect(spot(moth)).toBe(home);
  });
});
