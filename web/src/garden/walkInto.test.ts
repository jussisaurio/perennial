import { describe, expect, test } from "bun:test";
import { isAutumn } from "../core/day";
import type { PlacedTree } from "./orchard";
import type { Frame } from "./scenePart";
import { brush, BRUSH, brushStep, bumpStep, fellFrom, fellLine, fruitDrop, leafPiles, PILES, rollStep, type Rolling } from "./walkInto";
import { benchAt, collide, KEY_SPOTS, keyAt, lanternSpots, layout, sunflowerAt, WALKER, type GardenPlant, type Layout } from "./world";

const plant = (i: number): GardenPlant => ({ id: `w${i}`, lemma: `word${i}`, gloss: "", pos: "noun", rank: i, s: 10, r: 0.95, stage: "bloom", growth: 0.5, listen: false, write: false });

const DT = 1 / 60;
const frame = (x: number, z: number, elapsed: number, speed: number, yaw = 0): Frame => ({ dt: DT, elapsed, x, z, yaw, speed });

/** Walk along the front of the first bed, hugging it, left to right (yaw: facing +x); not `onFoot`: gliding. Returns each frame's note (or -1). */
function walkAlong(l: Layout, b = brush(l), speed = 3.6, from = 0, onFoot = true): number[] {
  const bed = l.beds[0];
  const z = bed.z + bed.d / 2 + WALKER;
  const x0 = bed.x - bed.w / 2 - 1.5;
  const notes: number[] = [];
  const frames = Math.round((bed.w + 3) / (speed * DT));
  for (let k = 0; k < frames; k++) notes.push(brushStep(b, l, frame(x0 + k * speed * DT, z, from + k * DT, onFoot ? speed : 0, -Math.PI / 2)));
  return notes;
}

describe("brushing the beds (#359)", () => {
  const l = layout(Array.from({ length: 30 }, (_, i) => plant(i)));
  // The edge row on the gate side: 0.63 m in from the edge, give or take its jitter.
  const front = l.plants.filter((p) => p.z > l.beds[0].z + l.beds[0].d / 2 - 0.9);

  test("hugging a bed brushes its edge row, each plant once, and plays their notes in turn", () => {
    const b = brush(l);
    const notes = walkAlong(l, b).filter((n) => n >= 0);
    expect(new Set(notes).size).toBe(notes.length);
    expect(new Set(notes)).toEqual(new Set(front.map((p) => l.plants.indexOf(p))));
    // Left to right: a run of notes along the row.
    const xs = notes.map((i) => l.plants[i].x);
    expect(xs).toEqual([...xs].sort((a, c) => a - c));
  });

  test("a brushed plant leans away from you, then springs back still", () => {
    const b = brush(l);
    const bed = l.beds[0];
    const p = front[0];
    const i = l.plants.indexOf(p);
    // Facing the bed (yaw 0 faces -z), from a little to the plant's left: it is on your right, so it leans right (a negative angle).
    const z = bed.z + bed.d / 2 + WALKER;
    brushStep(b, l, frame(p.x - 2, z, 0, 0));
    brushStep(b, l, frame(p.x - 0.4, z, DT, 3.6));
    brushStep(b, l, frame(p.x - 0.4, z, 2 * DT, 0));
    expect(b.lean[i]).toBeLessThan(0);
    for (let k = 0; k < 300; k++) brushStep(b, l, frame(p.x - 0.4, z, (3 + k) * DT, 0));
    expect(b.lean[i]).toBe(0);
    expect(b.moving).toBe(0);
  });

  test("the middle of the path, a glide or standing still brushes nothing", () => {
    const bed = l.beds[0];
    const b = brush(l);
    // Mid-path in front of the first bed: the path is 1.9 m wide.
    for (let k = 0; k < 200; k++) expect(brushStep(b, l, frame(bed.x - 2 + k * 0.02, bed.z + bed.d / 2 + 0.95, k * DT, 3.6))).toBe(-1);
    expect(b.moving).toBe(0);
    const glide = brush(l);
    expect(walkAlong(l, glide, 3.6, 0, false).every((n) => n === -1) && glide.moving === 0).toBe(true);
  });

  test("a run plays a quick run of notes, never two within the gap", () => {
    const b = brush(l);
    const notes = walkAlong(l, b, 7.2);
    const at = notes.flatMap((n, k) => (n >= 0 ? [k * DT] : []));
    expect(at.length).toBeGreaterThan(3);
    for (let k = 1; k < at.length; k++) expect(at[k] - at[k - 1]).toBeGreaterThanOrEqual(BRUSH.gap - 1e-9);
  });

  test("leaving and coming back brushes the row again", () => {
    const b = brush(l);
    const first = walkAlong(l, b).filter((n) => n >= 0).length;
    const again = walkAlong(l, b, 3.6, 10).filter((n) => n >= 0).length;
    expect(again).toBe(first);
  });
});

