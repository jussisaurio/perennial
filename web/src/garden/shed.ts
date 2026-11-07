// The little open shed against the right fence: a back wall, two sides, a
// roof that slopes down to the back, and a step in front.

import * as THREE from "three";
import type { BuildCtx } from "./sceneSprites";
import type { Layout } from "./world";

/** Its back wall is this tall and this long each way from its middle, its sides this deep, its step this high; its roof slopes down to the back by `tilt` (rad). */
const SHED = { h: 1.7, half: 0.8, depth: 0.7, step: 0.08, tilt: 0.18 };

/** The middle of the shed's back wall; it faces into the garden (−x). */
export function shedAt(l: Layout): { x: number; z: number } {
  return { x: l.bounds.maxX - 0.3, z: l.bounds.maxZ - 2.4 };
}

/** The middle of the shed's step, on top of it (spots.ts shedStep). */
export function shedStep(l: Layout): [number, number, number] {
  const s = shedAt(l);
  return [s.x - SHED.depth - 0.1, SHED.step, s.z];
}

/** A place on the shed's roof, a little toward its front and its near end (#376: the goat stands there). */
export function shedRoof(l: Layout): [number, number, number] {
  const s = shedAt(l);
  // 10 cm in front of the roof's middle, where it is that much higher, on top of its 5 cm board.
  return [s.x - SHED.depth / 2 - 0.1, SHED.h + 0.06 + 0.025 + 0.1 * Math.sin(SHED.tilt), s.z + 0.3];
}

/** The nails for the gardener's notes (#654): rows of this many on the back wall, this far apart (m), the top row this high, the next ones lower. */
const NAILS = { perRow: 6, apart: 0.24, top: 1.24, drop: 0.3 };

/**
 * Where the `n` notes hang (#654): on the inside of the back wall, in rows
 * from the top, each row filled from the left as you face the wall (−z).
 * Each point is the middle of a note, a hair off the wall.
 */
export function nailSpots(l: Layout, n: number): [number, number, number][] {
  const s = shedAt(l);
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / NAILS.perRow);
    const inRow = Math.min(NAILS.perRow, n - row * NAILS.perRow);
    const k = i % NAILS.perRow;
    return [s.x - 0.04, NAILS.top - row * NAILS.drop, s.z + (k - (inRow - 1) / 2) * NAILS.apart];
  });
}

/** The shed's boards, in one group for the scene to add. */
export function buildShed(c: BuildCtx, l: Layout): THREE.Group {
  const root = new THREE.Group();
  const s = shedAt(l);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), c.mat(c.woodTex));
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  const { h, half, depth } = SHED;
  box(0.06, h, half * 2, s.x, h / 2, s.z);
  for (const sz of [-1, 1]) box(depth, h, 0.05, s.x - depth / 2, h / 2, s.z + sz * half);
  const roof = box(depth + 0.25, 0.05, half * 2 + 0.2, s.x - depth / 2, h + 0.06, s.z);
  roof.rotation.z = -SHED.tilt;
  box(0.4, SHED.step, half * 2, s.x - depth - 0.1, SHED.step / 2, s.z);
  return root;
}
