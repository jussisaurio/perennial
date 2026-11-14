import { expect, test } from "bun:test";
import { openSpots } from "./drawnSolid";
import type { HitBox } from "../garden/scenery";

// The check of garden.drawn-solid (docs/invariants.md) finds a thing drawn as solid that does not stop a walker.

/** A walker stands anywhere but inside these rectangles [x0, x1, z0, z1], which push it out to x0. */
const ground =
  (...solid: [number, number, number, number][]) =>
  (x: number, z: number) =>
    solid.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1) ? { x: solid[0][0] - 1, z } : { x, z };
const flat = () => 0;
const EYE = 1;
const box = (id: HitBox["id"], min: [number, number, number], max: [number, number, number], turn?: number): HitBox => ({ id, min, max, tag: null, ...(turn !== undefined && { turn }) });

test("a bed with nothing to stop you is found; one inside a solid footprint is not", () => {
  const bed = box("bed", [0, 0, 0], [2, 0.3, 1]);
  expect(openSpots([bed], [], ground(), flat, EYE).map((s) => s.id)).toContain("bed");
  expect(openSpots([bed], [], ground([0, 2, 0, 1]), flat, EYE)).toEqual([]);
});

test("a gap in a wall is found, along the wall's long side, turned or not", () => {
  // A fence 4 m along x, solid but for a gap from x = 2.5 to 3.
  const fence = box("fence", [0, 0, -0.05], [4, 0.8, 0.05]);
  const gappy = ground([0, 2.5, -1, 1], [3, 4, -1, 1]);
  const found = openSpots([fence], [], gappy, flat, EYE);
  expect(found.length).toBeGreaterThan(0);
  expect(found.filter((s) => s.x <= 2.5 || s.x >= 3)).toEqual([]);
  // The same fence turned a quarter round its middle (2, 0): it runs along z from -2 to 2.
  const turned = box("fence", [0, 0, -0.05], [4, 0.8, 0.05], Math.PI / 2);
  expect(openSpots([turned], [], ground([1.9, 2.1, -2, 2]), flat, EYE)).toEqual([]);
  expect(openSpots([turned], [], ground([1.9, 2.1, -2, 0.5]), flat, EYE).length).toBeGreaterThan(0);
});

test("a gap near the end of a wall along z is found", () => {
  // A fence along z from 1 to 5 at x = 3, solid but for a gap from z = 4.6 to 4.9.
  const fence = box("fence", [3, 0, 1], [3.1, 0.8, 5]);
  const found = openSpots([fence], [], ground([2.9, 3.2, 1, 4.6], [2.9, 3.2, 4.9, 5]), flat, EYE);
  expect(found.length).toBeGreaterThan(0);
  expect(found.filter((s) => Math.abs(s.x - 3.05) > 1e-9 || s.z <= 4.6 || s.z >= 4.9)).toEqual([]);
});

test("a board turned part way round is tried along its own line", () => {
  // A sign 2 m wide round (0, 0), turned 0.5 as three turns rotation.y: it runs along (cos 0.5, -sin 0.5).
  const sign = box("sign", [-1, 0, -0.05], [1, 1, 0.05], 0.5);
  const [ux, uz] = [Math.cos(0.5), -Math.sin(0.5)];
  // Solid within 5 cm of that line, and open everywhere else.
  const onLine = (x: number, z: number) => (Math.abs(x * uz - z * ux) < 0.05 ? { x: x + 1, z } : { x, z });
  expect(openSpots([sign], [], onLine, flat, EYE)).toEqual([]);
});

test("an upright sprite need only stop you at its middle; flat things and things overhead need not", () => {
  // A tree's box is its leaves; only its trunk, at the middle, is solid.
  const tree = box("tree", [-1, 0, -1], [1, 3, 1]);
  expect(openSpots([tree], [], ground([-0.1, 0.1, -0.1, 0.1]), flat, EYE)).toEqual([]);
  expect(openSpots([tree], [], ground(), flat, EYE).map((s) => [s.id, s.x, s.z])).toEqual([["tree", 0, 0]]);
  expect(openSpots([box("doormat", [0, 0, 0], [0.3, 0.03, 0.1])], [], ground(), flat, EYE)).toEqual([]);
  // A lintel over the eye is walked under; on a hill that lifts the ground 2 m, the same box is at the walker's knee.
  const lintel = box("door", [0, 2, 0], [1, 2.2, 0.2]);
  expect(openSpots([lintel], [], ground(), flat, EYE)).toEqual([]);
  expect(openSpots([lintel], [], ground(), () => 2, EYE).length).toBeGreaterThan(0);
});

test("a fence is walked over only where steps lift the ground over its top", () => {
  // A fence 0.8 m high along x from 0 to 4, open to the walker everywhere; steps 0.86 m high from x = 1.5 to 2.5.
  const fence = box("fence", [0, 0, -0.05], [4, 0.8, 0.05]);
  const steps = (x: number) => (x > 1.5 && x < 2.5 ? 0.86 : 0);
  const found = openSpots([fence], [], ground(), steps, EYE);
  expect(found.length).toBeGreaterThan(0);
  expect(found.filter((s) => s.x > 1.5 && s.x < 2.5)).toEqual([]);
});

test("a pond you can walk into is found, out to its edge", () => {
  // A pond 2 m round (1, 0), tried along x.
  const pond = { id: "pond" as const, x: 1, z: 0, r: 2, y: 0, tagY: 0.3 };
  expect(openSpots([], [pond], ground([-1, 3, -0.1, 0.1]), flat, EYE)).toEqual([]);
  const edge = openSpots([], [pond], ground([-1, 2.5, -0.1, 0.1]), flat, EYE);
  expect(edge.length).toBeGreaterThan(0);
  expect(edge.filter((s) => s.x <= 2.5)).toEqual([]);
});
