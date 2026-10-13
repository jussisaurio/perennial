// Pixel art (garden/visitorArt.ts) as SVG: one rect per run of same-coloured pixels in a row.

import { runs, type PixelArt } from "../garden/visitorArt";

export function PixelRects({ art }: { art: PixelArt }) {
  return runs(art).map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />);
}
