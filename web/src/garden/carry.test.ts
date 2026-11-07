import { describe, expect, test } from "bun:test";
import { aheadOf, ANSWERS, FROG_PATIENCE, PEBBLES, pebbleHome, placeAt, reaction, restAt, stickHome, type Answerers } from "./carry";
import { collide, layout, WALKER, type GardenPlant } from "./world";

const plant = (i: number, pos = "noun"): GardenPlant => ({ id: `w${i}`, lemma: `word${i}`, gloss: "", pos, rank: i, planted: i, s: 10, r: 0.95, stage: "bloom", growth: 0.5, listen: false, write: false });
const gardens = [0, 3, 40, 300].map((n) => layout(Array.from({ length: n }, (_, i) => plant(i, i % 3 ? "noun" : "verb"))));

/** Where a thing came down, for the answers: the origin. */
const AT = { x: 0, z: 0 };

/** A scene stand-in that records who answered. */
function scene(here: { frogOnPad?: boolean; frog?: boolean; plant?: boolean }) {
  const did: string[] = [];
  const who: Answerers = {
    frogHop: () => (here.frogOnPad ? (did.push("hop"), true) : false),
    say: (id, text) => (here[id] ? (did.push(`${id}:${text}`), true) : false),
    perk: () => (here.plant ? (did.push("perk"), true) : false),
    echo: (n) => void did.push(`echo:${n}`),
  };
  return { who, did };
}

describe("where a thing lands", () => {
  const L = gardens[1];
  test("in the pond, in a bed, or on the ground", () => {
    expect(placeAt(L, L.pond.x + 0.4, L.pond.z)).toBe("pond");
    const bed = L.beds[0];
    expect(placeAt(L, bed.x, bed.z)).toBe("bed");
    expect(placeAt(L, L.gate.x, L.gate.z - 1)).toBe("ground");
  });

  test("the action button puts a thing down just ahead, where you face", () => {
    // Forward is -z at yaw 0.
    const ahead = aheadOf(1, 1, 0);
    expect(ahead.x).toBeCloseTo(1);
    expect(ahead.z).toBeCloseTo(0.3);
    const left = aheadOf(0, 0, Math.PI / 2);
    expect(left.x).toBeCloseTo(-0.7);
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

  test("the frog hops away from the first few pebbles, then only looks at you", () => {
    const { who, did } = scene({ frogOnPad: true, frog: true });
    const said = Array.from({ length: FROG_PATIENCE + 2 }, (_, n) => ANSWERS.frog(who, AT, n));
    expect(said.slice(0, FROG_PATIENCE)).toEqual(Array(FROG_PATIENCE).fill("The frog hops to another pad."));
    expect(said.slice(FROG_PATIENCE)).toEqual(["The frog looks at you.", "The frog looks at you."]);
    expect(did).toEqual([...Array(FROG_PATIENCE).fill("hop"), "frog:…", "frog:…"]);
  });

  test("no frog on a pad, no plant near: nobody answers, and nothing is said for them", () => {
    const { who, did } = scene({});
    expect(ANSWERS.frog(who, AT, 0)).toBeNull();
    expect(ANSWERS.frog(who, AT, FROG_PATIENCE)).toBeNull();
    expect(ANSWERS.plant(who, AT, 0)).toBeNull();
    expect(did).toEqual([]);
  });
});

test("in every size of garden, the pebbles and the stick lie on open ground a walker can reach", () => {
  for (const L of gardens) {
    const spots = [...Array.from({ length: PEBBLES }, (_, i) => pebbleHome(L, i)), stickHome(L)];
    for (const p of spots) {
      expect(placeAt(L, p.x, p.z)).not.toBe("pond");
      expect(placeAt(L, p.x, p.z)).not.toBe("bed");
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
    expect(placeAt(L, w.x + 0.2, w.z)).toBe("well");
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
