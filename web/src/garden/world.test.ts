import { describe, expect, test } from "bun:test";
import { ORCHARD_WORDS } from "../deck/schema";
import { rng } from "../lib/seed";
import { collideTrees, orchardTrees, placeTrees, type PlacedTree } from "./orchard";
import { along, collide, DOOR_HALF, groupOf, HEDGE, KEY_SPOTS, keyAt, keyHelp, keySpot, layout, route, TRIP_STUCK, viewpoint, walk, walkStep, wayTo, WALKER, type GardenPlant, type Layout } from "./world";

const plant = (i: number, pos = "noun"): GardenPlant => ({
  id: `w${i}`,
  lemma: `word${i}`,
  gloss: "",
  pos,
  rank: i,
  s: 10,
  r: 0.95,
  stage: "bloom",
  growth: 0.5,
  listen: false,
  write: false,
});

describe("garden layout", () => {
  test("groups words by kind, one row of beds per kind", () => {
    expect(groupOf("Noun")).toBe("Nouns");
    expect(groupOf("prep")).toBe("Small words");
    expect(groupOf("")).toBe("Other words");
    expect(groupOf("Adjective")).toBe("Adjectives"); // an AI-written word of your own may spell it out
    expect(groupOf("interj")).toBe("Other words");
    const l = layout([plant(1), plant(2, "verb"), plant(3, "adj")]);
    expect(l.beds.map((b) => b.label)).toEqual(["Nouns", "Verbs", "Adjectives"]);
    expect(new Set(l.beds.map((b) => b.z)).size).toBe(3);
  });

  test("big groups get more beds; common words are nearest the gate", () => {
    const l = layout(Array.from({ length: 70 }, (_, i) => plant(i)));
    expect(l.beds.map((b) => b.label)).toEqual(["Nouns", "Nouns · 2", "Nouns · 3"]);
    const first = l.plants.find((p) => p.rank === 0)!;
    const last = l.plants.find((p) => p.rank === 29)!;
    expect(first.bed).toBe(0);
    expect(first.z).toBeGreaterThan(last.z);
  });

  test("every plant sits inside its bed, and the layout is stable", () => {
    const ps = Array.from({ length: 200 }, (_, i) => plant(i, ["noun", "verb", "adj", ""][i % 4]));
    const a = layout(ps);
    for (const p of a.plants) {
      const b = a.beds[p.bed];
      expect(Math.abs(p.x - b.x)).toBeLessThan(b.w / 2);
      expect(Math.abs(p.z - b.z)).toBeLessThan(b.d / 2);
    }
    expect(layout(ps).plants).toEqual(a.plants);
  });

  test("an empty garden still has a bed to look at", () => {
    const l = layout([]);
    expect(l.beds).toHaveLength(1);
    expect(l.plants).toHaveLength(0);
  });

  test("walkers stay out of beds, out of the pond and inside the fence", () => {
    const l = layout([plant(1)]);
    const bed = l.beds[0];
    const out = collide(l, bed.x, bed.z + bed.d / 2 - 0.1);
    expect(out.z).toBeGreaterThanOrEqual(bed.z + bed.d / 2);
    const p = collide(l, l.pond.x, l.pond.z + 0.1);
    expect(Math.hypot(p.x - l.pond.x, p.z - l.pond.z)).toBeGreaterThan(l.pond.r);
    expect(collide(l, 1e6, 0).x).toBeLessThan(l.bounds.maxX);
    const v = viewpoint(l, l.plants[0]);
    expect(collide(l, v.x, v.z)).toEqual({ x: v.x, z: v.z });
  });

  test("the door in the hedge (#315): shut, it stops walkers; open, they walk through it into the orchard, and only through it", () => {
    const l = layout([plant(1)]);
    const b = l.bounds;
    const o = l.orchard;
    // The orchard is behind the hedge, the door in the middle of its near side; its size is fixed, whatever the garden's.
    expect(o.z - o.d / 2).toBeGreaterThanOrEqual(b.maxZ + HEDGE.gap + HEDGE.depth);
    expect(o.x).toBe(l.gate.x);
    const big = layout(Array.from({ length: 400 }, (_, i) => plant(i))).orchard;
    expect([big.w, big.d]).toEqual([o.w, o.d]);
    const inOrchard = { x: o.x + 1, z: o.z };
    expect(collide(l, l.gate.x, b.maxZ + 0.5).z).toBeLessThan(b.maxZ);
    expect(collide(l, inOrchard.x, inOrchard.z).z).toBeLessThan(b.maxZ);
    // Open: the doorway and the orchard are walkable.
    expect(collide(l, l.gate.x, b.maxZ + 0.5, 0.28, true)).toEqual({ x: l.gate.x, z: b.maxZ + 0.5 });
    expect(collide(l, inOrchard.x, inOrchard.z, 0.28, true)).toEqual(inOrchard);
    // Beside the door is still hedge, and the orchard has its own edges.
    expect(collide(l, l.gate.x + 2, b.maxZ + 0.3, 0.28, true).z).toBeLessThan(b.maxZ);
    expect(Math.abs(collide(l, l.gate.x + DOOR_HALF + 0.1, b.maxZ + 0.6, 0.28, true).x - l.gate.x)).toBeLessThan(DOOR_HALF);
    expect(collide(l, o.x + o.w, o.z, 0.28, true).x).toBeLessThan(o.x + o.w / 2);
    // A long step (a ctrl+wheel notch is 2 m) beside the door stops at the hedge; through the door it goes in.
    const edge = b.maxZ - 0.3;
    expect(walk(l, l.gate.x + 2, edge, l.gate.x + 2, edge + 2, true, []).z).toBeLessThan(b.maxZ);
    expect(walk(l, l.gate.x, edge, l.gate.x, edge + 2, true, []).z).toBeCloseTo(edge + 2);
  });

  test("a glide from the orchard to a plant goes out through the door, never through the hedge (#315)", () => {
    const l = layout(Array.from({ length: 40 }, (_, i) => plant(i)));
    const o = l.orchard;
    const to = viewpoint(l, l.plants[0]);
    // From a corner of the orchard, from beside the door inside it, and from the doorway itself.
    for (const [x, z] of [[o.x + o.w / 2 - 1, o.z + o.d / 2 - 1], [o.x - 3, o.z - o.d / 2 + 0.3], [l.gate.x, l.bounds.maxZ + 0.5]]) {
      const path = route(l, x, z, to.x, to.z);
      expect(along(path, 0)).toEqual({ x, z });
      expect(along(path, 1)).toEqual({ x: to.x, z: to.z });
      // Every point on the way is somewhere a walker may stand with the door open (a glide passes over beds, as in the garden).
      for (let k = 0; k <= 1; k += 0.01) {
        const p = along(path, k);
        const ok = collide({ ...l, beds: [], pond: { ...l.pond, r: 0 } }, p.x, p.z, 0, true);
        expect(Math.hypot(ok.x - p.x, ok.z - p.z)).toBeLessThan(1e-9);
      }
    }
    // In the garden, straight there.
    expect(route(l, 1, l.bounds.maxZ - 1, to.x, to.z)).toEqual([[1, l.bounds.maxZ - 1], [to.x, to.z]]);
  });
});

