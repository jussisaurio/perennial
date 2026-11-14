import { describe, expect, test } from "bun:test";
import { gateHedge, hedgeCore, hedgeSheets, LEAF_H, orchardHedge, SHEET_H, type Sheet } from "./hedge";
import { MouseMat } from "./mouseDoor";
import { rayBox } from "./scenery";
import { collide, DOOR_HALF, layout, WALKER, type GardenPlant } from "./world";

const plant = (i: number): GardenPlant => ({ id: `w${i}`, lemma: `word${i}`, gloss: "", pos: ["noun", "verb", "adj"][i % 3], rank: i, planted: i, s: 10, r: 0.95, stage: "bloom", growth: 0.5, listen: false, write: false, forms: [] });
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

  test("its sheets of leaves stay out of the path, the doorway and the orchard's ground", () => {
    for (const l of gardens) {
      const gx = l.gate.x;
      gateHedge(l, DOOR_TOP).forEach((w, i) => {
        for (const { corners } of hedgeSheets(w, i)) {
          // Not out over the fence line, where the walker's eye comes.
          for (const c of corners) expect(c[2]).toBeGreaterThan(l.bounds.maxZ);
          // Not into the doorway, under the door's top: all to one side of it, or all above it.
          const xs = corners.map((c) => c[0]);
          const clear = Math.max(...xs) <= gx - DOOR_HALF + 1e-9 || Math.min(...xs) >= gx + DOOR_HALF - 1e-9 || corners.every((c) => c[1] >= DOOR_TOP - 1e-9);
          expect(clear ? "clear" : corners).toBe("clear");
        }
      });
      const o = l.orchard;
      const [x0, x1, far] = [o.x - o.w / 2, o.x + o.w / 2, o.z + o.d / 2];
      // At most a few centimetres into the orchard, past the left, right or far edge of its ground.
      for (const w of orchardHedge(l))
        for (const { corners } of hedgeSheets(w, 0))
          for (const c of corners) expect(c[0] < x0 + 0.05 || c[0] > x1 - 0.05 || c[2] > far - 0.05 ? "clear" : c).toBe("clear");
    }
  });

  test("the mouse door (#364) stands in front of the hedge's leaves, not hidden behind them", () => {
    for (const l of gardens) {
      const door = new MouseMat(l, null);
      gateHedge(l, DOOR_TOP).forEach((w, i) => {
        for (const { corners } of hedgeSheets(w, i)) for (const c of corners) expect(c[2]).toBeGreaterThanOrEqual(door.z0 - 1e-9);
      });
    }
  });

  test("its rows of leaves leave no gap down to the solid middle, and none cuts through the row below it", () => {
    const l = layout([]);
    for (const w of [...gateHedge(l, DOOR_TOP), ...orchardHedge(l)]) {
      // A face's rows, bottom up: the sheets that face the same way and lean back.
      const faces = new Map<string, Sheet[]>();
      for (const sheet of hedgeSheets(w, 0)) {
        const [bl, br, , tl] = sheet.corners;
        // Upright sheets only: the crests along the top stand straight.
        if (Math.abs(tl[0] - bl[0]) + Math.abs(tl[2] - bl[2]) < 1e-9) continue;
        const key = `${Math.sign(Math.round((br[0] - bl[0]) * 1e6))},${Math.sign(Math.round((br[2] - bl[2]) * 1e6))}`;
        faces.set(key, [...(faces.get(key) ?? []), sheet]);
      }
      expect(faces.size).toBe(w.faces.length + w.ends.length);
      for (const rows of faces.values()) {
        rows.sort((a, b) => a.corners[0][1] - b.corners[0][1]);
        rows.slice(1).forEach((upper, k) => {
          const lower = rows[k];
          const [ul, ll] = [upper.corners[0], lower.corners[0]];
          // The upper row starts below the top of the lower row's solid part.
          expect(ul[1]).toBeLessThan(ll[1] + SHEET_H - LEAF_H);
          // Where they overlap, the upper row is further from the outside: how far out a sheet is at height y, along its outward lean.
          const outAt = (s: Sheet, y: number) => {
            const [b, , , t] = s.corners;
            const f = (y - b[1]) / SHEET_H;
            return [b[0] + (t[0] - b[0]) * f, b[2] + (t[2] - b[2]) * f];
          };
          const lean = [lower.corners[0][0] - lower.corners[3][0], lower.corners[0][2] - lower.corners[3][2]];
          for (const y of [ul[1], ll[1] + SHEET_H]) {
            const [a, b] = [outAt(upper, y), outAt(lower, y)];
            expect((b[0] - a[0]) * lean[0] + (b[1] - a[1]) * lean[1]).toBeGreaterThan(0);
          }
        });
      }
    }
  });
});
