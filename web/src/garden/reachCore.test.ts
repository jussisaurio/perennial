import { describe, expect, test } from "bun:test";
import { lookoutAt } from "./lookout";
import { KEY_REACH, offerAt, offersAt, press, REACH_NAME, same, type Offer, type Things } from "./reachCore";
import { stileAt } from "./stile";
import { newWalker, type Walker } from "./walker";
import { benchAt, lanternSpots, layout, type GardenPlant } from "./world";

// The claims of docs/garden-play.md that are about what is in reach and what
// the action button does, asked of the core alone (#975): the same places as
// the e2e tests of the same names, with no browser.

const DAY = 86_400_000;
const plant = (i: number): GardenPlant => ({
  id: `w${i}`,
  lemma: `word${i}`,
  gloss: "",
  pos: "noun",
  rank: i,
  planted: Math.floor(i / 6) * DAY,
  s: 10,
  r: 0.95,
  stage: "bloom",
  growth: 0.5,
  listen: false,
  write: false,
  forms: [],
});
const L = layout(Array.from({ length: 30 }, (_, i) => plant(i)));
const HILL = lookoutAt(stileAt(L));
const BENCH = benchAt(L);
const GATE = { x: L.gate.x, z: L.bounds.maxZ };
// The garden's lanterns, then the lookout's on its post, as sceneLanterns.ts keeps them.
const LAMPS: [number, number, number][] = [...lanternSpots(L), HILL.post].map(([x, z]) => [x, 2, z]);
const HILL_LAMP = LAMPS.length - 1;
const GATE_LAMP = LAMPS.findIndex(([x, , z]) => x === L.gate.x + 1.6 && z === L.gate.z - 0.4);

/** The garden by day: the door locked, its key not found, a stile and a hill with no diary yet, no pebbles, clocks, hiders or notes. `over` changes what a test is about. */
function things(over: Partial<Things> = {}): Things {
  return {
    door: { state: "locked", key: null },
    gate: GATE,
    bench: BENCH,
    lanterns: { at: LAMPS, on: LAMPS.map(() => true), dark: false, lookout: HILL_LAMP },
    lookout: { hill: HILL, pages: [] },
    plants: L.plants,
    carry: { held: null, reachAt: () => null },
    toys: { reachAt: () => null },
    hiders: { hiderNear: () => null },
    mat: { noteInReach: () => null },
    note: () => null,
    ...over,
  };
}

const night = (on: boolean[] = LAMPS.map(() => true)): Pick<Things, "lanterns"> => ({ lanterns: { at: LAMPS, on, dark: true, lookout: HILL_LAMP } });

function at(x: number, z: number, yaw = 0): Walker {
  return Object.assign(newWalker(x, z), { yaw });
}

function seated(on: "bench" | "stool"): Walker {
  return Object.assign(newWalker(0, 0), { mode: { kind: "seated", on } as const });
}

/** A place on the hilltop, `ahead` m in front of the stool (toward the far house) and `right` m to its right. */
function byStool(ahead: number, right: number): Walker {
  // Forward is -z at yaw 0; your right is (-fz, fx).
  const [fx, fz] = [-Math.sin(HILL.face), -Math.cos(HILL.face)];
  return at(HILL.stool[0] + fx * ahead - fz * right, HILL.stool[1] + fz * ahead + fx * right);
}

/** What the button's name says to a screen reader, or null with no button. */
const name = (o: Offer | null) => (o ? REACH_NAME[o.a] : null);
const acts = (w: Walker, t: Things, shown: Offer | null = null) => offersAt(w, t, shown).map((o) => o.a);