describe("the way on foot to a tapped spot (#336)", () => {
  /** Follow a way as the scene does: a short step at a time toward each corner, through walk(). Returns where the walker ends up. */
  const follow = (l: Layout, way: [number, number][], doorOpen: boolean, trees: readonly PlacedTree[]) => {
    let [x, z] = way[0];
    for (const [cx, cz] of way.slice(1))
      for (let i = 0; i < 5000 && Math.hypot(cx - x, cz - z) > 1e-6; i++) {
        const k = Math.min(1, 0.06 / Math.hypot(cx - x, cz - z));
        ({ x, z } = walk(l, x, z, x + (cx - x) * k, z + (cz - z) * k, doorOpen, trees));
      }
    return { x, z };
  };
  const length = (way: [number, number][]) => way.slice(1).reduce((n, [x, z], i) => n + Math.hypot(x - way[i][0], z - way[i][1]), 0);

  test("a frame at a time, a walk arrives, stopping short where asked", () => {
    const l = layout(Array.from({ length: 30 }, (_, i) => plant(i)));
    const bed = l.beds[0];
    const front = bed.z + bed.d / 2 + 1;
    const trip = { way: wayTo(l, bed.x - 1, front, bed.x + 1.5, front, false, []), leg: 1, stop: 0.5, stuck: 0 };
    const at = { x: bed.x - 1, z: front };
    let now = "walking";
    for (let i = 0; i < 100 && now === "walking"; i++) now = walkStep(l, trip, at, 3.6 / 60, 1 / 60, false, []);
    expect(now).toBe("arrived");
    expect(at.x).toBeCloseTo(bed.x + 1, 2);
  });

  test("a walk held by something it did not plan round stalls, and says so (#336)", () => {
    const l = layout(Array.from({ length: 30 }, (_, i) => plant(i)));
    const bed = l.beds[0];
    // A way straight through a bed: walk() stops the walker at its edge.
    const trip = { way: [[bed.x, bed.z + bed.d / 2 + 1], [bed.x, bed.z - bed.d / 2 - 1]] as [number, number][], leg: 1, stop: 0, stuck: 0 };
    const at = { x: bed.x, z: bed.z + bed.d / 2 + 1 };
    const frames: string[] = [];
    for (let i = 0; i < 120; i++) frames.push(walkStep(l, trip, at, 3.6 / 60, 1 / 60, false, []));
    const stalled = frames.indexOf("stalled");
    expect(stalled).toBeGreaterThan(0);
    // Held for TRIP_STUCK seconds of frames at the bed's edge first, never through it.
    expect(frames.slice(0, stalled).every((f) => f === "walking")).toBe(true);
    expect(stalled / 60).toBeGreaterThan(TRIP_STUCK);
    expect(at.z).toBeGreaterThanOrEqual(bed.z + bed.d / 2);
  });

  test("straight there when nothing is in the way", () => {
    const l = layout(Array.from({ length: 30 }, (_, i) => plant(i)));
    const bed = l.beds[0];
    const front = bed.z + bed.d / 2 + 1;
    expect(wayTo(l, bed.x - 1, front, bed.x + 1.5, front, false, [])).toEqual([[bed.x - 1, front], [bed.x + 1.5, front]]);
  });

  test("round a bed, by its nearer side, and all the way there", () => {
    const l = layout(Array.from({ length: 70 }, (_, i) => plant(i, ["noun", "verb"][i % 2])));
    const bed = l.beds[0];
    // In front of the bed, a little right of its middle; the spot is right behind it.
    const [x, z] = [bed.x + 0.5, bed.z + bed.d / 2 + 0.6];
    const [tx, tz] = [bed.x + 0.5, bed.z - bed.d / 2 - 0.6];
    const way = wayTo(l, x, z, tx, tz, false, []);
    expect(way.length).toBeGreaterThan(2);
    // Round the right side: it is the shorter way.
    expect(way.slice(1, -1).every(([cx]) => cx > bed.x + bed.w / 2)).toBe(true);
    expect(length(way)).toBeLessThan(bed.d + bed.w + 2);
    const end = follow(l, way, false, []);
    expect(Math.hypot(end.x - tx, end.z - tz)).toBeLessThan(0.02);
  });

  test("round the pond", () => {
    const l = layout(Array.from({ length: 30 }, (_, i) => plant(i)));
    const p = l.pond;
    const way = wayTo(l, p.x + p.r + 0.5, p.z, p.x - p.r - 0.5, p.z, false, []);
    for (let k = 0; k <= 1; k += 0.01) {
      const q = along(way, k);
      expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeGreaterThan(p.r + WALKER - 0.02);
    }
    const end = follow(l, way, false, []);
    expect(Math.hypot(end.x - (p.x - p.r - 0.5), end.z - p.z)).toBeLessThan(0.02);
  });

  test("into the orchard through the open door, and round its trunks", () => {
    const l = layout(Array.from({ length: 30 }, (_, i) => plant(i)));
    const NOW = Date.UTC(2026, 9, 15, 12);
    const trees = placeTrees(l.orchard, orchardTrees(ORCHARD_WORDS.map((k) => ({ id: k, lemma: k, gloss: k, kind: k, planted: NOW - 3000 * 86_400_000, read: { s: 300, reps: 40, lapses: 0 } })), NOW));
    const t = trees[0];
    // From the far side of the garden to just behind a trunk, seen from the door.
    const behind = { x: t.x, z: t.z + t.trunk + 0.6 };
    const start = { x: l.bounds.minX + 1, z: l.bounds.maxZ - 1.5 };
    const way = wayTo(l, start.x, start.z, behind.x, behind.z, true, trees);
    const near = l.orchard.z - l.orchard.d / 2;
    // Through the doorway: wherever the way is between the garden and the orchard, it is in the door.
    for (let k = 0; k <= 1; k += 0.002) {
      const q = along(way, k);
      if (q.z > l.bounds.maxZ && q.z < near) expect(Math.abs(q.x - l.gate.x)).toBeLessThan(DOOR_HALF);
    }
    const end = follow(l, way, true, trees);
    expect(Math.hypot(end.x - behind.x, end.z - behind.z)).toBeLessThan(0.02);
  });

  test("from anywhere to anywhere a walker may stand, in small and big gardens, the way gets there", () => {
    const NOW = Date.UTC(2026, 9, 15, 12);
    for (const [count, doorOpen] of [[30, false], [200, true], [600, false]] as const) {
      const l = layout(Array.from({ length: count }, (_, i) => plant(i, ["noun", "verb", "adj", "adv", "phrase"][i % 5])));
      const trees = doorOpen ? placeTrees(l.orchard, orchardTrees(ORCHARD_WORDS.map((k) => ({ id: k, lemma: k, gloss: k, kind: k, planted: NOW - 3000 * 86_400_000, read: { s: 300, reps: 40, lapses: 0 } })), NOW)) : [];
      const rand = rng(count);
      const b = l.bounds;
      const o = l.orchard;
      // A spot a walker may stand on, picked at random: in the garden, or in the orchard behind an open door.
      const spot = () => {
        for (;;) {
          const inOrchard = doorOpen && rand() < 0.3;
          const x = inOrchard ? o.x - o.w / 2 + rand() * o.w : b.minX + rand() * (b.maxX - b.minX);
          const z = inOrchard ? o.z - o.d / 2 + rand() * o.d : b.minZ + rand() * (b.maxZ - b.minZ);
          const p = collide(l, x, z, WALKER, doorOpen);
          const q = collideTrees(trees, p.x, p.z, WALKER);
          if (Math.hypot(q.x - x, q.z - z) < 1e-9) return q;
        }
      };
      for (let i = 0; i < 40; i++) {
        const [from, to] = [spot(), spot()];
        const way = wayTo(l, from.x, from.z, to.x, to.z, doorOpen, trees);
        const end = follow(l, way, doorOpen, trees);
        expect(Math.hypot(end.x - to.x, end.z - to.z)).toBeLessThan(0.05);
      }
    }
  });
});

