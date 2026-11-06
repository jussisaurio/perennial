// Pixel art (garden/visitorArt.ts) as SVG: one path per colour, a rectangle per
// run of same-coloured pixels in a row. A rect per run was ~370 elements for the
// strip's snail and cat, and each element costs style and layout (#486).

import { runs, type PixelArt } from "../garden/visitorArt";

export function PixelRects({ art }: { art: PixelArt }) {
  const byFill = new Map<string, string>();
  for (const r of runs(art)) byFill.set(r.fill, `${byFill.get(r.fill) ?? ""}M${r.x} ${r.y}h${r.w}v1h${-r.w}z`); // ?? "": a colour's first run starts its path
  return [...byFill].map(([fill, d]) => <path key={fill} d={d} fill={fill} />);
}
