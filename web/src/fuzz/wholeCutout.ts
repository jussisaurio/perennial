// A cut-out is drawn whole from every side (docs/invariants.md, render.whole-cutout). A visitor
// is a flat cut-out that turns round its upright middle line to face you (sceneSprites.ts
// BILLBOARD), so as you walk round it, its ends sweep a circle as wide as it is drawn. A solid
// thing inside that circle cuts it from some side, though the animal it stands for would be in
// front of the thing. This finds such things in the scene's tap volumes (scenery.ts HitBox),
// its one list of what it draws: as with drawnSolid.ts, a new thing is checked with no more work.

import { BODY } from "./drawnSolid";
import { unturn, type HitBox, type SceneryId } from "../garden/scenery";
import { artLeft, type Cutout } from "../garden/visitorArt";

/** A cut-out at rest: who, where its foot's middle is, and how far it reaches round that middle and up (m). */
export interface Rest {
  who: string;
  at: readonly [number, number, number];
  reach: number;
  tall: number;
}

/** A thing that cuts a cut-out at rest. */
export interface Cut {
  who: string;
  by: SceneryId;
}

/**
 * How far a visitor's frames reach round its middle line and up, drawn `size` metres to the
 * cell (kind.ts VisitorKind.art): the widest and tallest of them, as any may show where it rests.
 * Its art starts at artLeft, so its left end is the farther one from the cell's middle.
 */
export function reachOf(art: readonly Cutout[], size: number): { reach: number; tall: number } {
  return { reach: (Math.max(...art.map((a) => 16 - artLeft(a.w))) / 32) * size, tall: (Math.max(...art.map((a) => a.h)) / 32) * size };
}

/**
 * The solid things that reach into a cut-out's circle, between its foot and its top. Solid: a
 * thing that stops you all through (drawnSolid.ts BODY). Not an upright sprite (a plant, a tree,
 * a lantern): it is a cut-out too, and a visitor among its leaves is meant to be partly behind them.
 * A thing whose top is at the foot is what it stands on.
 */
export function cuts(boxes: readonly HitBox[], rests: readonly Rest[]): Cut[] {
  const out: Cut[] = [];
  for (const r of rests) {
    const [x, y, z] = r.at;
    for (const b of boxes) {
      if (BODY[b.id] !== "all" || b.max[1] <= y || b.min[1] >= y + r.tall) continue;
      // The foot's middle in the box's own frame: a ray that goes nowhere, turned back as the tap test turns one.
      const p = unturn({ ox: x, oy: y, oz: z, dx: 0, dy: 0, dz: 0 }, b);
      const gx = Math.max(b.min[0] - p.ox, 0, p.ox - b.max[0]);
      const gz = Math.max(b.min[2] - p.oz, 0, p.oz - b.max[2]);
      if (Math.hypot(gx, gz) < r.reach) out.push({ who: r.who, by: b.id });
    }
  }
  return out;
}
