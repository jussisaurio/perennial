import { describe, expect, test } from "bun:test";
import { aimAt, ANSWERS, cairnAt, cairnHolds, FROG_PATIENCE, PEBBLES, pebbleHome, placeAt, reaction, restAt, stickHome, type Answerers } from "./carry";
import { collide, layout, WALKER, type GardenPlant } from "./world";

const plant = (i: number, pos = "noun"): GardenPlant => ({ id: `w${i}`, lemma: `word${i}`, gloss: "", pos, rank: i, s: 10, r: 0.95, stage: "bloom", growth: 0.5, listen: false, write: false });
const gardens = [0, 3, 40, 300].map((n) => layout(Array.from({ length: n }, (_, i) => plant(i, i % 3 ? "noun" : "verb"))));

/** Where a thing came down, for the answers: the first loose thing, at the origin. */
const AT = { i: 0, x: 0, z: 0 };

/** A scene stand-in that records who answered. `fetching`: the dog is out on a fetch already. */
function scene(here: { frogOnPad?: boolean; frog?: boolean; dog?: boolean; fetching?: boolean; plant?: boolean }) {
  const did: string[] = [];
  const who: Answerers = {
    frogHop: () => (here.frogOnPad ? (did.push("hop"), true) : false),
    say: (id, text) => (here[id] ? (did.push(`${id}:${text}`), true) : false),
    perk: () => (here.plant ? (did.push("perk"), true) : false),
    echo: (n) => void did.push(`echo:${n}`),
    fetch: (at) => (here.dog && !here.fetching ? (did.push(`fetch:${at.i}`), true) : false),
  };
  return { who, did };
}

describe("where a thing lands", () => {
  const L = gardens[1];
  test("in the pond, on the cairn's stone, by the dog, in a bed, or on the ground", () => {
    expect(placeAt(L, L.pond.x + 0.4, L.pond.z, null)).toBe("pond");
    const c = cairnAt(L);
    expect(placeAt(L, c.x + 0.1, c.z, null)).toBe("cairn");
    const bed = L.beds[0];
    expect(placeAt(L, bed.x, bed.z, null)).toBe("bed");
    // The dog sits by its plant, in the bed: near it, it is the dog's place.
    expect(placeAt(L, bed.x, bed.z, { x: bed.x + 0.5, z: bed.z })).toBe("dog");
    expect(placeAt(L, L.gate.x, L.gate.z - 1, null)).toBe("ground");
  });

  test("a throw goes ahead, where you face", () => {
    // Forward is -z at yaw 0.
    expect(aimAt(1, 1, 0, 3)).toEqual({ x: 1, z: -2 });
    const left = aimAt(0, 0, Math.PI / 2, 2);
    expect(left.x).toBeCloseTo(-2);
    expect(left.z).toBeCloseTo(0);
  });

  test("off a bed or past the fence it comes to rest where a hand reaches it; in the pond it stays where it fell", () => {
    const bed = L.beds[0];
    const r = restAt(L, bed.x + 0.1, bed.z + bed.d / 2 - 0.3, "bed", false);
    expect(Math.abs(r.z - bed.z)).toBeGreaterThan(bed.d / 2);
    const out = restAt(L, L.bounds.maxX + 3, 0, "ground", false);
    expect(out.x).toBeLessThan(L.bounds.maxX);
    expect(restAt(L, L.pond.x + 0.2, L.pond.z, "pond", false)).toEqual({ x: L.pond.x + 0.2, z: L.pond.z });
  });
});

