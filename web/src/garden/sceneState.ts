// The walk as plain data (#974), for the dev-only scene handle (window.__garden): the look tool
// (e2e/look.ts) writes it beside each picture, so an agent can read where it stands and what is
// in view without reading the scene's private fields. Nothing here changes the scene.

import * as THREE from "three";

import type { Reach } from "./reachCore";
import type { TimeOfDay } from "./scene";
import type { HitBox, HitDisc } from "./scenery";
import { STEP, TOP, type StileSpot } from "./stile";

/** A thing in view. `box`: left, top, right, bottom, each a part of the canvas (0 to 1), cut to its edges. `metres`: from the eye to its nearest point. */
export interface ThingInView {
  name: string;
  box: [number, number, number, number];
  metres: number;
}

export interface SceneState {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** The walker's mode (scene.ts Walker), and what they sit on while seated. */
  mode: "free" | "trip" | "glide" | "seated";
  seat: "bench" | "stool" | null;
  /** The time of day drawn now. */
  time: TimeOfDay;
  /** The garden's own clock (s). */
  elapsed: number;
  /** What the action button does now, and everything else in reach that it would do if that were gone. */
  reach: Reach | null;
  inReach: Reach[];
  /** The scenery in view, nearest first: a nearer thing may cover a farther one where their boxes meet. */
  things: ThingInView[];
}

/** A box in the world, like a HitBox: `turn` is round the vertical axis through its middle. */
interface WorldBox {
  name: string;
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  turn?: number;
}

/** The corners' pairs that share an edge: two corners whose numbers differ in one bit. */
const EDGES = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((a) => [1, 2, 4].filter((bit) => !(a & bit)).map((bit) => [a, a | bit] as const));

/** The box's eight corners in the camera's frame (it looks down −z). */
function corners(b: WorldBox, camera: THREE.PerspectiveCamera): THREE.Vector3[] {
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const c = Math.cos(b.turn ?? 0);
  const s = Math.sin(b.turn ?? 0);
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const x = (i & 1 ? b.max[0] : b.min[0]) - cx;
    const z = (i & 4 ? b.max[2] : b.min[2]) - cz;
    // Like three's rotation.y.
    return new THREE.Vector3(cx + c * x + s * z, i & 2 ? b.max[1] : b.min[1], cz - s * x + c * z).applyMatrix4(camera.matrixWorldInverse);
  });
}

/** How far the eye is from the box's nearest point (m). */
function metresTo(b: WorldBox, eye: THREE.Vector3): number {
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  // The eye in the box's own frame: turned back round the box's middle.
  const c = Math.cos(b.turn ?? 0);
  const s = Math.sin(b.turn ?? 0);
  const at = [cx + c * (eye.x - cx) - s * (eye.z - cz), eye.y, cz + s * (eye.x - cx) + c * (eye.z - cz)];
  return Math.hypot(...at.map((v, a) => v - Math.max(b.min[a], Math.min(b.max[a], v))));
}

/** Where a box shows on the canvas, or null when no part of it does. */
function onCanvas(b: WorldBox, camera: THREE.PerspectiveCamera): ThingInView["box"] | null {
  const cs = corners(b, camera);
  // In front of the near plane: those corners, and where an edge that goes behind the eye crosses the plane.
  const near = -camera.near;
  const pts = cs.filter((p) => p.z <= near);
  for (const [i, j] of EDGES) {
    const [p, q] = [cs[i], cs[j]];
    if (p.z <= near !== q.z <= near) pts.push(p.clone().lerp(q, (near - p.z) / (q.z - p.z)));
  }
  if (pts.length === 0) return null;
  for (const p of pts) p.applyMatrix4(camera.projectionMatrix);
  const xs = pts.map((p) => (p.x + 1) / 2);
  const ys = pts.map((p) => (1 - p.y) / 2);
  const box: ThingInView["box"] = [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(1, Math.max(...xs)), Math.min(1, Math.max(...ys))];
  return box[0] < box[2] && box[1] < box[3] ? box : null;
}

/** The scenery a tap can meet, and the stile, where they show on the canvas now: nearest first. */
export function thingsInView(camera: THREE.PerspectiveCamera, boxes: readonly HitBox[], discs: readonly HitDisc[], stile: StileSpot | null): ThingInView[] {
  const all: WorldBox[] = [
    ...boxes.map((b) => ({ name: b.id, min: b.min, max: b.max, turn: b.turn })),
    ...discs.map((d) => ({ name: d.id, min: [d.x - d.r, d.y, d.z - d.r] as const, max: [d.x + d.r, d.y, d.z + d.r] as const })),
    ...(stile ? [{ name: "stile", min: [stile.x - STEP.w / 2, 0, stile.z - STEP.out] as const, max: [stile.x + STEP.w / 2, TOP, stile.z + STEP.out] as const }] : []),
  ];
  return all
    .flatMap((b) => {
      const box = onCanvas(b, camera);
      return box ? [{ name: b.name, box, metres: metresTo(b, camera.position) }] : [];
    })
    .sort((a, b) => a.metres - b.metres);
}
