import { expect, test } from "bun:test";
import { halve, premultiply } from "./plantCanvas";

test("premultiply scales each colour by its pixel's alpha", () => {
  const d = new Uint8ClampedArray([10, 20, 30, 255, 200, 100, 50, 128, 90, 90, 90, 0]);
  premultiply(d);
  expect([...d]).toEqual([10, 20, 30, 255, 100, 50, 25, 128, 0, 0, 0, 0]);
});

test("halve averages each 2 × 2 square, and keeps two cells side by side apart", () => {
  // Two 2 × 2 cells: one red petal pixel at the left one's edge, the right one solid blue.
  const red = [200, 0, 0, 255];
  const empty = [0, 0, 0, 0];
  const blue = [0, 0, 180, 255];
  const d = new Uint8Array([...red, ...empty, ...blue, ...blue, ...empty, ...empty, ...blue, ...blue]);
  // Premultiplied: a quarter-covered pixel keeps the petal's red, only fainter (#1091).
  expect([...halve(d, 4, 2)]).toEqual([50, 0, 0, 64, 0, 0, 180, 255]);
});

test("halve keeps each row of squares in its own row", () => {
  // 4 × 4, each pixel's red 10 per column and 40 per row: the four squares' means are 25, 45, 105 and 125.
  const d = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) d.set([x * 10 + y * 40, 0, 0, 255], (y * 4 + x) * 4);
  expect([...halve(d, 4, 4)]).toEqual([25, 0, 0, 255, 45, 0, 0, 255, 105, 0, 0, 255, 125, 0, 0, 255]);
});

test("halve rounds to the nearest value", () => {
  expect([...halve(new Uint8Array([2, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 2, 2)]).toEqual([1, 0, 0, 1]);
});