describe("the rows", () => {
  test("a pebble in the pond sinks with a ripple, and the frog answers; a stick floats", () => {
    expect(reaction("pebble", "pond")).toMatchObject({ then: "sink", ripple: true, answer: "frog" });
    expect(reaction("stick", "pond")).toMatchObject({ then: "float", ripple: true });
  });

  test("only a pebble goes on the cairn; the dog fetches anything but a pebble (#335 S2)", () => {
    expect(reaction("pebble", "cairn").then).toBe("stack");
    expect(reaction("stick", "cairn")).toEqual(reaction("stick", "ground"));
    for (const thing of ["stick", "sock", "sign", "hat", "gnome", "fruit"] as const) {
      expect(reaction(thing, "dog").answer).toBe("dog");
      expect(reaction(thing, "pond")).toMatchObject({ then: "float", ripple: true });
    }
    expect(reaction("pebble", "dog")).toEqual(reaction("pebble", "ground"));
  });

  test("the frog hops away from the first few pebbles, then only looks at you", () => {
    const { who, did } = scene({ frogOnPad: true, frog: true });
    const said = Array.from({ length: FROG_PATIENCE + 2 }, (_, n) => ANSWERS.frog(who, AT, n));
    expect(said.slice(0, FROG_PATIENCE)).toEqual(Array(FROG_PATIENCE).fill("The frog hops to another pad."));
    expect(said.slice(FROG_PATIENCE)).toEqual(["The frog looks at you.", "The frog looks at you."]);
    expect(did).toEqual([...Array(FROG_PATIENCE).fill("hop"), "frog:…", "frog:…"]);
  });

  test("no frog on a pad, no dog, no plant near: nobody answers, and nothing is said for them", () => {
    const { who, did } = scene({});
    expect(ANSWERS.frog(who, AT, 0)).toBeNull();
    expect(ANSWERS.frog(who, AT, FROG_PATIENCE)).toBeNull();
    expect(ANSWERS.dog(who, AT, 0)).toBeNull();
    expect(ANSWERS.plant(who, AT, 0)).toBeNull();
    expect(did).toEqual([]);
  });

  test("the dog runs after what came down; still out on a fetch, it only looks", () => {
    const idle = scene({ dog: true });
    expect(ANSWERS.dog(idle.who, { i: 6, x: 1, z: 2 }, 0)).toBe("The dog runs after it.");
    expect(idle.did).toEqual(["fetch:6"]);
    const busy = scene({ dog: true, fetching: true });
    expect(ANSWERS.dog(busy.who, AT, 1)).toBe("The dog looks at it.");
    expect(busy.did).toEqual(["dog:!"]);
  });
});

test("the cairn stands 3 to 5 pebbles high, and not the same every day", () => {
  const heights = Array.from({ length: 60 }, (_, i) => cairnHolds(20_000 + i));
  expect(new Set(heights)).toEqual(new Set([3, 4, 5]));
});

test("in every size of garden, the pebbles, the stick and the cairn lie on open ground a walker can reach", () => {
  for (const L of gardens) {
    const spots = [...Array.from({ length: PEBBLES }, (_, i) => pebbleHome(L, i)), stickHome(L), cairnAt(L)];
    for (const p of spots) {
      expect(placeAt(L, p.x, p.z, null)).not.toBe("pond");
      expect(placeAt(L, p.x, p.z, null)).not.toBe("bed");
      // Where a walker can stand nearest it is within reach (sceneCarry.ts: 1.1 m).
      const stand = collide(L, p.x, p.z, WALKER);
      expect(Math.hypot(stand.x - p.x, stand.z - p.z)).toBeLessThan(1.1);
    }
  }
});

describe("the orchard's well (#335 S6)", () => {
  const L = gardens[2];
  const w = L.well;

  test("a pebble dropped in falls, and another waits by the pond; the echo answers a moment later, with its own line", () => {
    expect(placeAt(L, w.x + 0.2, w.z, null)).toBe("well");
    expect(reaction("pebble", "well")).toMatchObject({ then: "sink", answer: "well" });
    const { who, did } = scene({});
    expect(ANSWERS.well(who, w, 2)).toBeNull();
    expect(did).toEqual(["echo:2"]);
  });

  test("it stands in the orchard with room to walk round it once the door is open; with the door shut nobody gets near it", () => {
    const o = L.orchard;
    expect(Math.abs(w.z - o.z) + w.r).toBeLessThan(o.d / 2 - 2 * WALKER);
    // Behind it, a walker stays where they are; on it, they are pushed out to its stones.
    const behind = { x: w.x, z: w.z + w.r + WALKER + 0.3 };
    expect(collide(L, behind.x, behind.z, WALKER, true)).toEqual(behind);
    const out = collide(L, w.x + 0.1, w.z, WALKER, true);
    expect(Math.hypot(out.x - w.x, out.z - w.z)).toBeCloseTo(w.r + WALKER);
    expect(collide(L, w.x + 0.1, w.z, WALKER, false).z).toBeLessThan(L.bounds.maxZ);
  });
});
