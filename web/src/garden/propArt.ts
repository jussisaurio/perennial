// The garden's small props as paper cut-outs (#1164), in visitorArt.ts's
// style: a few pieces of coloured card laid back to front, each with its pale
// cut edge and its shade on the pieces under it. Drawn into the walk's
// textures (textures.ts).

import { flat, LAYER, oval, part, shape, type Cutout, type Piece } from "./visitorArt";

/** A rectangle cut square at its corners, round on the page (clockwise): a piece of card. */
const box = (x0: number, y0: number, x1: number, y1: number) => shape([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]);
/** The same rectangle the other way round: cut out of the piece it is in, as a window is. */
const hole = (x0: number, y0: number, x1: number, y1: number) => shape([x0, y0, 0], [x0, y1, 0], [x1, y1, 0], [x1, y0, 0]);
/** A round hole of radius `r` at (cx, cy), the other way round from `oval`. */
const roundHole = (cx: number, cy: number, r: number) =>
  shape(...Array.from({ length: 8 }, (_, i) => [cx + Math.cos((-i * Math.PI) / 4) * r, cy + Math.sin((-i * Math.PI) / 4) * r] as const));

// ---- Lantern ----
// Painted iron (the palette's lantern accent: --persimmon toward the ink), a wooden post, a brass ring, and vellum
// for its glass. Seen across a corner, so each part has a face in the light (left) and one in shade, folded at x = 8.
const IRON_LIT = "#a4503a";
const IRON = "#7f3b2b";
const IRON_DEEP = "#622e23";
const POST_LIT = "#8f6d4a";
const POST = "#6c5038";
const BRASS = "#d3a645";

/** The lantern's middle line, where its two faces meet. */
const MID = 8;

/**
 * A part of the lantern seen across its corner: one piece of card folded down the middle, its left half in the
 * light and its right half in shade. The fold is the change of tone; the cut edge along its top runs across both.
 */
function folded(x0: number, y0: number, x1: number, y1: number, lit: string, shade: string): Piece[] {
  return [part(box(x0, y0, x1, y1), lit), flat(box(MID, y0 + LAYER.edge.width, x1, y1), shade)];
}

/** The frame's four panes, two in each face: x0, y0, x1, y1. */
const WINDOWS: readonly (readonly [number, number, number, number])[] = [
  [5.2, 6.8, 7.6, 8.4],
  [5.2, 8.9, 7.6, 12.1],
  [8.4, 6.8, 10.8, 8.4],
  [8.4, 8.9, 10.8, 12.1],
];

/** The candle's flame as it shows through the vellum, `r` wide each side of the middle and `h` tall, its foot at the glass's foot. */
const flame = (r: number, h: number) => shape([MID, 12.3 - h, 0], [MID + r, 12.3 - h * 0.35], [MID, 12.3], [MID - r, 12.3 - h * 0.35]);

/**
 * A garden lantern on a wooden post (#1091, #1164), 16×48 units, unlit or lit. Its glass is vellum, set in the
 * frame's two windows: each window's edge shades it along the top and left and shows its pale cut on the bottom and
 * right, so the glass sits back in the frame. Lit, the candle shows through the vellum as two layers of a paler
 * tissue. The glass is where the first 16×48 drawing had it, so the halo (sceneLanterns.ts) sits on it.
 */
export function lanternArt(lit: boolean): Cutout {
  const glass: Piece[] = lit
    ? [...folded(4.9, 6.6, 11.1, 12.4, "#f3c860", "#e6b14c"), flat(flame(2.2, 3.6), "#f8db8e"), flat(flame(1.0, 2.2), "#fff3cf")]
    : folded(4.9, 6.6, 11.1, 12.4, "#efe7d3", "#d9cfb8");
  return {
    w: 16,
    h: 48,
    pieces: [
      // The ring it is carried by, standing up out of the roof.
      part(`${oval(MID, 1.15, 0.95)} ${roundHole(MID, 1.15, 0.5)}`, BRASS),
      // The post, square, folded down one corner, and the collar that holds the lantern on it.
      ...folded(7.0, 15.0, 9.0, 48, POST_LIT, POST),
      ...glass,
      // The frame: one card folded round the corner, a window in each face, each window cut in two by a bar.
      part(`${box(4.4, 6.0, 11.6, 12.9)} ${WINDOWS.map((w) => hole(...w)).join(" ")}`, IRON_LIT),
      flat(`${box(MID, 6.0 + LAYER.edge.width, 11.6, 12.9)} ${WINDOWS.filter(([x0]) => x0 > MID).map((w) => hole(...w)).join(" ")}`, IRON),
      // The base: a plate, and under it a hopper down to the collar on the post.
      part(shape([4.4, 13.5, 0], [11.6, 13.5, 0], [9.4, 15.4, 0], [6.6, 15.4, 0]), IRON),
      flat(shape([MID, 13.5, 0], [11.6, 13.5, 0], [9.4, 15.4, 0], [MID, 15.4, 0]), IRON_DEEP),
      ...folded(3.7, 12.6, 12.3, 13.6, IRON_LIT, IRON),
      // The roof: a low pyramid, its sides a little hollow, as card bent over a curve; its eaves; a knob on top.
      part(shape([MID, 2.0, 0], [MID, 6.1, 0], [2.4, 6.1, 0], [5.6, 4.5]), IRON_LIT),
      part(shape([MID, 2.0, 0], [10.4, 4.5], [13.6, 6.1, 0], [MID, 6.1, 0]), IRON),
      ...folded(2.4, 6.1, 13.6, 6.8, IRON, IRON_DEEP),
      part(oval(MID, 2.1, 0.65), IRON_LIT),
    ],
  };
}
