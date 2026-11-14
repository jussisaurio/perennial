// A paper cut-out (garden/visitorArt.ts) as SVG, in its own units: the
// caller's viewBox or transform sizes it. It looks as the walk's atlas draws it
// (textures.ts cutout): each part shades the pieces under it, then shows its
// pale cut edge (LAYER).

import { useId } from "react";
import { LAYER, type Cutout } from "../garden/visitorArt";

export function CutoutShapes({ art }: { art: Cutout }) {
  const id = useId();
  const { shade, edge } = LAYER;
  // The pieces never change order, so their index is a stable key.
  return (
    <>
      <filter id={`${id}blur`}>
        <feGaussianBlur stdDeviation={shade.blur / 2} />
      </filter>
      {art.pieces.map((p, i) => {
        if (p.kind === "line") return <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={p.width} strokeLinejoin="round" strokeLinecap="round" />;
        if (p.kind === "mark") return <path key={i} d={p.d} fill={p.fill} />;
        // The shade lands only on the filled pieces before it, as the canvas's "source-atop" does.
        const under = art.pieces.slice(0, i).filter((q) => q.kind !== "line");
        return (
          <g key={i}>
            {under.length > 0 && (
              <>
                <clipPath id={`${id}under${i}`}>
                  {under.map((q, j) => (
                    <path key={j} d={q.d} />
                  ))}
                </clipPath>
                <g clipPath={`url(#${id}under${i})`}>
                  <path d={p.d} fill={shade.color} transform={`translate(${shade.dx} ${shade.dy})`} filter={`url(#${id}blur)`} />
                </g>
              </>
            )}
            <clipPath id={`${id}part${i}`}>
              <path d={p.d} />
            </clipPath>
            <g clipPath={`url(#${id}part${i})`}>
              <path d={p.d} fill={p.fill} />
              <path d={p.d} fill={edge.color} />
              <path d={p.d} fill={p.fill} transform={`translate(${edge.width} ${edge.width})`} />
            </g>
          </g>
        );
      })}
    </>
  );
}