describe("the action button shows only when something is in reach", () => {
  test("action.none: on open ground away from everything no action button shows; a step from the bench it shows, named Sit on the bench", () => {
    const t = things();
    expect(offerAt(at(BENCH.x, BENCH.z - 3), t, null)).toBeNull();
    expect(name(offerAt(at(BENCH.x, BENCH.z - 1), t, null))).toBe("Sit on the bench");
  });

  test("action.reach-edge: the bench comes into reach where Sit shows, and stays in reach a small step farther, so the button does not blink at the edge", () => {
    const t = things();
    let shown: Offer | null = null;
    const standBack = (back: number) => (shown = offerAt(at(BENCH.x, BENCH.z - back), t, shown));
    // Just inside the bench's reach (reachCore.ts BENCH_REACH 1.6 m).
    expect(name(standBack(1.55))).toBe("Sit on the bench");
    expect(name(standBack(1.7))).toBe("Sit on the bench");
    expect(standBack(1.95)).toBeNull();
    expect(standBack(1.7)).toBeNull();
    expect(name(standBack(1.55))).toBe("Sit on the bench");
  });

  test("only the thing the button shows stays in reach a step farther: just past the door's reach, with the bench's Sit showing, no Try the door", () => {
    const t = things();
    const w = at(GATE.x, GATE.z - 2.7);
    expect(acts(w, t, { on: "door", a: "try", target: null })).toContain("try");
    expect(acts(w, t, { on: "bench", a: "sit", target: null })).not.toContain("try");
    expect(acts(w, t)).not.toContain("try");
  });
});

describe("the door's button says what it will do", () => {
  const door = at(GATE.x, GATE.z - 1);

  test("the locked door is Try the door; with the key in your hand, Open the door with the key; an open door has no button", () => {
    expect(name(offerAt(door, things(), null))).toBe("Try the door");
    expect(name(offerAt(door, things({ door: { state: "key", key: { x: 30, z: 30 } } }), null))).toBe("Try the door");
    expect(name(offerAt(door, things({ door: { state: "held", key: null } }), null))).toBe("Open the door with the key");
    expect(acts(door, things({ door: { state: "open", key: null } }))).toEqual([]);
  });

  test("the key lying in the garden is Pick up the key within 2 m, before the door it lies by, and nothing once it is in your hand", () => {
    const key = { x: GATE.x + 0.5, z: GATE.z - 2 };
    const t = things({ door: { state: "key", key } });
    expect(acts(door, t)).toEqual(["key", "try"]);
    expect(name(offerAt(door, t, null))).toBe("Pick up the key");
    expect(acts(at(key.x, key.z - 2.1), t)).not.toContain("key");
    expect(acts(at(key.x, key.z - KEY_REACH + 0.1), t)).toContain("key");
    expect(acts(door, things({ door: { state: "held", key } }))).toEqual(["open"]);
  });

  test("at night the door wins over a lantern by the gate that is farther off, and the lantern wins when it is nearer", () => {
    const t = things(night());
    expect(acts(at(GATE.x + 0.5, GATE.z - 0.8), t)).toEqual(["try", "snuff"]);
    const byLamp = at(GATE.x + 1.2, GATE.z - 1);
    expect(acts(byLamp, t)).toEqual(["snuff"]);
    expect(offerAt(byLamp, t, null)).toEqual({ on: "lantern", a: "snuff", target: GATE_LAMP });
    // By day the lanterns are not lit: the door again.
    expect(acts(byLamp, things())).toEqual(["try"]);
  });

  test("mousedoor.read: the last note on the mouse door's mat is Read the note, before the door whose reach it lies in", () => {
    const t = things({ mat: { noteInReach: () => "n11" } });
    expect(acts(door, t)).toEqual(["read", "try"]);
    expect(offerAt(door, t, null)).toEqual({ on: "mat", a: "read", target: "n11" });
    expect(name(offerAt(door, t, null))).toBe("Read the note");
  });
});

