import { describe, expect, test } from "bun:test";
import { collide, groupOf, layout, viewpoint, type GardenPlant } from "./world";

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
});
