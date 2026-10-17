import { describe, expect, test } from "bun:test";
import { conditions } from "../conditions";
import type { Frame } from "../scenePart";
import type { Spots } from "../spots";
import { layout, lanternSpots, type GardenPlant } from "../world";
import { KINDS } from ".";
import { catComes } from "./cat";
import type { Arrival, Home, Visitor } from "./kind";
import { GOAT_GONE } from "./goat";
import { CAUGHT, GAP, MOLE_CAUGHT, molePops, POP } from "./mole";

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
  sign: [1, 1.19, 1],
  trees: [],
  orchard: [],
  piles: [],
  ledges: [
    { on: "hedge", at: [0, 2.6, 5] },
    { on: "shed", at: [4, 1.8, 3] },
    { on: "sign", at: [1, 1.19, -4] },
    { on: "bench", at: [0, 0.8, 1.8] },
  ],
};
const HOME: Home = { x: 1, z: 1, soil: 0.3, top: 0.9, thirsty: false };

function arrive(id: keyof typeof KINDS, a: Partial<Arrival> = {}): Visitor<string> {
  const it = KINDS[id].arrive({ spots: SPOTS, layout: L, home: null, now: NOW, age: 0, reducedMotion: false, lang: "es", ...a });
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
      const it = k.arrive({ spots: SPOTS, layout: L, home: HOME, now: NOW, age: 0, reducedMotion: false, lang: "es" });
      expect(it).not.toBeNull();
      expect(Object.keys(k.art)).toContain(it!.body.frame);
    }
  });

  test("the dog and the butterfly stay away without their word's plant", () => {
    expect(KINDS.dog.arrive({ spots: SPOTS, layout: L, home: null, now: NOW, age: 0, reducedMotion: false, lang: "es" })).toBeNull();
    expect(KINDS.butterfly.arrive({ spots: SPOTS, layout: L, home: null, now: NOW, age: 0, reducedMotion: false, lang: "es" })).toBeNull();
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

  test("fetch (#335 S2): the dog runs to it, takes it, brings it to you, waits, and goes home; one fetch at a time", () => {
    const dog = arrive("dog", { home: HOME });
    const home = { ...dog.body.at };
    /** Steps until the dog says `e`, with you at (x, z); how many seconds that took. */
    const until = (e: "took" | "dropped", x: number, z: number) => {
      const f: Frame = { dt: DT, elapsed: 0, x, z, yaw: 0, speed: 0 };
      for (let t = 0; t < 20; t += DT) {
        f.elapsed += DT;
        if (dog.step!(f, true) === e) return t;
      }
      throw new Error(`the dog never ${e}`);
    };
    expect(dog.fetch!(4, 1)).toBe(true);
    // Out on a fetch, it does not hear a call.
    expect(dog.onCall!({ elapsed: 0, x: 0, z: 5, lang: "es" })).toBeNull();
    until("took", 0, 5);
    expect(dog.fetch!(0, 0)).toBe(false);
    expect([dog.body.x, dog.body.z]).toEqual([4, 1]);
    // Down off its bed while it runs.
    expect(dog.body.y).toBe(0);
    until("dropped", 0, 5);
    expect(Math.hypot(dog.body.x, dog.body.z - 5)).toBeCloseTo(1.4, 5);
    // It waits by you a moment, then trots home, back up on its bed.
    run(dog, 10, 0, 5);
    expect(dog.body).toMatchObject({ x: home.x, y: home.y, z: home.z });
    expect(dog.fetch!(0, 0)).toBe(true);
  });

  test("with reduced motion the dog fetches without running: it is there, then by you", () => {
    const dog = arrive("dog", { home: HOME, reducedMotion: true });
    const f: Frame = { dt: DT, elapsed: 0, x: 0, z: 5, yaw: 0, speed: 0 };
    dog.fetch!(4, 1);
    expect(dog.step!(f, true)).toBe("took");
    expect(dog.step!(f, true)).toBe("dropped");
    expect(dog.body.frame).toBe("sit");
  });

  test("the dog fetched the gnome's hat: it turns its back, hides its name and plays no more, until the hat comes back; fetched itself, it is gone", () => {
    const gnome = arrive("gnome");
    gnome.onConditions!(conditions("day"));
    gnome.onTaken!("hat");
    expect(gnome.body).toMatchObject({ frame: "back", tag: 0 });
    run(gnome, 5, 0, 0, false);
    run(gnome, 5, 0, 0, true, 5);
    expect(gnome.body.frame).toBe("back");
    gnome.onConditions!(conditions("night"));
    expect(gnome.body).toMatchObject({ frame: "backLit", glow: true });
    gnome.onHatBack!();
    expect(gnome.body).toMatchObject({ frame: "frontLit", tag: 1 });
    gnome.onTaken!("self");
    // No lantern glowing where it stood.
    expect(gnome.body).toMatchObject({ visible: false, glow: false });
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

describe("a call (#377)", () => {
  /** Whistle at `elapsed` s, standing at (x, z). */
  const call = (v: Visitor<string>, elapsed: number, x: number, z: number) => v.onCall!({ elapsed, x, z, lang: "es" });

  test("every kind answers a call in its own way", () => {
    for (const k of Object.values(KINDS)) {
      const it = k.arrive({ spots: SPOTS, layout: L, home: HOME, now: NOW, reducedMotion: false, lang: "es" })!;
      // A call asks only the visitors in sight: the mole is under the ground until it comes up (its own test below).
      if (!it.body.visible) continue;
      expect(call(it, 0, 5, 5)?.line).toBeTruthy();
    }
  });

  test("the dog runs to you, tail going, sits a while and trots home, back up on its bed", () => {
    const dog = arrive("dog", { home: HOME });
    const at = { ...dog.body.at };
    expect(call(dog, 0, 5, 1)?.line).toBe("The dog runs over, tail going.");
    const frames = new Set<string>();
    for (let t = 0; t < 2; t += 0.1) {
      run(dog, 0.1, 5, 1, true, t);
      frames.add(dog.body.frame);
    }
    expect(Math.hypot(dog.body.x - 5, dog.body.z - 1)).toBeCloseTo(0.7, 5);
    expect(dog.body.y).toBe(0);
    expect(frames).toEqual(new Set(["sit", "wag"]));
    run(dog, 10, 5, 1, true, 2);
    expect(dog.body).toMatchObject({ x: at.x, y: at.y, z: at.z });
  });

  test("the cat flicks one ear; about one call in 50 it walks over, sits and stares, and goes back once you walk away", () => {
    const cat = arrive("cat", { home: HOME });
    let n = 0;
    while (!catComes(NOW, n)) n++;
    expect(n).toBeGreaterThan(0);
    expect(call(cat, 0, 5, 1)?.line).toBe("The cat flicks one ear.");
    run(cat, 0.1, 5, 1);
    expect(cat.body.frame).toBe("ear");
    run(cat, 0.5, 5, 1, true, 0.1);
    expect(cat.body.frame).toBe("asleep");
    for (let i = 1; i < n; i++) expect(call(cat, 1, 5, 1)?.line).toBe("The cat flicks one ear.");
    expect(call(cat, 1, 5, 1)?.line).toBe("The cat gets up, walks over, sits at your feet and stares at you.");
    run(cat, 10, 5, 1, true, 1);
    expect(cat.body.frame).toBe("stare");
    expect(Math.hypot(cat.body.x - 5, cat.body.z - 1)).toBeCloseTo(0.45, 5);
    expect(call(cat, 11, 5, 1)?.line).toBe("The cat stares at you.");
    run(cat, 15, 15, 1, true, 11);
    expect(cat.body).toMatchObject({ frame: "asleep", x: cat.body.at.x, y: cat.body.at.y, z: cat.body.at.z });
    // Seeded, about one call in 50.
    let comes = 0;
    for (let i = 0; i < 5000; i++) if (catComes(NOW, i)) comes++;
    expect(comes).toBeGreaterThan(50);
    expect(comes).toBeLessThan(200);
  });

  test("the gnome freezes, its name hidden, then plays statues again", () => {
    const gnome = arrive("gnome");
    gnome.onConditions!(conditions("day"));
    call(gnome, 0, 0, 0);
    expect(gnome.body.tag).toBe(0);
    // Out of view it would look away after a few seconds: frozen, it does not.
    run(gnome, 5, 0, 0, false);
    expect(gnome.body).toMatchObject({ frame: "front", tag: 0 });
    run(gnome, 2, 0, 0, true, 5);
    expect(gnome.body).toMatchObject({ frame: "front", tag: 1 });
  });

  test("the frog croaks back once, in its course's sound, even in its sleep", () => {
    const frog = arrive("frog");
    frog.onConditions!(conditions("day"));
    expect(call(frog, 0, 0, 0)).toEqual({ line: "The frog croaks once in its sleep.", say: "croac…" });
    expect(frog.body.frame).toBe("croak");
    run(frog, 1, 0, 0);
    expect(frog.body.frame).toBe("asleep");
    frog.onConditions!(conditions("dusk"));
    expect(call(frog, 1, 0, 0)?.line).toBe("The frog croaks back.");
  });

  test("the bird flies up and lands again where it was; with reduced motion it does not answer", () => {
    const bird = arrive("bird");
    const at = { ...bird.body.at };
    call(bird, 0, 10, 10);
    run(bird, 0.7, 10, 10);
    expect(bird.body).toMatchObject({ frame: "hop", x: at.x, z: at.z });
    expect(bird.body.y).toBeGreaterThan(at.y + 0.5);
    run(bird, 1, 10, 10, true, 0.7);
    expect(bird.body).toMatchObject({ frame: "sit", y: at.y });
    expect(call(arrive("bird", { reducedMotion: true }), 0, 10, 10)).toBeNull();
  });

  test("the snail goes into its shell three full seconds after the call, and comes out again", () => {
    const snail = arrive("snail", { home: HOME });
    call(snail, 1, 0, 0);
    run(snail, 2.9, 0, 0, true, 1);
    expect(snail.body.frame).toBe("snail");
    run(snail, 0.2, 0, 0, true, 3.9);
    expect(snail.body.frame).toBe("shell");
    run(snail, 5, 0, 0, true, 4.1);
    expect(snail.body.frame).toBe("snail");
  });

  test("the heron takes one slow step back and home again; the fish darts round; the butterfly lifts off higher", () => {
    const heron = arrive("heron");
    const { x, z } = heron.body.at;
    call(heron, 0, x + 10, z);
    run(heron, 1, x + 10, z);
    expect(heron.body.x).toBeLessThan(x);
    run(heron, 4, x + 10, z, true, 1);
    expect([heron.body.x, heron.body.z]).toEqual([x, z]);

    const calm = arrive("fish");
    const darting = arrive("fish");
    call(darting, 0, 0, 0);
    run(calm, 1, 0, 0);
    run(darting, 1, 0, 0);
    expect(darting.body.turn - Math.PI / 2).toBeCloseTo(8 * (calm.body.turn - Math.PI / 2), 1);

    const still = arrive("butterfly", { home: HOME });
    const flying = arrive("butterfly", { home: HOME });
    call(flying, 0, 0, 0);
    run(still, 0.8, 0, 0);
    run(flying, 0.8, 0, 0);
    expect(flying.body.y - still.body.y).toBeCloseTo(0.4, 1);
  });
});

describe("the goat in impossible places (#376)", () => {
  test("it stands on one of the ledges, a different one on different days", () => {
    const on = new Set<string>();
    for (let d = 0; d < 40; d++) {
      const goat = arrive("goat", { now: new Date(2026, 9, 1 + d, 12) });
      const ledge = SPOTS.ledges.find((l) => l.at.join() === [goat.body.at.x, goat.body.at.y, goat.body.at.z].join());
      expect(ledge).toBeDefined();
      on.add(ledge!.on);
    }
    expect(on.size).toBe(4);
  });

  test("it stays until you have seen it; look away and back, and it is gone for good", () => {
    const goat = arrive("goat");
    const { x, z } = goat.body.at;
    // Never seen: out of view for a long time, it waits.
    run(goat, 10, x, z - 3, false);
    expect(goat.body.visible).toBe(true);
    run(goat, 0.5, x, z - 3, true, 10);
    // A glance away shorter than GOAT_GONE: still there.
    run(goat, GOAT_GONE / 2, x, z - 3, false, 10.5);
    run(goat, 0.1, x, z - 3, true, 10.5 + GOAT_GONE / 2);
    expect(goat.body.visible).toBe(true);
    run(goat, GOAT_GONE + 0.1, x, z - 3, false, 11);
    expect(goat.body.visible).toBe(false);
    run(goat, 5, x, z - 3, true, 13);
    expect(goat.body.visible).toBe(false);
  });

  test("a screen reader hears where it stands while you are near, and nothing once it has gone", () => {
    const goat = arrive("goat");
    const { x, z } = goat.body.at;
    const on = SPOTS.ledges.find((l) => l.at[0] === x && l.at[2] === z)!.on;
    run(goat, 0.1, x, z + 20);
    expect(goat.body.status).toBeNull();
    run(goat, 0.1, x, z + 2, true, 0.1);
    expect(goat.body.status).toBe({ hedge: "A goat stands on top of the hedge.", shed: "A goat stands on the roof of the shed.", sign: "A goat stands on top of the sign.", bench: "A goat stands on the back of the bench." }[on]);
    run(goat, GOAT_GONE + 0.1, x, z + 2, false, 0.2);
    expect(goat.body.status).toBeNull();
  });
});

describe("the mole behind your back (#376)", () => {
  /** The first walk opening (a minute apart from NOW) on which the mole comes up `n` times. */
  const visitWith = (n: number): Date => {
    for (let m = 0; ; m++) {
      const d = new Date(NOW.getTime() + m * 60_000);
      if (molePops(d) === n) return d;
    }
  };

  /** Steps the mole `s` seconds from `from`; `you(t)` gives where you are and whether its place is in view. Returns the frames it showed. */
  function drive(v: Visitor<string>, s: number, you: (t: number) => [number, number, boolean], from = 0): string[] {
    const f: Frame = { dt: DT, elapsed: from, x: 0, z: 0, yaw: 0, speed: 0 };
    const shown: string[] = [];
    for (let t = 0; t < s; t += DT) {
      f.elapsed += DT;
      const [x, z, seen] = you(f.elapsed);
      [f.x, f.z] = [x, z];
      v.step!(f, seen);
      if (v.body.visible && shown.at(-1) !== v.body.frame) shown.push(v.body.frame);
    }
    return shown;
  }

  /** Stand at (0, 0) for 3 s, then walk away along +x at 1.5 m/s, never looking back. */
  const standThenWalk = (t: number): [number, number, boolean] => [Math.max(0, t - 3) * 1.5, 0, false];

  test("stand still, walk on: where you stood, it comes up, says hello to nobody in the course language, and goes down", () => {
    const m = arrive("mole", { now: visitWith(1) });
    expect(m.body.visible).toBe(false);
    let said: string | null = null;
    const shown = drive(m, 10, (t) => {
      said ??= m.body.says;
      return standThenWalk(t);
    });
    expect(shown).toEqual(["hill", "up", "hill"]);
    expect([m.body.at.x, m.body.at.z]).toEqual([0, 0]);
    expect(said).toBe("¿Hola?");
    expect(m.body.visible).toBe(false);
    expect(m.body.status).toBeNull();
    const de = arrive("mole", { now: visitWith(1), lang: "de" });
    said = null;
    drive(de, 10, (t) => {
      said ??= de.body.says;
      return standThenWalk(t);
    });
    expect(said).toBe("Hallo?");
  });

  test("it does not come up while you look, nor where you only walked past, nor on a visit it stays down", () => {
    // Looking back the whole time.
    expect(drive(arrive("mole", { now: visitWith(1) }), 10, (t) => [standThenWalk(t)[0], 0, true])).toEqual([]);
    // Walking on without stopping.
    expect(drive(arrive("mole", { now: visitWith(1) }), 10, (t) => [t * 1.5, 0, false])).toEqual([]);
    expect(drive(arrive("mole", { now: visitWith(0) }), 10, standThenWalk)).toEqual([]);
  });

  test("turn round while it is up and it panics and digs down, fast; a screen reader hears that you caught it", () => {
    const m = arrive("mole", { now: visitWith(1) });
    let up = -1;
    const shown = drive(m, 12, (t) => {
      if (up < 0 && m.body.frame === "up") up = t;
      // You turn round half a second after it looked out.
      return [standThenWalk(t)[0], 0, up >= 0 && t > up + 0.5];
    });
    expect(shown.slice(0, 4)).toEqual(["hill", "up", "panic", "dig"]);
    expect(shown).toContain("dig2");
    expect(shown.at(-1)).toBe("hill");
    expect(m.body.visible).toBe(false);
    // It said nothing once caught, and the line has gone a few seconds later.
    expect(m.body.says).toBeNull();
    expect(m.body.status).toBeNull();
    const again = arrive("mole", { now: visitWith(1) });
    let heard: string | null = null;
    up = -1;
    drive(again, 7, (t) => {
      if (up < 0 && again.body.frame === "up") up = t;
      heard ??= again.body.status;
      return [standThenWalk(t)[0], 0, up >= 0 && t > up + 0.5];
    });
    expect(heard).toBe(MOLE_CAUGHT);
    expect(up).toBeGreaterThan(0);
    // Caught, it is down well before it would have finished saying hello.
    expect(CAUGHT.end).toBeLessThan(POP.end - POP.hill);
  });

  test("with reduced motion it digs down in one still frame", () => {
    const m = arrive("mole", { now: visitWith(1), reducedMotion: true });
    let up = -1;
    const shown = drive(m, 12, (t) => {
      if (up < 0 && m.body.frame === "up") up = t;
      return [standThenWalk(t)[0], 0, up >= 0];
    });
    expect(shown).toEqual(["hill", "up", "panic", "dig", "hill"]);
  });

  test("a minute at least between times, and no more times than the visit has", () => {
    const m = arrive("mole", { now: visitWith(2) });
    /** Stand for 3 s at the start of every 20 s, walking 4 m out and back between. */
    const pace = (t: number): [number, number, boolean] => {
      const k = t % 20;
      return [k < 3 ? 0 : k < 9 ? Math.min(4, (k - 3) * 1.5) : Math.max(0, 4 - (k - 9) * 1.5), 0, false];
    };
    let pops = 0;
    let was = false;
    const at: number[] = [];
    drive(m, 300, (t) => {
      if (m.body.visible && !was) {
        pops++;
        at.push(t);
      }
      was = m.body.visible;
      return pace(t);
    });
    expect(pops).toBe(2);
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(GAP);
  });

  test("whistle while it is up (#377): it digs back down at once", () => {
    const m = arrive("mole", { now: visitWith(1) });
    let line: string | undefined;
    const shown = drive(m, 10, (t) => {
      if (line === undefined && m.body.frame === "up") line = m.onCall!({ elapsed: t, x: 0, z: 0, lang: "es" })?.line;
      return standThenWalk(t);
    });
    expect(line).toBe("The mole digs back down, fast.");
    expect(shown).toEqual(["hill", "up", "panic", "dig", "dig2"].concat(shown.slice(5)));
    expect(m.body.visible).toBe(false);
  });
});