describe("the hidden key (#315)", () => {
  const gardens = [
    layout([]),
    layout([plant(1)]),
    layout(Array.from({ length: 70 }, (_, i) => plant(i, ["noun", "verb", "adj"][i % 3]))),
    layout(Array.from({ length: 600 }, (_, i) => plant(i, ["noun", "verb", "adj", "adv", "phrase"][i % 5]))),
  ];

  test("it hides away from the door, wherever its spot", () => {
    for (const l of gardens)
      for (const spot of KEY_SPOTS) {
        const k = keyAt(l, spot);
        expect(Math.hypot(k.x - l.gate.x, k.z - l.bounds.maxZ)).toBeGreaterThan(4);
      }
  });

  test("a key left waiting gets help from the world, late: visitors from the third day, a glint from the seventh (#334)", () => {
    // Late evening when the key came, early morning now: calendar days, not 24-hour spans.
    const since = new Date(2026, 9, 1, 23, 30).getTime();
    const on = (day: number, hour: number) => keyHelp(since, new Date(2026, 9, day, hour).getTime());
    expect(on(1, 23)).toEqual({ visitors: false, glint: false });
    expect(on(3, 23)).toEqual({ visitors: false, glint: false });
    expect(on(4, 1)).toEqual({ visitors: true, glint: false });
    expect(on(7, 23)).toEqual({ visitors: true, glint: false });
    expect(on(8, 0)).toEqual({ visitors: true, glint: true });
    expect(on(40, 12)).toEqual({ visitors: true, glint: true });
  });

  test("a learner always gets the same spot, and learners get different ones", () => {
    expect(keySpot("user-1:es")).toBe(keySpot("user-1:es"));
    const seen = new Set(Array.from({ length: 200 }, (_, i) => keySpot(`user-${i}:es`)));
    expect([...seen].sort()).toEqual([...KEY_SPOTS].sort());
  });

  test("every spot can be walked to from where the walk starts, close enough to pick the key up", () => {
    for (const l of gardens) {
      // Walkable points on a 0.25 m grid, joined where a walker steps straight from one to the next.
      const g = 0.25;
      const at = (x: number, z: number) => `${Math.round(x / g)},${Math.round(z / g)}`;
      const start = { x: l.gate.x, z: l.gate.z - 1.2 };
      const seen = new Set([at(start.x, start.z)]);
      const reached: { x: number; z: number }[] = [];
      const todo = [start];
      while (todo.length) {
        const p = todo.pop()!;
        reached.push(p);
        for (const [dx, dz] of [[g, 0], [-g, 0], [0, g], [0, -g]]) {
          const to = walk(l, p.x, p.z, p.x + dx, p.z + dz, false, []);
          if (Math.hypot(to.x - p.x - dx, to.z - p.z - dz) > 1e-9 || seen.has(at(to.x, to.z))) continue;
          seen.add(at(to.x, to.z));
          todo.push(to);
        }
      }
      for (const spot of KEY_SPOTS) {
        const k = keyAt(l, spot);
        expect(Math.min(...reached.map((p) => Math.hypot(p.x - k.x, p.z - k.z)))).toBeLessThan(1);
        // On the ground where it can be seen: not in a bed or the pond, and inside the fence.
        expect(l.beds.some((b) => Math.abs(k.x - b.x) < b.w / 2 && Math.abs(k.z - b.z) < b.d / 2)).toBe(false);
        expect(Math.hypot(k.x - l.pond.x, k.z - l.pond.z)).toBeGreaterThan(l.pond.r);
        expect(k.x > l.bounds.minX && k.x < l.bounds.maxX && k.z > l.bounds.minZ && k.z < l.bounds.maxZ).toBe(true);
      }
    }
  });
});