describe("the lanterns", () => {
  const post = at(HILL.post[0] + 1, HILL.post[1]);

  test("hill.lantern: by a lit lantern at night the button is Blow out the lantern, by one blown out Light the lantern; by day there is none", () => {
    expect(offerAt(post, things(night()), null)).toEqual({ on: "lantern", a: "snuff", target: HILL_LAMP });
    expect(name(offerAt(post, things(night()), null))).toBe("Blow out the lantern");
    const out = LAMPS.map((_, i) => i !== HILL_LAMP);
    expect(name(offerAt(post, things(night(out)), null))).toBe("Light the lantern");
    expect(offerAt(post, things(), null)).toBeNull();
  });

  test("a lantern is in reach within 1.5 m of its post, and the one the button shows a small step farther", () => {
    const t = things(night());
    const far = at(HILL.post[0] + 1.6, HILL.post[1]);
    expect(offerAt(far, t, null)).toBeNull();
    expect(offerAt(far, t, { on: "lantern", a: "snuff", target: HILL_LAMP })).toEqual({ on: "lantern", a: "snuff", target: HILL_LAMP });
    // Another lantern showing gives this one no slack.
    expect(offerAt(far, t, { on: "lantern", a: "snuff", target: GATE_LAMP })).toBeNull();
  });
});

describe("the lookout", () => {
  test("hill.sit: by the stool the button is Sit on the stool; sat on it by day it is Stand up; at night it blows out and lights the lantern beside you", () => {
    expect(name(offerAt(byStool(0.5, 0), things(), null))).toBe("Sit on the stool");
    expect(offerAt(byStool(1.1, 0), things(), null)).toBeNull();
    const up = seated("stool");
    expect(name(offerAt(up, things(), null))).toBe("Stand up");
    expect(offerAt(up, things(night()), null)).toEqual({ on: "seat", a: "snuff", target: HILL_LAMP });
    expect(offerAt(up, things(night(LAMPS.map((_, i) => i !== HILL_LAMP))), null)).toEqual({ on: "seat", a: "light", target: HILL_LAMP });
  });

  test("sat on the bench the button only gets you up, at night too", () => {
    expect(acts(seated("bench"), things(night()))).toContain("stand");
    expect(name(offerAt(seated("bench"), things(night()), null))).toBe("Stand up");
  });

  test("hill.diary: by the stone the button is Read the diary once it has a page, and nothing before", () => {
    const stone = at(HILL.stone[0], HILL.stone[1] + 0.5);
    expect(offerAt(stone, things(), null)).toBeNull();
    const t = things({ lookout: { hill: HILL, pages: [{}] } });
    expect(name(offerAt(stone, t, null))).toBe("Read the diary");
    expect(offerAt(at(HILL.stone[0], HILL.stone[1] + 1.1), t, null)).toBeNull();
  });

  test("the stool, then the diary, come before the lantern on the post a step in front of them", () => {
    const t = things({ ...night(), lookout: { hill: HILL, pages: [{}] } });
    expect(acts(byStool(0.6, 0), t)).toEqual(["stool", "snuff"]);
    expect(acts(byStool(0.9, 1.2), t)).toEqual(["diary", "snuff"]);
  });
});

