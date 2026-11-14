// A cut-out is drawn whole from every side (docs/invariants.md, render.whole-cutout). A visitor
// is a flat cut-out that turns round its upright middle line to face you (sceneSprites.ts
// BILLBOARD), so as you walk round it, its ends sweep a circle as wide as it is drawn. A solid
// thing inside that circle cuts it from some side, though the animal it stands for would be in
// front of the thing. A fixed one (the snail on the fence) does not turn: only a thing on its
// own line cuts it. This finds such things in the scene's tap volumes (scenery.ts HitBox),
// its one list of what it draws: as with drawnSolid.ts, a new thing is checked with no more work.

import { BODY } from "./drawnSolid";
import { rayBox, unturn, type HitBox, type SceneryId } from "../garden/scenery";
import { artEnds, type Cutout } from "../garden/visitorArt";

/**
 * How far a cut-out reaches from its foot's middle on the ground (m): `round`, it turns to face you, so `reach` all
 * round; `line`, it stands fixed along `turn`, and runs from `from` to `to` along (cos turn, sin turn).
 */
export type Span = { kind: "round"; reach: number } | { kind: "line"; turn: number; from: number; to: number };

/** A cut-out at rest: who, where its foot's middle is, how far it reaches on the ground, and how tall it is (m). */
export interface Rest {
  who: string;
  at: readonly [number, number, number];
  span: Span;
  tall: number;
}

/** A thing that cuts a cut-out at rest. */
export interface Cut {
  who: string;
  by: SceneryId;
}

/**
 * How far a visitor's frames reach and how tall they stand, drawn `size` metres to the cell (kind.ts VisitorKind.art):
 * the widest and tallest of them, as any may show where it rests. `turn`: the turn it stands fixed at (Body.turn), or
 * null when it turns to face you; then its left end is the farther one from the cell's middle (artLeft).
 */
export function spanOf(art: readonly Cutout[], size: number, turn: number | null): { span: Span; tall: number } {
  const ends = art.map((a) => artEnds(a.w, size));
  const [from, to] = [Math.min(...ends.map(([l]) => l)), Math.max(...ends.map(([, r]) => r))];
  const tall = (Math.max(...art.map((a) => a.h)) / 32) * size;
  return { span: turn === null ? { kind: "round", reach: -from } : { kind: "line", turn, from, to }, tall };
}

/**
 * The solid things that reach into a cut-out's circle, or onto its line, between its foot and its top. Solid: a
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
      const s = r.span;
      if (s.kind === "line") {
        // Along its line, at a height both share, turned into the box's own frame as the tap test turns a ray.
        const [c, sn] = [Math.cos(s.turn), Math.sin(s.turn)];
        const oy = (Math.max(y, b.min[1]) + Math.min(y + r.tall, b.max[1])) / 2;
        const ray = unturn({ ox: x + c * s.from, oy, oz: z + sn * s.from, dx: c, dy: 0, dz: sn }, b);
        if (rayBox(ray, b.min, b.max) < s.to - s.from) out.push({ who: r.who, by: b.id });
        continue;
      }
      // The foot's middle in the box's own frame: a ray that goes nowhere, turned back as the tap test turns one.
      const p = unturn({ ox: x, oy: y, oz: z, dx: 0, dy: 0, dz: 0 }, b);
      const gx = Math.max(b.min[0] - p.ox, 0, p.ox - b.max[0]);
      const gz = Math.max(b.min[2] - p.oz, 0, p.oz - b.max[2]);
      if (Math.hypot(gx, gz) < s.reach) out.push({ who: r.who, by: b.id });
    }
  }
  return out;
}
