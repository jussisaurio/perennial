import { describe, expect, test } from "bun:test";
import { gateHedge, hedgeClumps, hedgeCore, orchardHedge } from "./hedge";
import { rayBox } from "./scenery";
import { collide, DOOR_HALF, layout, WALKER, type GardenPlant } from "./world";

const plant = (i: number): GardenPlant => ({ id: `w${i}`, lemma: `word${i}`, gloss: "", pos: ["noun", "verb", "adj"][i % 3], rank: i, s: 10, r: 0.95, stage: "bloom", growth: 0.5, listen: false, write: false, forms: [] });
const gardens = [layout([]), layout(Array.from({ length: 70 }, (_, i) => plant(i))), layout(Array.from({ length: 600 }, (_, i) => plant(i)))];
/** The door's top (scene.ts DOOR.h) and the eye's height (scene.ts EYE). */
const DOOR_TOP = 2.05;
const EYE = 1.05;

describe("the hedge round the orchard (#315)", () => {
  test("from anywhere in the garden at eye height, the hedge's solid middle hides the orchard (the door aside)", () => {
    for (const l of gardens) {
      const cores = gateHedge(l, DOOR_TOP).map(hedgeCore);
      const b = l.bounds;
      const o = l.orchard;
      const hedgeZ = cores[0].min[2];
      let rays = 0;
      for (let x = b.minX + 0.3; x < b.maxX; x += 1.3)
        for (let z = b.minZ + 0.3; z < b.maxZ - WALKER; z += 1.7) {
          // Only where a walker can stand.
          const at = collide(l, x, z);
          if (Math.hypot(at.x - x, at.z - z) > 1e-9) continue;
          for (let tx = o.x - o.w / 2; tx <= o.x + o.w / 2; tx += 1.5)
            for (let tz = o.z - o.d / 2 + 0.2; tz <= o.z + o.d / 2; tz += 2.8)
              for (const ty of [0.1, 1, 2]) {
                const len = Math.hypot(tx - x, ty - EYE, tz - z);
                const r = { ox: x, oy: EYE, oz: z, dx: (tx - x) / len, dy: (ty - EYE) / len, dz: (tz - z) / len };
                // Through the doorway the door itself is in the way.
                const k = (hedgeZ - z) / (tz - z);
                if (Math.abs(x + (tx - x) * k - l.gate.x) < DOOR_HALF + 0.06 && EYE + (ty - EYE) * k < DOOR_TOP) continue;
                rays++;
                expect(Math.min(...cores.map((c) => rayBox(r, c.min, c.max)))).toBeLessThan(len);
              }
        }
      expect(rays).toBeGreaterThan(1000);
    }
  });

  test("its clumps of leaves stay out of the path, the doorway and the orchard's ground", () => {
    for (const l of gardens) {
      const gx = l.gate.x;
      gateHedge(l, DOOR_TOP).forEach((w, i) => {
        for (const c of hedgeClumps(w, i)) {
          // Not out over the fence line, where the walker's eye comes.
          expect(c.at[2] - c.r[2]).toBeGreaterThan(l.bounds.maxZ);
          // Not into the doorway, under the door's top.
          if (c.at[1] - c.r[1] < DOOR_TOP) expect(Math.abs(c.at[0] - gx)).toBeGreaterThanOrEqual(DOOR_HALF + c.r[0] - 1e-9);
        }
      });
      const o = l.orchard;
      const [x0, x1, far] = [o.x - o.w / 2, o.x + o.w / 2, o.z + o.d / 2];
      // At most a few centimetres into the orchard, past the left, right or far edge of its ground.
      for (const w of orchardHedge(l))
        for (const c of hedgeClumps(w, 0)) expect(c.at[0] + c.r[0] < x0 + 0.05 || c.at[0] - c.r[0] > x1 - 0.05 || c.at[2] - c.r[2] > far - 0.05 ? "clear" : c).toBe("clear");
    }
  });
});