describe("which action wins when several things are in reach", () => {
  // A step and a half in front of a front-row plant, looking at it.
  const spot = () => {
    const p = L.plants[1];
    return { p, w: at(p.x, p.z + 1.5) };
  };

  test("shake: the plant ahead of you is Shake the plant; with your back to it there is no button", () => {
    const { p, w } = spot();
    const t = things({ bench: { x: 99, z: 99 } });
    expect(offerAt(w, t, null)).toEqual({ on: "plant", a: "shake", target: p });
    expect(name(offerAt(w, t, null))).toBe("Shake the plant");
    expect(offerAt(at(w.x, w.z, Math.PI), t, null)).toBeNull();
  });

  test("the bench comes before the plant ahead, a hiding visitor before the bench, a pebble to pick up before the bench, a dandelion after it", () => {
    const { w } = spot();
    const here = { bench: { x: w.x, z: w.z + 1 } };
    expect(acts(w, things(here))).toEqual(["sit", "shake"]);
    expect(acts(w, things({ ...here, hiders: { hiderNear: () => "gnome" } }))).toEqual(["seek", "sit", "shake"]);
    const pebble = { at: "thing", i: 0 } as const;
    const clock = { at: "clock", i: 0 } as const;
    const t = things({ ...here, carry: { held: null, reachAt: () => ({ a: "lift-pebble", target: pebble }) }, toys: { reachAt: () => ({ a: "blow", target: clock }) } });
    expect(acts(w, t)).toEqual(["lift-pebble", "sit", "blow", "shake"]);
  });

  test("the whole order, with everything in reach at once: hands free, then with a pebble in them", () => {
    const pebble = { at: "thing", i: 0 } as const;
    const all = (held: unknown): Things => ({
      door: { state: "key", key: { x: 0, z: 0 } },
      gate: { x: 0, z: 0 },
      bench: { x: 0, z: 0 },
      // The lantern is a little farther than the door, so the door does not give way to it.
      lanterns: { at: [[0.5, 2, 0]], on: [true], dark: true, lookout: -1 },
      lookout: { hill: { ...HILL, stool: [0, 0], stone: [0, 0] }, pages: [{}] },
      plants: [{ ...L.plants[0], x: 0, z: -1 }],
      carry: { held, reachAt: () => (held === null ? { a: "lift-pebble", target: pebble } : { a: "throw", target: null }) },
      toys: { reachAt: () => ({ a: "blow", target: { at: "clock", i: 0 } }) },
      hiders: { hiderNear: () => "gnome" },
      mat: { noteInReach: () => "n11" },
      note: () => "n01",
    });
    const w = at(0, 0.1);
    expect(offersAt(w, all(null), null).map((o) => o.on)).toEqual(["key", "hider", "mat", "door", "stool", "diary", "lantern", "note", "carry", "bench", "toy", "plant"]);
    expect(acts(w, all(null))).toEqual(["key", "seek", "read", "try", "stool", "diary", "snuff", "read", "lift-pebble", "sit", "blow", "shake"]);
    // A pebble in your hands is thrown before anything but the key.
    expect(acts(w, all(pebble)).slice(0, 3)).toEqual(["key", "throw", "seek"]);
    expect(acts(w, all(pebble))).not.toContain("lift-pebble");
    // Sat down, the seat comes first of all.
    expect(acts(Object.assign(at(0, 0.1), { mode: { kind: "seated", on: "bench" } as const }), all(null))[0]).toBe("stand");
  });

  test("the button changes when its target does: another plant is another offer", () => {
    const [a, b] = L.plants;
    expect(same({ on: "plant", a: "shake", target: a }, { on: "plant", a: "shake", target: a })).toBe(true);
    expect(same({ on: "plant", a: "shake", target: a }, { on: "plant", a: "shake", target: b })).toBe(false);
    expect(same({ on: "mat", a: "read", target: "n11" }, { on: "note", a: "read", target: "n11" })).toBe(false);
    expect(same(null, null)).toBe(true);
    expect(same(null, { on: "bench", a: "sit", target: null })).toBe(false);
  });
});

describe("a press does what the button says", () => {
  const free = at(0, 0);
  const SIT: Offer = { on: "bench", a: "sit", target: null };

  test("a press on what the button shows does that, to that thing", () => {
    const shake: Offer = { on: "plant", a: "shake", target: L.plants[3] };
    expect(press("shake", shake, free)).toBe(shake);
    expect(press("sit", SIT, free)).toBe(SIT);
  });

  test("a press that no longer matches the button does nothing, but for the bench and the door, which check for themselves", () => {
    expect(press("shake", SIT, free)).toBeNull();
    expect(press("shake", null, free)).toBeNull();
    expect(press("snuff", null, free)).toBeNull();
    expect(press("stool", null, free)).toBeNull();
    expect(press("sit", null, free)).toEqual(SIT);
    expect(press("try", SIT, free)).toEqual({ on: "door", a: "try", target: null });
    expect(press("key", null, free)).toEqual({ on: "key", a: "key", target: null });
    expect(press("open", null, free)).toEqual({ on: "door", a: "open", target: null });
  });

  test("you can't sit down while you sit, nor stand up while you stand", () => {
    expect(press("sit", SIT, seated("bench"))).toBeNull();
    expect(press("sit", null, seated("stool"))).toBeNull();
    expect(press("stool", { on: "stool", a: "stool", target: null }, seated("bench"))).toBeNull();
    expect(press("stand", null, free)).toBeNull();
    expect(press("stand", null, seated("bench"))).toEqual({ on: "seat", a: "stand", target: null });
  });
});