const tree = (look: PlacedTree["look"], kind: PlacedTree["kind"] = "apple"): PlacedTree => ({ id: "t", lemma: "manzana", gloss: "apple", kind, planted: 0, height: 3, look, x: 0, z: 0, scale: 1, half: 1, trunk: 0.1, phase: 0 });

describe("bumping a tree (#359)", () => {
  test("walking into the trunk shakes it once, until you step away", () => {
    const t = tree("fruit");
    const armed = new Uint8Array([1]);
    // Held off the trunk by collideTrees: just touching.
    const touch = t.trunk + WALKER;
    expect(bumpStep([t], armed, touch + 0.3, 0, 3)).toBe(-1);
    expect(bumpStep([t], armed, touch, 0, 3)).toBe(0);
    expect(bumpStep([t], armed, touch, 0, 3)).toBe(-1);
    expect(bumpStep([t], armed, touch + 1, 0, 3)).toBe(-1);
    expect(bumpStep([t], armed, touch, 0, 3)).toBe(0);
  });

  test("standing by a trunk, or gliding past, shakes nothing", () => {
    const t = tree("fruit");
    expect(bumpStep([t], new Uint8Array([1]), t.trunk + WALKER, 0, 0)).toBe(-1);
  });

  test("a fruit tree drops a fruit; in blossom, petals; in leaf, or the plain tree with its nest, leaves", () => {
    expect(fellFrom(tree("fruit"))).toBe("fruit");
    expect(fellFrom(tree("blossom"))).toBe("petals");
    expect(fellFrom(tree("leaves"))).toBe("leaves");
    expect(fellFrom(tree("fruit", "tree"))).toBe("leaves");
  });

  test("screen readers hear what fell, with a or an", () => {
    expect(fellLine("apple")).toBe("An apple fell.");
    expect(fellLine("olive")).toBe("An olive fell.");
    expect(fellLine("pear")).toBe("A pear fell.");
  });
});

describe("a fallen fruit (#359)", () => {
  const fresh = (): Rolling => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, still: true });

  test("falls from the crown beside the trunk, on its far side from you, bounces lower each time, then rolls to a stop", () => {
    const t = tree("fruit");
    // You stand at +x, against the trunk.
    const walker = { x: t.trunk + WALKER, z: 0 };
    const sides = ([1, -1] as const).map((side) => {
      const f = fresh();
      fruitDrop(t, walker.x, walker.z, side, true, f);
      expect(f.y).toBeGreaterThan(1);
      const apexes: number[] = [];
      for (let k = 0; k < 600 && !f.still; k++) {
        const up = f.vy > 0;
        rollStep(f, DT);
        if (up && f.vy <= 0 && f.y > 0) apexes.push(f.y);
      }
      expect(f.still).toBe(true);
      expect(f.y).toBe(0);
      // The first apex is the drop's own small hop; the bounces after it get lower.
      const bounces = apexes.slice(1);
      expect(bounces.length).toBeGreaterThan(0);
      for (let i = 1; i < bounces.length; i++) expect(bounces[i]).toBeLessThan(bounces[i - 1]);
      // Past the trunk from you, clear of it, and not far.
      expect(f.x).toBeLessThan(-t.trunk);
      expect(Math.hypot(f.x, f.z)).toBeLessThan(2);
      return f.z;
    });
    // One to the left of the trunk, the other to the right: beside it, where you can see it.
    expect(sides[0] * sides[1]).toBeLessThan(0);
    expect(Math.min(Math.abs(sides[0]), Math.abs(sides[1]))).toBeGreaterThan(0.2);
  });

  test("with reduced motion it lies there at once", () => {
    const t = tree("fruit");
    const f = fresh();
    fruitDrop(t, 0, 2, 1, false, f);
    expect(f).toMatchObject({ y: 0, still: true });
    expect(f.z).toBeLessThan(-t.trunk);
    rollStep(f, DT);
    expect(f.y).toBe(0);
  });
});

describe("leaf piles (#359)", () => {
  test("only in autumn, September to November", () => {
    expect([7, 8, 9, 10, 11].map((m) => isAutumn(new Date(2026, m, 15)))).toEqual([false, true, true, true, false]);
  });

  test("a few, on the paths, the same every visit, and clear of everything else that lies there", () => {
    for (const n of [1, 12, 30, 90, 400]) {
      const l = layout(Array.from({ length: n }, (_, i) => plant(i)));
      const piles = leafPiles(l);
      expect(piles.length).toBeGreaterThan(0);
      expect(piles.length).toBeLessThanOrEqual(PILES.count);
      expect(leafPiles(l)).toEqual(piles);
      const keep = [...lanternSpots(l).map(([x, z]) => ({ x, z })), sunflowerAt(l), benchAt(l), ...KEY_SPOTS.map((s) => keyAt(l, s))];
      for (const p of piles) {
        // Somewhere a walker can stand: on a path, not in a bed or the pond.
        expect(collide(l, p.x, p.z)).toEqual(p);
        for (const k of keep) expect(Math.hypot(k.x - p.x, k.z - p.z)).toBeGreaterThanOrEqual(PILES.clear);
      }
    }
  });
});
