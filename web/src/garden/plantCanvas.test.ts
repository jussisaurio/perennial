import { expect, test } from "bun:test";
import { halve } from "./plantCanvas";

test("halve averages each 2 × 2 square, and keeps two cells side by side apart", () => {
  // Two 2 × 2 cells: one red petal pixel at the left one's edge, the right one solid blue.
  const red = [200, 0, 0, 255];
  const empty = [0, 0, 0, 0];
  const blue = [0, 0, 180, 255];
  const d = new Uint8Array([...red, ...empty, ...blue, ...blue, ...empty, ...empty, ...blue, ...blue]);
  // Premultiplied: a quarter-covered pixel keeps the petal's red, only fainter (#1091).
  expect([...halve(d, 4, 2)]).toEqual([50, 0, 0, 64, 0, 0, 180, 255]);
});

test("halve rounds to the nearest value", () => {
  expect([...halve(new Uint8Array([2, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 2, 2)]).toEqual([1, 0, 0, 1]);
});
