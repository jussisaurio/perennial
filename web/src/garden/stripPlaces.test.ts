import { describe, expect, test } from "bun:test";
import { hash01, rng } from "../lib/seed";
import { stripPlaces } from "./stripPlaces";
import type { GardenPlant } from "./plants";

// Only the id places a plant.
const plants = Array.from({ length: 900 }, (_, i) => ({ id: `w${i * 7}` }) as GardenPlant);

describe("the strip places plants on first use (#569)", () => {
  test("the plants in a window are the ones a full layout puts there", () => {
    for (const [spacing, offset] of [
      [22, 18],
      [22, 110],
      [13.7, 41.3],
    ]) {
      const scale = Math.max(0.42, Math.min(1.05, spacing / 20));
      const full = plants.map((p, i) => ({ p, x: offset + spacing * (i + 0.5) + (hash01(p.id, 17) - 0.5) * spacing * 0.8, y: 176 + hash01(p.id, 19) * 4, scale }));
      const places = stripPlaces(plants, spacing, offset, 176);
      const r = rng(spacing * 1000);
      for (let k = 0; k < 300; k++) {
        const lo = r() * spacing * 950 - spacing * 20;
        const hi = lo + r() * 1600;
        expect(places.between(lo, hi)).toEqual(full.filter((l) => l.x > lo && l.x < hi));
      }
      expect(plants.map((_, i) => places.at(i))).toEqual(full);
    }
  });
});
