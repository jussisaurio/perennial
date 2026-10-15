import { describe, expect, test } from "bun:test";
import { collide, DOOR_HALF, groupOf, HEDGE, layout, viewpoint, type GardenPlant } from "./world";

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
    expect(o.w).toBeGreaterThanOrEqual(18);
    expect(o.d).toBeGreaterThanOrEqual(14.2);
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
  });
});
