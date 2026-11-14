import { expect, test } from "bun:test";
import { cuts, reachOf, type Rest } from "./wholeCutout";
import type { HitBox } from "../garden/scenery";

// The check of render.whole-cutout (docs/invariants.md) finds a solid thing inside the circle a cut-out sweeps as it turns.

const box = (id: HitBox["id"], min: [number, number, number], max: [number, number, number], turn?: number): HitBox => ({ id, min, max, tag: null, ...(turn !== undefined && { turn }) });
const rest = (at: [number, number, number], reach: number, tall = 0.3): Rest => ({ who: "it", at, reach, tall });
const cutBy = (b: HitBox, at: [number, number, number], reach: number, tall?: number) => cuts([b], [rest(at, reach, tall)]).length > 0;
// A bench's back: 1.36 m along x, behind z = -0.15, up to 0.8 m; its seat up to 0.45 m.
const back = box("bench", [-0.68, 0, -0.25], [0.68, 0.8, -0.15]);
const seat = box("bench", [-0.68, 0, -0.25], [0.68, 0.45, 0.22]);

test("render.whole-cutout: a cut-out on the seat that would swing into the back is found; a narrower one is not", () => {
  expect(cuts([back], [rest([0.18, 0.45, 0.02], 0.356)])).toEqual([{ who: "it", by: "bench" }]);
  expect(cutBy(back, [0.18, 0.45, 0.02], 0.16)).toBe(false);
});

test("render.whole-cutout: what it stands on, or a thing over its head, does not cut it", () => {
  expect(cutBy(seat, [0.18, 0.45, 0.02], 0.356)).toBe(false);
  // A bird on the top of the back.
  expect(cutBy(back, [0.6, 0.8, -0.2], 0.2)).toBe(false);
  // A board that starts at its head's height does not cut it; one that starts lower does.
  expect(cutBy(box("sign", [0, 0.4, -0.1], [1, 1.2, 0.1]), [0.5, 0, 0.15], 0.3, 0.4)).toBe(false);
  expect(cutBy(box("sign", [0, 0.3, -0.1], [1, 1.2, 0.1]), [0.5, 0, 0.15], 0.3, 0.4)).toBe(true);
});

test("render.whole-cutout: only things solid all through cut it, not plants or the ground", () => {
  expect(cuts([box("bush", [-0.3, 0, -0.3], [0.3, 0.6, 0.3]), box("path", [-2, 0, -2], [2, 0.02, 2])], [rest([0, 0, 0.35], 0.2)])).toEqual([]);
});

test("render.whole-cutout: a turned box cuts it on each side and past each end, measured in the box's own frame", () => {
  // A wall 2 m long and 0.1 m thick round (3, 1), turned a quarter: it runs along z from 0 to 2, at x = 3.
  const wall = box("fence", [2, 0, 0.95], [4, 0.8, 1.05], Math.PI / 2);
  // 15 cm from it on each side, and 15 cm past each end.
  for (const at of [[3.2, 0, 1.5], [2.8, 0, 0.5], [3, 0, 2.15], [3, 0, -0.15]] as const) expect(cutBy(wall, [...at], 0.2), `at ${at}`).toBe(true);
  // 30 cm away.
  for (const at of [[3.35, 0, 1.5], [2.65, 0, 0.5], [3, 0, 2.3], [3, 0, -0.3]] as const) expect(cutBy(wall, [...at], 0.2), `at ${at}`).toBe(false);
});

test("render.whole-cutout: a visitor reaches as far as its widest frame, from the cell's middle, at its size", () => {
  // 24 of 32 units wide: 4 units each side, 12 from the middle. 15 wide: 8 to the left, 7 to the right.
  const a = { w: 24, h: 12, pieces: [] };
  const b = { w: 15, h: 20, pieces: [] };
  expect(reachOf([a, b], 0.5)).toEqual({ reach: (12 / 32) * 0.5, tall: (20 / 32) * 0.5 });
  expect(reachOf([b], 1)).toEqual({ reach: 8 / 32, tall: 20 / 32 });
});
