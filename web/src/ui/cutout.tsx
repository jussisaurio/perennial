// A paper cut-out (garden/visitorArt.ts) as SVG paths, in its own units: the
// caller's viewBox or transform sizes it.

import type { Cutout } from "../garden/visitorArt";

export function CutoutShapes({ art }: { art: Cutout }) {
  // A piece with no fill is a line alone: "none", or SVG fills it black. The pieces never change order, so their index is a stable key.
  return art.pieces.map((p, i) => <path key={i} d={p.d} fill={p.fill ?? "none"} stroke={p.line?.color} strokeWidth={p.line?.width} strokeLinejoin="round" strokeLinecap="round" />);
}
