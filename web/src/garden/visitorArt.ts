// The garden visitors as paper cut-outs (#1091, #1164): a few pieces of
// coloured card laid one on another, back to front, as SVG paths. Each piece's
// cut edge catches the light and each shades the pieces under it, so shapes
// part by tone and by layer, never by an outline. Drawn into the walk's visitor
// atlas (textures.ts) and as SVG in the 2D strip (ui/cutout.tsx), so both show
// the same animals.

import type { GardenWord } from "../deck/schema";

/** One piece of a cut-out, drawn in order. Its path uses absolute M, L, C, Q and Z only, so `moved` and `turned` can move it. */
export type Piece =
  /** A piece of card cut out and laid on the pieces before it: its cut edge shows pale on the lit side, and it shades what is under it. */
  | { kind: "part"; d: string; fill: string }
  /** Colour printed on the card (an eye, a stripe): flat, with no edge. */
  | { kind: "mark"; d: string; fill: string }
  /** A line printed on the card, `width` units wide. */
  | { kind: "line"; d: string; color: string; width: number };

/**
 * How a part lies on the card under it, in the cut-out's units. The light comes from the upper left, as on the
 * paper's grain (paper.ts): a part's shade falls down and to the right, soft, on the pieces under it only, and its
 * cut edge shows as a pale rim on its upper left. One look for the walk's atlas and the 2D strip.
 */
export const LAYER = {
  shade: { dx: 0.3, dy: 0.45, blur: 0.7, color: "rgba(52, 30, 12, 0.42)" },
  edge: { width: 0.15, color: "rgba(255, 250, 238, 0.5)" },
} as const;

/**
 * A visitor as paper cut-outs: its pieces, drawn in order, in a w×h box, in units where a cell of the walk's atlas is
 * 32 on a side. It stands on the box's bottom edge.
 */
export interface Cutout {
  w: number;
  h: number;
  pieces: readonly Piece[];
}

/** Where a cut-out `w` wide starts across its 32-unit cell in the walk's atlas: in the middle, to the unit below. */
export function artLeft(w: number): number {
  return Math.floor((32 - w) / 2);
}

/** Where a cut-out `w` wide ends, left and right, from its cell's middle line, drawn `size` metres to the cell (m). */
export function artEnds(w: number, size: number): [number, number] {
  return [((artLeft(w) - 16) / 32) * size, ((artLeft(w) + w - 16) / 32) * size];
}

/** The one near-black: eyes, noses, a mouth. Never an outline. */
const INK = "#2b1d15";

/** A number for a path, to two places. */
const n = (v: number) => String(Math.round(v * 100) / 100);
/** Every point of path `d` through `f`. */
function mapPoints(d: string, f: (x: number, y: number) => [number, number]): string {
  return d.replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_, x: string, y: string) => f(Number(x), Number(y)).map(n).join(" "));
}
/** `pieces` moved by dx, dy. */
function moved(pieces: readonly Piece[], dx: number, dy: number): Piece[] {
  return pieces.map((p) => ({ ...p, d: mapPoints(p.d, (x, y) => [x + dx, y + dy]) }));
}
/** `pieces` turned by `deg` degrees (clockwise on the page) round (cx, cy): a part on its hinge, like a paper puppet's. */
function turned(pieces: readonly Piece[], cx: number, cy: number, deg: number): Piece[] {
  const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  return pieces.map((p) => ({ ...p, d: mapPoints(p.d, (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]) }));
}
/** `pieces` mirrored left to right in a cut-out `w` wide: the other half of a thing that faces you. */
function mirrored(pieces: readonly Piece[], w: number): Piece[] {
  return pieces.map((p) => ({ ...p, d: mapPoints(p.d, (x, y) => [w - x, y]) }));
}
/** An ellipse as cubic curves, so it moves like any other path. */
export function oval(cx: number, cy: number, rx: number, ry = rx): string {
  const [kx, ky] = [rx * 0.5523, ry * 0.5523];
  const p = (x: number, y: number) => `${n(x)} ${n(y)}`;
  return `M${p(cx - rx, cy)} C${p(cx - rx, cy - ky)} ${p(cx - kx, cy - ry)} ${p(cx, cy - ry)} C${p(cx + kx, cy - ry)} ${p(cx + rx, cy - ky)} ${p(cx + rx, cy)} C${p(cx + rx, cy + ky)} ${p(cx + kx, cy + ry)} ${p(cx, cy + ry)} C${p(cx - kx, cy + ry)} ${p(cx - rx, cy + ky)} ${p(cx - rx, cy)} Z`;
}
/** A point of a `shape`: x, y, and how round the shape is there (1, if left out: smooth; 0: a sharp corner, as a knife turns). */
type Pt = readonly [number, number] | readonly [number, number, number];
/**
 * A closed shape through `pts`, smooth where they are round and sharp at corners: how the cut-outs are drawn, by a
 * few points each, so a shape reads as one confident cut. Cubic curves through the points (Catmull-Rom).
 */
export function shape(...pts: readonly Pt[]): string {
  const at = (i: number) => pts[(i + pts.length) % pts.length];
  const p = (x: number, y: number) => `${n(x)} ${n(y)}`;
  let d = `M${p(pts[0][0], pts[0][1])}`;
  for (let i = 0; i < pts.length; i++) {
    const [a, b, prev, next] = [at(i), at(i + 1), at(i - 1), at(i + 2)];
    const [ka, kb] = [(a[2] ?? 1) / 6, (b[2] ?? 1) / 6];
    d += ` C${p(a[0] + (b[0] - prev[0]) * ka, a[1] + (b[1] - prev[1]) * ka)} ${p(b[0] - (next[0] - a[0]) * kb, b[1] - (next[1] - a[1]) * kb)} ${p(b[0], b[1])}`;
  }
  return `${d} Z`;
}
/** A piece of card in `color`, laid on the pieces before it. */
export const part = (d: string, color: string): Piece => ({ kind: "part", d, fill: color });
/** Colour printed on the pieces under it: no edge. */
export const flat = (d: string, color: string): Piece => ({ kind: "mark", d, fill: color });
/** A line printed on the pieces under it. */
const line = (d: string, color: string, width: number): Piece => ({ kind: "line", d, color, width });
/** A brass paper fastener at (x, y): the pivot a moving part turns on, through it and the part under it, as on a paper puppet. */
const pin = (x: number, y: number): Piece[] => [part(oval(x, y, 0.42), "#d3a645"), flat(oval(x - 0.12, y - 0.13, 0.16), "#f8e7b0")];
/**
 * The foot a standing figure stands on, from `x0` to `x1` under it, in a cut-out `h` tall: the card's plain back,
 * folded toward you where it meets the ground, so it flares.
 */
const tab = (x0: number, x1: number, h: number): Piece => part(shape([x0, h - 0.8, 0], [x1, h - 0.8, 0], [x1 + 0.6, h, 0], [x0 - 0.6, h, 0]), "#e6dcc6");
/** A thin limb of card along `pts`, `w` wide, bent smoothly, cut square at both ends: a heron's leg, a handle. */
function limb(pts: readonly (readonly [number, number])[], w: number): string {
  const side = (k: number): Pt[] =>
    pts.map(([x, y], i) => {
      const [a, b] = [pts[Math.max(i - 1, 0)], pts[Math.min(i + 1, pts.length - 1)]];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return [x - ((b[1] - a[1]) / l) * k * (w / 2), y + ((b[0] - a[0]) / l) * k * (w / 2), i === 0 || i === pts.length - 1 ? 0 : 1];
    });
  return shape(...side(1), ...side(-1).reverse());
}

// ---- Snail ----
/** A band cut in one piece, wound `turns` times out from (cx, cy) to `r`: a point at the middle, wide at the rim. */
function spiral(cx: number, cy: number, r: number, turns: number): string {
  const steps = Math.round(turns * 10);
  // Its two cut edges, out along one and back along the other; the point and the square end are sharp.
  const edge = (i: number, side: number): Pt => {
    const t = i / steps;
    const a = Math.PI * (0.5 - 2 * turns * (1 - t));
    const d = r * t + side * 0.3 * (r / turns) * t;
    return [cx + Math.cos(a) * d, cy + Math.sin(a) * d, i === 0 || i === steps ? 0 : 1];
  };
  return shape(...Array.from({ length: steps + 1 }, (_, i) => edge(i, 1)), ...Array.from({ length: steps }, (_, i) => edge(steps - i, -1)));
}
const SHELL = "#d98f4e";
const SHELL_DARK = "#a0532a";
const SNAIL_FOOT = "#e3d3ae";
/** A snail, side on, going right: its foot long and pale, its shell one dark band wound in a spiral on a round of card. */
export const SNAIL: Cutout = {
  w: 16,
  h: 11,
  pieces: [
    part(limb([[12.3, 4.0], [11.9, 1.4]], 0.5), SNAIL_FOOT),
    part(limb([[13.6, 4.0], [14.5, 1.6]], 0.5), SNAIL_FOOT),
    flat(oval(11.9, 1.3, 0.5), INK),
    flat(oval(14.5, 1.5, 0.5), INK),
    part(shape([0.4, 10.7, 0], [2.6, 9.7], [10.4, 9.3], [11.0, 5.6], [12.0, 3.4], [13.4, 3.2], [14.6, 4.4], [14.6, 7.0], [14.4, 9.8], [13.2, 10.7, 0]), SNAIL_FOOT),
    part(oval(6.0, 5.8, 4.7, 4.6), SHELL),
    flat(spiral(6.2, 6.0, 4.1, 2.2), SHELL_DARK),
  ],
};
/**
 * The snail going left, as you see it on the fence from inside the garden (kinds/snail.ts). Drawn so, not shown from
 * behind, so its cut edges still catch the light on their upper left.
 */
export const SNAIL_LEFT: Cutout = { w: SNAIL.w, h: SNAIL.h, pieces: mirrored(SNAIL.pieces, SNAIL.w) };

// ---- Cat ----
const CAT = "#df8a45";
const CAT_LIGHT = "#f7e9d2";
const CAT_DARK = "#b4612c";
const CAT_EYE = "#a9c74e";
const CAT_NOSE = "#e2847c";
/** A tabby stripe printed as a wedge: `w` wide at (x, y), its point (dx, dy) from there. */
const wedge = (x: number, y: number, w: number, dx: number, dy: number): Piece => flat(shape([x - w / 2, y, 0], [x + w / 2, y, 0], [x + dx, y + dy, 0]), CAT_DARK);
/** Asleep or one eye open: curled up in a loaf, head on the left, tail round the front. */
function catCurled(awake: boolean): Cutout {
  return {
    w: 24,
    h: 12,
    pieces: [
      part(shape([6.0, 11.9, 0], [5.6, 6.4], [8.8, 3.4], [14.8, 2.5], [20.4, 3.0], [23.4, 6.2], [23.3, 10.2], [21.8, 11.9, 0]), CAT),
      wedge(11.6, 3.0, 1.2, 0.5, 2.6),
      wedge(14.4, 2.6, 1.3, 0.3, 2.8),
      wedge(17.2, 2.7, 1.2, 0.0, 2.6),
      // The haunch, a round cut at the back.
      part(shape([15.2, 11.9, 0], [15.4, 8.0], [18.0, 5.0], [21.6, 5.0], [23.4, 7.4], [23.2, 10.6], [21.8, 11.9, 0]), CAT),
      wedge(19.8, 5.2, 1.1, -0.6, 2.2),
      // The ears behind the head.
      part(shape([1.6, 5.2, 0], [1.8, 0.6, 0], [4.8, 3.4, 0]), CAT),
      part(shape([5.6, 3.4, 0], [8.4, 0.7, 0], [9.0, 5.0, 0]), CAT),
      flat(shape([2.4, 4.4, 0], [2.5, 2.0, 0], [3.9, 3.4, 0]), CAT_NOSE),
      flat(shape([6.6, 3.5, 0], [8.0, 2.2, 0], [8.3, 4.2, 0]), CAT_NOSE),
      part(shape([1.0, 7.4], [2.0, 4.4], [5.2, 3.3], [8.6, 4.4], [9.9, 7.2], [8.8, 10.0], [5.4, 10.9], [2.0, 9.9]), CAT),
      wedge(4.6, 3.5, 0.9, 0.1, 1.5),
      wedge(5.9, 3.5, 0.9, -0.1, 1.5),
      part(shape([3.6, 8.9], [4.6, 8.0], [5.5, 8.3], [6.4, 8.0], [7.4, 8.9], [6.6, 9.7], [5.5, 9.6], [4.4, 9.7]), CAT_LIGHT),
      flat(shape([4.9, 7.7, 0], [6.1, 7.7, 0], [5.5, 8.4, 0]), CAT_NOSE),
      line("M2.4 6.5 C2.9 7.1 3.7 7.1 4.2 6.5", INK, 0.38),
      ...(awake
        ? [flat(shape([6.4, 6.5, 0.6], [7.4, 5.8], [8.4, 6.4, 0.6], [7.4, 7.0]), CAT_EYE), flat(shape([7.4, 5.85, 0], [7.65, 6.4], [7.4, 6.95, 0], [7.15, 6.4]), INK)]
        : [line("M6.6 6.4 C7.1 7.0 7.9 7.0 8.4 6.4", INK, 0.38)]),
      // The tail round the front, laid over the chin, ringed, its dark tip curled up.
      part(shape([22.6, 10.2], [16.0, 10.0], [9.0, 10.2], [4.8, 10.2], [2.2, 9.6], [0.9, 8.4, 0.6], [0.7, 9.8], [2.2, 11.2], [5.0, 11.9, 0], [22.0, 11.9, 0]), CAT),
      wedge(6.6, 10.25, 1.0, 0.2, 1.6),
      wedge(10.2, 10.15, 1.0, 0.2, 1.7),
      wedge(13.8, 10.1, 1.0, 0.2, 1.7),
      flat(shape([2.6, 9.7], [0.9, 8.4, 0.6], [0.7, 9.8], [2.0, 11.1], [3.0, 11.4, 0]), CAT_DARK),
    ],
  };
}
/** Curled up asleep, head on the left. */
export const CAT_ASLEEP = catCurled(false);
/** The same cat with one green eye open. */
export const CAT_AWAKE = catCurled(true);

/** One of the stare's eyes, at (x, y): a green almond with a slit. */
const catEye = (x: number, y: number): Piece[] => [
  flat(shape([x - 1, y, 0.6], [x, y - 0.75], [x + 1, y, 0.6], [x, y + 0.75]), CAT_EYE),
  flat(shape([x, y - 0.7, 0], [x + 0.26, y], [x, y + 0.7, 0], [x - 0.26, y]), INK),
];
/** The cat up and walking (#362: to the bench and home), facing you: its eyes look at the middle. */
export const CAT_STARE: Cutout = {
  w: 11,
  h: 16,
  pieces: [
    part(shape([7.6, 15.9, 0], [9.8, 15.2], [10.6, 13.0], [10.0, 10.6, 0], [9.6, 12.8], [8.6, 14.4], [7.0, 14.9]), CAT),
    part(shape([1.4, 15.9, 0], [1.0, 12.6], [2.4, 9.4], [4.0, 7.8], [7.0, 7.8], [8.6, 9.4], [10.0, 12.6], [9.6, 15.9, 0]), CAT),
    // The haunches, a round cut each side.
    part(shape([1.4, 15.9, 0], [0.9, 13.6], [2.2, 11.6], [3.8, 12.4], [4.2, 15.9, 0]), CAT),
    part(shape([9.6, 15.9, 0], [10.1, 13.6], [8.8, 11.6], [7.2, 12.4], [6.8, 15.9, 0]), CAT),
    part(shape([3.8, 8.2], [7.2, 8.2], [6.6, 11.4], [5.5, 13.4, 0], [4.4, 11.4]), CAT_LIGHT),
    part(shape([3.3, 15.9, 0], [3.4, 12.6], [5.2, 12.4], [5.4, 15.9, 0]), CAT_LIGHT),
    part(shape([5.6, 15.9, 0], [5.8, 12.4], [7.6, 12.6], [7.7, 15.9, 0]), CAT_LIGHT),
    part(shape([1.4, 4.4, 0], [1.6, 0.2, 0], [4.6, 2.2, 0]), CAT),
    part(shape([9.6, 4.4, 0], [9.4, 0.2, 0], [6.4, 2.2, 0]), CAT),
    flat(shape([2.1, 3.4, 0], [2.2, 1.3, 0], [3.6, 2.4, 0]), CAT_NOSE),
    flat(shape([8.9, 3.4, 0], [8.8, 1.3, 0], [7.4, 2.4, 0]), CAT_NOSE),
    part(shape([1.2, 5.2], [2.4, 2.4], [5.5, 1.6], [8.6, 2.4], [9.8, 5.2], [8.8, 7.6], [5.5, 8.6], [2.2, 7.6]), CAT),
    wedge(4.6, 1.7, 0.8, 0.1, 1.4),
    wedge(5.5, 1.6, 0.8, 0, 1.6),
    wedge(6.4, 1.7, 0.8, -0.1, 1.4),
    ...catEye(3.6, 4.6),
    ...catEye(7.4, 4.6),
    part(shape([3.6, 6.8], [4.6, 6.0], [5.5, 6.4], [6.4, 6.0], [7.4, 6.8], [6.8, 7.9], [5.5, 8.3], [4.2, 7.9]), CAT_LIGHT),
    flat(shape([4.9, 6.0, 0], [6.1, 6.0, 0], [5.5, 6.7, 0]), CAT_NOSE),
  ],
};

// ---- Bird ----
const BIRD_BROWN = "#8c6a46";
const BIRD_LIGHT = "#f2e4cb";
const BIRD_DARK = "#56402c";
const BREAST = "#dc5636";
const BEAK = "#eeb03c";
/** The folded wing, its tip cut in two notches like long feathers; the hop lifts it on its hinge at the shoulder. */
const BIRD_WING = part(shape([5.8, 4.6], [7.6, 3.2], [10.0, 3.8], [12.4, 5.4, 0], [11.0, 5.7, 0], [11.4, 6.2, 0], [10.0, 6.4, 0], [10.2, 6.9, 0], [7.8, 6.9], [6.0, 6.0]), BIRD_DARK);
/** The bird's body, head on the left, `dy` down; its wing turned `lift` degrees up from folded. */
function birdBody(dy: number, lift: number): Piece[] {
  return moved(
    [
      // The tail, forked at its end.
      part(shape([9.4, 5.0], [13.8, 3.2, 0], [13.0, 4.7, 0], [13.6, 6.2, 0], [10.2, 7.4]), BIRD_DARK),
      part(shape([2.6, 4.4], [3.3, 2.0], [5.2, 1.1], [7.2, 1.9], [8.8, 3.7], [11.2, 4.9], [12.4, 5.6, 0], [11.2, 7.1], [8.6, 8.2], [5.8, 8.4], [3.6, 7.3]), BIRD_BROWN),
      part(shape([6.2, 8.4], [8.4, 7.2], [11.0, 6.8], [9.6, 8.0], [7.6, 8.5]), BIRD_LIGHT),
      part(shape([2.6, 4.4], [3.6, 3.9], [5.4, 4.5], [6.8, 6.2], [6.4, 8.1], [4.6, 8.2], [3.1, 6.8]), BREAST),
      ...turned([BIRD_WING], 6.4, 4.6, -lift),
      part(shape([3.0, 3.5, 0], [0.7, 4.1, 0], [2.9, 4.8, 0]), BEAK),
      flat(oval(4.2, 3.2, 0.7), BIRD_LIGHT),
      flat(oval(4.2, 3.2, 0.52), INK),
    ],
    0,
    dy,
  );
}
/** A small brown bird with an orange breast, perched. */
export const BIRD: Cutout = {
  w: 14,
  h: 10,
  pieces: [line("M6.2 8.2 L6.0 9.7 M7.8 8.2 L8.0 9.7 M5.1 9.7 L6.7 9.7 M7.2 9.7 L8.8 9.7", BIRD_DARK, 0.4), ...birdBody(0, 0)],
};
/** The bird mid-hop, wings up. */
export const BIRD_HOP: Cutout = {
  w: 14,
  h: 11,
  pieces: [line("M6.3 9.4 L6.1 10.7 M7.8 9.4 L8.0 10.7", BIRD_DARK, 0.4), ...birdBody(1.4, 70)],
};

// ---- Frog ----
const FROG_GREEN = "#8cbc4c";
const FROG_LIGHT = "#eaeebc";
const FROG_DARK = "#4f8a38";
const GOLD = "#eeb03c";
/** Its left half, from the back: a hind leg folded at its side, wider than its body, its foot's toes cut long. */
const FROG_HIND = [
  part(shape([0.3, 9.4], [0.5, 7.2], [1.8, 5.6], [3.8, 5.6], [5.0, 7.4], [4.8, 9.6], [3.0, 10.6], [1.2, 10.5]), FROG_DARK),
  part(shape([4.8, 10.95, 0], [0.1, 10.95, 0], [1.3, 10.4, 0.5], [0.2, 9.8, 0], [1.9, 9.95, 0.5], [1.2, 9.2, 0], [3.0, 9.7], [4.8, 9.8]), FROG_GREEN),
];
/** Its left front leg, elbow out, its hand's three toes spread on the pad. */
const FROG_ARM = part(shape([2.5, 7.6], [3.7, 7.1], [4.3, 8.6], [4.7, 9.9], [5.9, 10.5, 0], [4.9, 10.45, 0.3], [4.3, 10.95, 0], [3.8, 10.45, 0.3], [2.8, 10.95, 0], [3.4, 9.9], [2.9, 8.8]), FROG_GREEN);
/** A frog sitting, looking at you; `eyes` open or shut, its throat puffed out or not. */
function frog(eyes: Piece[], puffed: boolean): Cutout {
  return {
    w: 14,
    h: 11,
    pieces: [
      ...FROG_HIND,
      ...mirrored(FROG_HIND, 14),
      part(shape([2.6, 10.9, 0], [2.1, 8.4], [2.5, 6.2], [4.0, 4.7], [7, 4.2], [10.0, 4.7], [11.5, 6.2], [11.9, 8.4], [11.4, 10.9, 0]), FROG_GREEN),
      part(oval(4.0, 3.5, 2.0, 1.95), FROG_GREEN),
      part(oval(10.0, 3.5, 2.0, 1.95), FROG_GREEN),
      flat(oval(10.9, 5.8, 0.35), FROG_DARK),
      flat(oval(3.4, 6.4, 0.3), FROG_DARK),
      part(shape([4.2, 10.9, 0], [4.0, 9.0], [5.2, 7.5], [7, 7.1], [8.8, 7.5], [10.0, 9.0], [9.8, 10.9, 0]), FROG_LIGHT),
      ...(puffed ? [part(oval(7, 7.7, 2.6, 2.0), "#f6f2d4")] : []),
      line("M3.4 6.0 C5.2 7.3 8.8 7.3 10.6 6.0", INK, 0.32),
      flat(oval(6.3, 5.1, 0.2), FROG_DARK),
      flat(oval(7.7, 5.1, 0.2), FROG_DARK),
      FROG_ARM,
      ...mirrored([FROG_ARM], 14),
      ...eyes,
    ],
  };
}
/** Its eyes: gold, each with a wide dark slit. */
const FROG_EYES = [4.0, 10.0].flatMap((x) => [flat(oval(x, 3.4, 1.25), GOLD), flat(oval(x, 3.4, 0.9, 0.45), INK)]);
/** A green frog sitting on a lily pad, looking at you. */
export const FROG = frog(FROG_EYES, false);
/** The frog croaking: its throat puffs out pale. */
export const FROG_CROAK = frog(FROG_EYES, true);
/** Eyes shut: it talks in its sleep. */
export const FROG_ASLEEP = frog(
  [4.0, 10.0].map((x) => line(`M${n(x - 1.2)} 3.5 C${n(x - 0.6)} 4.2 ${n(x + 0.6)} 4.2 ${n(x + 1.2)} 3.5`, INK, 0.32)),
  false,
);

// ---- Dog ----
const DOG_TAN = "#c98a4f";
const DOG_LIGHT = "#f4e4c8";
const DOG_DARK = "#7c4a29";
const COLLAR = "#d9553a";
const TAG = "#eeb03c";
/** Its tail up, a hinge at the rump: the wag turns it down. */
const DOG_TAIL = part(shape([4.4, 12.6], [2.9, 11.1], [1.9, 9.3], [2.2, 7.0, 0], [2.9, 8.8], [3.9, 10.2], [5.3, 11.3]), DOG_TAN);
/** A tan dog sitting, facing right (it sits left of its plant, looking at it), its tail turned `wag` degrees down. */
function dog(wag: number): Cutout {
  return {
    w: 18,
    h: 16,
    pieces: [
      ...turned([DOG_TAIL], 4.8, 12, wag),
      // The far front leg, in shade.
      part(shape([11.2, 10.4], [12.8, 10.6], [12.8, 15.9, 0], [11.0, 15.9, 0]), DOG_DARK),
      part(shape([9.6, 6.2], [7.0, 8.0], [4.6, 10.6], [3.5, 13.4], [3.7, 15.9, 0], [14.9, 15.9, 0], [15.1, 12.2], [15.5, 9.4], [14.6, 7.3]), DOG_TAN),
      // The haunch: one round cut over the body, with the hind paw in front of it.
      part(shape([3.7, 15.9, 0], [3.6, 12.8], [5.6, 10.2], [8.4, 10.3], [10.2, 12.6], [10.2, 15.9, 0]), DOG_TAN),
      ...pin(4.8, 12),
      part(shape([8.6, 15.9, 0], [8.8, 14.9], [10.6, 14.6], [11.9, 15.2], [12.0, 15.9, 0]), DOG_LIGHT),
      part(shape([12.2, 7.6], [14.6, 7.4], [15.0, 9.4], [14.2, 11.2], [12.8, 11.0], [12.2, 9.6]), DOG_LIGHT),
      part(shape([12.4, 10.4], [14.4, 10.2], [14.9, 15.9, 0], [12.6, 15.9, 0]), DOG_TAN),
      part(shape([12.3, 15.9, 0], [12.5, 14.9], [14.4, 14.7], [15.6, 15.3], [15.6, 15.9, 0]), DOG_LIGHT),
      part(shape([9.9, 6.6, 0], [12.8, 7.9], [15.3, 7.6, 0], [15.5, 8.9, 0], [12.8, 9.3], [9.9, 8.2, 0]), COLLAR),
      part(oval(13.6, 9.9, 0.62), TAG),
      part(shape([9.1, 4.4], [9.8, 2.1], [12.2, 1.0], [14.6, 1.8], [15.8, 3.4], [17.2, 3.7], [17.9, 4.9], [17.3, 6.5], [15.4, 7.5], [12.6, 7.7], [10.2, 6.8]), DOG_TAN),
      part(shape([13.6, 5.6], [15.2, 4.0], [17.1, 3.8], [17.9, 4.9], [17.3, 6.5], [15.4, 7.5], [13.8, 7.1]), DOG_LIGHT),
      flat(shape([16.3, 4.1], [17.3, 3.6], [18.0, 4.2], [17.7, 5.0], [16.8, 5.0]), INK),
      line("M17.4 5.6 C17 6.3 16.1 6.4 15.3 6.0", DOG_DARK, 0.3),
      flat(oval(14.2, 3.7, 0.55, 0.62), INK),
      line("M13.4 2.6 C13.9 2.2 14.6 2.2 15.1 2.6", DOG_DARK, 0.32),
      // The ear hangs from the top of the head: laid last, it shades the head and the neck.
      part(shape([10.6, 1.3], [12.6, 1.7], [12.5, 4.4], [11.6, 7.2], [10.3, 8.3], [9.1, 7.3], [9.3, 4.0]), DOG_DARK),
    ],
  };
}
/** A tan dog sitting, facing right, its tail up. */
export const DOG = dog(0);
/** The same dog, its tail swept down: two frames make a wag. */
export const DOG_WAG = dog(-25);

// ---- Fish ----
const FISH = "#e8803c";
const FISH_LIT = "#f0985a";
const FISH_DARK = "#c4602c";
const FIN = "#f2b27a";
const FISH_PALE = "#f8ead2";
/** A tiny fishbowl with a goldfish: the fish's home in the strip, where there is no pond. */
export const FISHBOWL: Cutout = {
  w: 14,
  h: 12,
  pieces: [
    part(shape([4.0, 1.0, 0], [10.0, 1.0, 0], [9.5, 2.6], [12.6, 4.2], [13.5, 7.2], [12.0, 10.6], [7.0, 11.8], [2.0, 10.6], [0.5, 7.2], [1.4, 4.2], [4.5, 2.6]), "#e2eff3"),
    flat(shape([0.75, 5.6, 0], [13.25, 5.6, 0], [13.5, 7.2], [12.0, 10.6], [7.0, 11.8], [2.0, 10.6], [0.5, 7.2]), "#9ccbdd"),
    flat(shape([3.0, 10.9, 0], [7.0, 10.3], [11.0, 10.9, 0], [7.0, 11.75]), "#d9c79f"),
    part(shape([9.0, 7.6, 0], [10.6, 6.4, 0], [10.2, 7.6, 0], [10.6, 8.8, 0]), FIN),
    part(shape([4.4, 7.6, 0], [6.2, 6.5], [9.3, 7.6, 0], [6.2, 8.7]), FISH),
    flat(oval(5.5, 7.4, 0.28), INK),
    // The bowl's lip: a strip of glass folded out round its top.
    part(shape([3.6, 0.4, 0], [10.4, 0.4, 0], [10.2, 1.5, 0], [3.8, 1.5, 0]), "#cfe2ea"),
    flat(shape([1.9, 5.0], [2.6, 3.8], [3.0, 4.0], [2.4, 6.2], [2.4, 8.0], [1.9, 7.6]), "#ffffff"),
  ],
};
/** A goldfish seen from above, head to the right, folded along its spine: it swims in the pond in the walk. */
export const KOI: Cutout = {
  w: 16,
  h: 8,
  pieces: [
    part(shape([4.6, 4.0], [1.8, 1.8], [0.3, 0.8, 0], [1.5, 4.0, 0], [0.3, 7.2, 0], [1.8, 6.2]), FIN),
    part(shape([10.0, 2.6, 0], [11.0, 0.4, 0], [12.6, 2.4, 0]), FIN),
    part(shape([10.0, 5.4, 0], [11.0, 7.6, 0], [12.6, 5.6, 0]), FIN),
    part(shape([3.4, 4.0, 0], [6.0, 2.1], [10.0, 1.6], [13.6, 2.2], [15.7, 4.0, 0.8], [13.6, 5.8], [10.0, 6.4], [6.0, 5.9]), FISH),
    flat(shape([3.4, 4.0, 0], [6.0, 2.1], [10.0, 1.6], [13.6, 2.2], [15.7, 4.0, 0], [10.0, 4.0, 0]), FISH_LIT),
    flat(shape([6.8, 3.2], [8.6, 2.2], [10.2, 2.8], [9.8, 4.6], [8.0, 5.0]), FISH_PALE),
    flat(oval(14.2, 3.0, 0.32), INK),
    flat(oval(14.2, 5.0, 0.32), INK),
  ],
};
/** The same goldfish from the side, head to the right: the one that jumps out of the pond (#364). */
export const LEAPING_FISH: Cutout = {
  w: 16,
  h: 8,
  pieces: [
    part(shape([3.8, 4.4], [1.4, 2.4], [0.3, 1.4, 0], [1.4, 4.6, 0], [0.3, 7.4, 0], [1.6, 6.4]), FIN),
    part(shape([6.8, 2.6, 0], [8.2, 0.3, 0], [10.6, 2.2, 0]), FIN),
    part(shape([8.2, 6.0, 0], [9.0, 7.7, 0], [10.4, 6.2, 0]), FIN),
    part(shape([3.0, 4.4, 0], [5.6, 2.4], [10.0, 1.8], [13.6, 2.6], [15.7, 4.2, 0.8], [14.0, 5.8], [10.6, 6.6], [6.4, 6.2]), FISH),
    flat(shape([4.6, 5.2], [8.0, 5.5], [12.0, 5.4], [15.2, 4.6], [14.0, 5.8], [10.6, 6.6], [6.4, 6.2]), FISH_PALE),
    flat(shape([12.0, 2.7, 0], [11.3, 4.2], [12.0, 5.8, 0], [11.8, 4.2]), FISH_DARK),
    flat(oval(13.7, 3.8, 0.42), INK),
  ],
};

// ---- Butterfly ----
/** One side of a butterfly resting with its wings open: the hind wing in `inner`, the forewing over it, its tip cut dark with two pale spots. */
const butterflyHalf = (wing: string, inner: string, dark: string): Piece[] => [
  part(shape([6.2, 5.9], [4.4, 6.3], [2.6, 7.5], [2.6, 9.4], [3.8, 10.6, 0], [5.4, 9.8], [6.3, 8.0]), inner),
  part(shape([6.2, 4.6], [4.6, 2.6], [2.4, 1.5], [0.4, 1.9, 0], [0.5, 4.3], [1.8, 6.4], [4.2, 6.9], [6.2, 5.9]), wing),
  flat(shape([0.4, 1.9, 0], [2.4, 1.5], [4.0, 2.2], [2.4, 2.9], [1.3, 4.2], [0.48, 4.0]), dark),
  flat(oval(1.3, 2.6, 0.32), "#fff8e7"),
  flat(oval(2.5, 2.2, 0.25), "#fff8e7"),
];
/** A butterfly resting, wings open, the dark of its wing tips on its body and feelers. */
function butterflyOpen(wing: string, inner: string, dark: string): Cutout {
  const half = butterflyHalf(wing, inner, dark);
  return {
    w: 13,
    h: 11,
    pieces: [
      line("M6.3 3.2 Q5.4 1.4 4.2 0.5 M6.7 3.2 Q7.6 1.4 8.8 0.5", dark, 0.3),
      flat(oval(4.2, 0.5, 0.35), dark),
      flat(oval(8.8, 0.5, 0.35), dark),
      ...half,
      ...mirrored(half, 13),
      part(shape([6.5, 2.8], [7.1, 3.6], [7.0, 6.4], [6.5, 9.4, 0], [6.0, 6.4], [5.9, 3.6]), dark),
    ],
  };
}
/** Wings up and shut, seen side on: mid-flap, or asleep at night. Folded down the body: the half toward the light is lighter. */
function butterflyClosed(wing: string, inner: string, dark: string): Cutout {
  return {
    w: 13,
    h: 10,
    pieces: [
      line("M6.3 2.4 Q5.4 1.2 4.2 0.5 M6.7 2.4 Q7.6 1.2 8.8 0.5", dark, 0.3),
      flat(oval(4.2, 0.5, 0.35), dark),
      flat(oval(8.8, 0.5, 0.35), dark),
      // The two wings pressed together to a point at their tips, not a round cap: a sail, not a beetle.
      part(shape([6.5, 9.0, 0], [5.3, 7.2], [4.8, 4.6], [5.4, 2.5], [6.5, 0.9, 0], [7.6, 2.5], [8.2, 4.6], [7.7, 7.2]), inner),
      flat(shape([6.5, 9.0, 0], [5.3, 7.2], [4.8, 4.6], [5.4, 2.5], [6.5, 0.9, 0]), wing),
      // The dark tips, a chevron along the top edge.
      flat(shape([4.9, 3.6, 0], [5.4, 2.5], [6.5, 0.9, 0], [7.6, 2.5], [8.1, 3.6, 0], [7.2, 2.9], [6.5, 2.2, 0], [5.8, 2.9]), dark),
      part(limb([[6.5, 6.6], [6.5, 9.7]], 0.5), dark),
    ],
  };
}
/** The butterfly visitor: orange, its tips brown. */
export const BUTTERFLY = butterflyOpen("#f0a040", "#e2862e", "#5a3420");
export const BUTTERFLY_CLOSED = butterflyClosed("#f0a040", "#e2862e", "#5a3420");
/** The walk's own butterflies over the blooms (sceneCritters.ts): the same butterfly, open and closed, its wings in `hue`. */
export function butterflyIn(hue: number): [Cutout, Cutout] {
  const [wing, inner, dark] = [`hsl(${hue} 85% 63%)`, `hsl(${hue} 72% 50%)`, `hsl(${hue} 40% 24%)`];
  return [butterflyOpen(wing, inner, dark), butterflyClosed(wing, inner, dark)];
}

// ---- Gnome ----
const HAT = "#c9472f";
const HAT_LIT = "#e0684a";
const SKIN = "#f0c8a0";
const NOSE = "#e2866e";
const BEARD = "#f5f0e4";
const COAT = "#4a74ad";
const COAT_DARK = "#36598c";
const BOOT = "#5c3f2a";
/** Its tall hat, folded down the middle: the half toward the light a shade lighter. Its tip leans to the right. */
const GNOME_HAT = [
  part(shape([3.0, 9.2, 0], [4.8, 6.2], [6.8, 3.0], [8.8, 1.0], [10.8, 0.2, 0], [9.9, 1.8], [10.0, 4.4], [11.4, 7.0], [13.0, 9.2, 0], [8.0, 9.75, 0.6]), HAT),
  flat(shape([3.0, 9.2, 0], [4.8, 6.2], [6.8, 3.0], [8.8, 1.0], [10.8, 0.2, 0], [8.6, 3.4], [7.6, 6.6], [7.6, 9.72, 0], [5.4, 9.6]), HAT_LIT),
];
/** Its lantern, `lit` or not, hanging from its right hand: its middle is where the walk puts its glow (kinds/gnome.ts). */
const lantern = (lit: boolean): Piece[] => [
  line("M14.8 16.9 L15.2 17.5", INK, 0.25),
  part(shape([14.65, 17.9, 0], [15.75, 17.9, 0], [15.65, 19.5, 0], [14.75, 19.5, 0]), lit ? "#ffe27a" : "#c9cbbd"),
  part(shape([14.4, 18.05, 0], [15.2, 17.2, 0], [16.0, 18.05, 0]), INK),
  part(shape([14.6, 19.4, 0], [15.8, 19.4, 0], [15.7, 19.9, 0], [14.7, 19.9, 0]), INK),
];
/** Below its face, the same in both poses: boots, a long coat with a belt, sleeves and hands, the lantern. */
function gnomeBody(lit: boolean): Piece[] {
  const boot = part(shape([1.6, 22.2, 0], [1.8, 21.4], [3.2, 20.7], [4.8, 20.3, 0], [7.5, 20.3, 0], [7.6, 22.2, 0]), BOOT);
  return [
    tab(2.4, 13.6, 23),
    boot,
    ...mirrored([boot], 16),
    part(shape([4.8, 12.3], [3.2, 13.6], [2.4, 15.8], [1.9, 18.4], [1.5, 21.0, 0], [14.5, 21.0, 0], [14.1, 18.4], [13.6, 15.8], [12.8, 13.6], [11.2, 12.3]), COAT),
    flat(shape([7.5, 21.0, 0], [8.0, 19.2, 0], [8.5, 21.0, 0]), COAT_DARK),
    part(shape([2.05, 17.5, 0], [13.95, 17.5, 0], [14.15, 18.8, 0], [1.85, 18.8, 0]), BOOT),
    part(shape([7.0, 17.3, 0], [9.0, 17.3, 0], [9.0, 19.0, 0], [7.0, 19.0, 0]), GOLD),
    flat(shape([7.6, 17.85, 0], [8.4, 17.85, 0], [8.4, 18.45, 0], [7.6, 18.45, 0]), BOOT),
    part(shape([4.4, 12.6], [3.0, 14.4], [1.6, 16.4, 0], [3.2, 17.0, 0], [4.6, 15.0]), COAT_DARK),
    part(shape([11.6, 12.6], [13.0, 14.4], [14.6, 16.2, 0], [13.0, 16.9, 0], [11.4, 15.0]), COAT_DARK),
    part(oval(2.2, 16.9, 0.95), SKIN),
    ...lantern(lit),
    part(oval(14.6, 16.7, 0.95), SKIN),
  ];
}
/** Its face toward you: the beard over the coat, cut to points, a round nose, two dark eyes under the hat. */
const GNOME_FACE: Piece[] = [
  part(oval(8, 10.6, 3.6, 2.0), SKIN),
  part(shape([4.6, 11.2], [4.4, 13.0], [5.2, 15.0], [6.3, 15.9, 0], [6.8, 15.4], [8.0, 17.2, 0], [9.2, 15.4], [9.7, 15.9, 0], [10.8, 15.0], [11.6, 13.0], [11.4, 11.2], [8, 11.8]), BEARD),
  part(shape([5.6, 12.0], [6.7, 11.1], [8.0, 11.5, 0], [9.3, 11.1], [10.4, 12.0], [9.4, 12.5], [8.0, 12.1, 0], [6.6, 12.5]), BEARD),
  part(oval(8, 11.1, 1.05, 0.9), NOSE),
  flat(oval(6.3, 10.3, 0.38), INK),
  flat(oval(9.7, 10.3, 0.38), INK),
];
/** Its head turned away to your left, three-quarters: the face slid that way, the far eye smaller, its white hair and an ear showing behind. */
const GNOME_PROFILE: Piece[] = [
  part(shape([9.4, 9.4], [12.2, 9.4], [12.5, 11.2], [11.4, 12.9], [9.6, 12.2]), BEARD),
  part(oval(6.9, 10.6, 3.4, 2.0), SKIN),
  part(oval(10.0, 10.9, 0.55, 0.75), SKIN),
  part(shape([3.2, 11.2], [3.0, 13.0], [3.8, 15.0], [4.9, 15.9, 0], [5.4, 15.4], [6.6, 17.2, 0], [7.8, 15.4], [8.3, 15.9, 0], [9.4, 15.0], [10.0, 13.0], [9.8, 11.2], [6.6, 11.8]), BEARD),
  part(shape([4.2, 12.0], [5.3, 11.1], [6.6, 11.5, 0], [7.9, 11.1], [9.0, 12.0], [8.0, 12.5], [6.6, 12.1, 0], [5.2, 12.5]), BEARD),
  part(oval(5.3, 11.1, 1.05, 0.9), NOSE),
  flat(oval(4.6, 10.3, 0.38), INK),
  flat(oval(7.7, 10.3, 0.32), INK),
];
/** The gnome facing you or looking away, with its lantern unlit (by day) or lit. */
export function gnomeArt(pose: "front" | "side", lit: boolean): Cutout {
  return { w: 16, h: 23, pieces: [...gnomeBody(lit), ...(pose === "front" ? GNOME_FACE : GNOME_PROFILE), ...GNOME_HAT] };
}
/** Crouched behind something: only its hat and eyes peek out. */
export const GNOME_PEEK: Cutout = {
  w: 16,
  h: 11,
  pieces: [part(shape([4.2, 11, 0], [4.6, 9.6], [8, 9.2], [11.4, 9.6], [11.8, 11, 0]), SKIN), flat(oval(6.3, 10.3, 0.38), INK), flat(oval(9.7, 10.3, 0.38), INK), ...GNOME_HAT],
};
/** Among the lily pads, pretending to be one: a pad on its head, the hat poking through, its eyes just over the water. */
export const GNOME_PAD: Cutout = {
  w: 16,
  h: 13,
  pieces: [
    part(shape([4.4, 13, 0], [4.6, 11.8], [8, 11.2], [11.4, 11.8], [11.6, 13, 0]), SKIN),
    flat(oval(6.4, 12.2, 0.36), INK),
    flat(oval(9.6, 12.2, 0.36), INK),
    // The pad, its notch cut to the middle, as the pond's are.
    part(shape([0.4, 9.8], [2.2, 8.3], [8.0, 7.6], [13.8, 8.3], [15.6, 9.8], [13.8, 11.3], [10.6, 11.85, 0], [8.6, 9.9, 0], [8.2, 11.95, 0], [2.2, 11.3]), "#6f9a5c"),
    flat(shape([3.0, 9.4, 0], [6.4, 9.8, 0], [3.2, 9.7, 0]), "#4c7f47"),
    flat(shape([13.0, 10.4, 0], [9.6, 9.9, 0], [12.8, 10.7, 0]), "#4c7f47"),
    ...moved(GNOME_HAT, 0, -0.2),
  ],
};
/** Found: it falls over, flat on its back, its hat to one side (the front drawing turned on its side), its lantern unlit. */
export const GNOME_FALLEN: Cutout = { w: 23, h: 16, pieces: gnomeArt("front", false).pieces.map((p) => ({ ...p, d: mapPoints(p.d, (x, y) => [y, x]) })) };

// ---- Heron ----
const HERON_GREY = "#a3adb5";
const HERON_LIT = "#c4ccd1";
const HERON_LIGHT = "#eceeea";
const HERON_DARK = "#56616c";
const HERON_GOLD = "#dfaa3c";
/** A leg standing, from the hip at `x`: its heel a little back, its long toes along the ground. */
const heronLeg = (x: number): Piece[] => [
  part(limb([[x, 18.4], [x + 0.35, 23.2], [x, 27.0]], 0.55), HERON_GOLD),
  part(shape([x + 0.4, 26.8, 0], [x + 1.1, 27.2, 0], [x - 2.1, 27.2, 0], [x - 0.3, 26.8, 0]), HERON_GOLD),
];
/** Its body over its legs: the S of its neck, a black crest, a dagger bill, its wing folded down the middle, its legs on one fastener. */
const HERON_BODY: Piece[] = [
  // The long dark flight feathers, notched, under the wing's end.
  part(shape([11.4, 16.0], [14.4, 15.8], [15.95, 17.3, 0], [15.3, 18.2, 0], [14.8, 17.8, 0.3], [14.5, 18.9, 0], [13.7, 18.3, 0.3], [13.2, 19.3, 0], [11.6, 18.4]), HERON_DARK),
  part(shape([5.6, 13.6], [7.4, 11.8], [10.4, 11.8], [13.4, 13.4], [15.6, 16.6, 0], [12.8, 18.6], [9.6, 19.6], [7.0, 19.2], [5.6, 17.0]), HERON_LIGHT),
  part(shape([4.9, 4.2], [4.6, 5.8], [5.2, 7.6], [6.4, 9.2], [6.6, 10.8], [5.8, 12.6], [8.6, 12.4], [8.4, 10.6], [7.9, 8.6], [6.7, 7.2], [6.4, 5.8], [7.0, 4.4]), HERON_LIGHT),
  // A dark streak down the front of its neck, cut as one thin wedge.
  flat(shape([4.85, 5.0, 0], [5.15, 5.3], [5.55, 7.3], [6.55, 8.9], [6.75, 10.6, 0], [6.25, 9.2], [5.25, 7.6], [4.8, 6.0]), HERON_DARK),
  // The plumes on its breast, cut to points.
  part(shape([5.4, 12.0], [7.4, 11.8], [7.8, 14.4], [7.3, 17.2, 0], [6.8, 16.1, 0.4], [6.2, 17.7, 0], [5.7, 16.4, 0.4], [5.0, 17.1, 0], [4.8, 14.4]), HERON_LIGHT),
  part(shape([7.4, 13.0], [9.6, 12.0], [12.6, 12.8], [15.0, 15.0], [15.9, 17.2, 0], [13.2, 18.0], [10.4, 18.4], [8.2, 17.4], [7.2, 15.2]), HERON_GREY),
  flat(shape([7.4, 13.0], [9.6, 12.0], [12.6, 12.8], [15.0, 15.0], [15.9, 17.2, 0], [12.4, 15.7], [9.4, 15.1], [7.3, 14.8, 0]), HERON_LIT),
  ...pin(9.7, 18.7),
  part(oval(5.7, 3.4, 1.7, 1.35), HERON_LIGHT),
  flat(shape([4.9, 3.0, 0], [6.2, 2.5], [7.8, 2.55], [10.9, 3.9, 0], [7.6, 3.05], [6.2, 3.15], [5.0, 3.3, 0]), INK),
  part(shape([4.5, 2.95, 0], [0.2, 3.75, 0], [4.5, 4.05, 0]), HERON_GOLD),
  flat(oval(5.3, 3.35, 0.4), HERON_GOLD),
  flat(oval(5.3, 3.35, 0.22), INK),
];
/** A tall grey heron standing still, looking left at the water, on its folded foot. */
export const HERON: Cutout = { w: 16, h: 28, pieces: [tab(6.0, 12.0, 28), ...heronLeg(9.0), ...heronLeg(10.4), ...HERON_BODY] };
/** Mid-step: the near leg lifted on its fastener, bent back at the heel, its toes hanging. */
export const HERON_STEP: Cutout = {
  w: 16,
  h: 28,
  pieces: [tab(6.0, 12.0, 28), ...heronLeg(9.0), part(limb([[10.0, 18.4], [12.2, 22.4], [11.2, 25.0], [10.0, 25.9]], 0.55), HERON_GOLD), ...HERON_BODY],
};

// ---- Moth ----
const MOTH = "#f4ecd4";
const MOTH_SHADE = "#d9cba8";
const MOTH_BODY = "#4a3c2e";
/** A pale moth, wings open in a broad V, a dark spot cut on each. */
export const MOTH_OPEN: Cutout = {
  w: 11,
  h: 7,
  pieces: [
    line("M5.3 2 Q4.6 0.8 3.6 0.4 M5.7 2 Q6.4 0.8 7.4 0.4", MOTH_BODY, 0.3),
    part(shape([5.4, 3.0], [3.2, 3.6], [1.8, 5.4], [2.8, 6.7, 0], [4.6, 6.2], [5.4, 4.8]), MOTH_SHADE),
    part(shape([5.6, 3.0], [7.8, 3.6], [9.2, 5.4], [8.2, 6.7, 0], [6.4, 6.2], [5.6, 4.8]), MOTH_SHADE),
    part(shape([5.4, 2.0], [3.0, 1.5], [0.3, 2.4, 0], [1.0, 4.2], [3.2, 5.3], [5.4, 4.4]), MOTH),
    part(shape([5.6, 2.0], [8.0, 1.5], [10.7, 2.4, 0], [10.0, 4.2], [7.8, 5.3], [5.6, 4.4]), MOTH),
    flat(oval(2.6, 3.3, 0.45), MOTH_SHADE),
    flat(oval(8.4, 3.3, 0.45), MOTH_SHADE),
    part(shape([5.5, 1.7], [6.0, 2.6], [5.9, 4.8], [5.5, 6.6, 0], [5.1, 4.8], [5.0, 2.6]), MOTH_BODY),
  ],
};
/** Wings up and shut, folded down the middle: the half toward the light is lighter. */
export const MOTH_CLOSED: Cutout = {
  w: 11,
  h: 7,
  pieces: [
    line("M5.3 2 Q4.6 0.8 3.6 0.4 M5.7 2 Q6.4 0.8 7.4 0.4", MOTH_BODY, 0.3),
    part(shape([5.5, 6.6, 0], [4.3, 4.8], [4.4, 2.2, 0], [6.6, 2.2, 0], [6.7, 4.8]), MOTH_SHADE),
    flat(shape([5.5, 6.6, 0], [4.3, 4.8], [4.4, 2.2, 0], [5.5, 2.2, 0]), MOTH),
    part(limb([[5.5, 1.8], [5.5, 2.8]], 0.6), MOTH_BODY),
  ],
};

// ---- The 2D strip only ----
const WORM = "#eaa29a";
const WORM_DARK = "#cc7c72";
/** A pink worm asleep on the soil, head on the right, eye shut: its rings are thin cuts a shade darker. */
export const WORM_ASLEEP: Cutout = {
  w: 20,
  h: 6,
  pieces: [
    part(shape([0.6, 3.4, 0.6], [1.6, 2.2], [3.4, 2.4], [5.6, 3.6], [8.6, 4.0], [12.0, 3.4], [15.2, 2.4], [17.4, 1.0], [19.4, 2.4], [19.0, 4.4], [16.4, 4.8], [12.4, 5.4], [8.4, 5.8], [5.0, 5.4], [2.8, 4.2], [1.4, 4.4]), WORM),
    flat(shape([14.2, 2.8, 0], [15.0, 2.5, 0], [15.6, 4.9, 0], [14.8, 5.0, 0]), WORM_DARK),
    ...[6.4, 8.6, 10.8].map((x) => flat(shape([x, 3.8, 0], [x + 0.55, 3.85, 0], [x + 0.55, 5.75, 0], [x, 5.7, 0]), WORM_DARK)),
    line("M17.0 2.6 Q17.6 3.2 18.3 2.6", INK, 0.3),
  ],
};
const ZINC = "#8aa6bc";
const ZINC_LIT = "#aac0d0";
const ZINC_DARK = "#5f7c94";
/** A small zinc watering can, spout up and to the left. Not a visitor: just there. */
export const WATERING_CAN: Cutout = {
  w: 18,
  h: 11,
  pieces: [
    part(limb([[7.6, 3.8], [8.0, 1.5], [10.1, 0.6], [12.2, 1.5], [12.6, 3.8]], 0.75), ZINC_DARK),
    part(limb([[16.0, 5.0], [17.3, 5.6], [17.3, 7.2], [16.0, 7.8]], 0.65), ZINC_DARK),
    part(limb([[7.4, 8.6], [2.3, 3.0]], 0.85), ZINC),
    part(shape([0.3, 1.7, 0], [2.0, 0.8, 0], [3.1, 2.8, 0], [1.3, 3.7, 0]), ZINC_DARK),
    part(shape([6.4, 3.6, 0], [16.4, 3.6, 0], [16.0, 10.7, 0], [6.8, 10.7, 0]), ZINC),
    // Rolled round: the side toward the light is lighter, and a band of seam near its foot.
    flat(shape([6.4, 3.6, 0], [9.2, 3.6, 0], [9.3, 10.7, 0], [6.8, 10.7, 0]), ZINC_LIT),
    part(shape([6.7, 9.3, 0], [16.1, 9.3, 0], [16.0, 10.7, 0], [6.8, 10.7, 0]), ZINC_DARK),
  ],
};

// ---- Mole ----
const FUR = "#4f4650";
const FUR_LIT = "#685e6a";
const PAW = "#f2bcae";
const SNOUT = "#e8949c";
/** A pink spade of a paw at (x, y), its three claws cut down; `deg` turns it on its wrist. */
const paw = (x: number, y: number, deg: number): Piece =>
  turned([part(shape([x - 1.9, y + 0.1], [x - 1.5, y - 0.9], [x, y - 1.1], [x + 1.5, y - 0.9], [x + 1.9, y + 0.1, 0], [x + 1.25, y + 0.35, 0.3], [x + 1.0, y + 1.0, 0], [x + 0.35, y + 0.5, 0.3], [x, y + 1.15, 0], [x - 0.35, y + 0.5, 0.3], [x - 1.0, y + 1.0, 0], [x - 1.25, y + 0.35, 0.3]), PAW)], x, y, deg)[0];
/** Its head, a round dome from (x0, bottom) to (x1, bottom), its top at `top`, folded down the middle: the lit half lighter. */
const moleHead = (x0: number, x1: number, bottom: number, top: number): Piece[] => {
  const mid = (x0 + x1) / 2;
  const dome: Pt[] = [[x0, bottom, 0], [x0 - 0.1, bottom - (bottom - top) * 0.55], [mid - (x1 - x0) * 0.3, top + 0.4], [mid, top]];
  return [
    part(shape(...dome, [mid + (x1 - x0) * 0.3, top + 0.4], [x1 + 0.1, bottom - (bottom - top) * 0.55], [x1, bottom, 0]), FUR),
    flat(shape(...dome, [mid, bottom, 0]), FUR_LIT),
  ];
};
/** Its face: two small dark eyes and a pink snout, `dy` down. */
const moleFace = (x: number, y: number): Piece[] => [
  flat(oval(x - 1.7, y - 1.3, 0.38), INK),
  flat(oval(x + 1.7, y - 1.3, 0.38), INK),
  part(shape([x - 1.0, y - 0.3], [x, y - 0.75], [x + 1.0, y - 0.3], [x + 0.4, y + 0.6], [x - 0.4, y + 0.6]), SNOUT),
];
/** A mole looking up out of its hole, holding one seed. */
export const MOLE: Cutout = {
  w: 14,
  h: 13,
  pieces: [
    part(shape([2.2, 13, 0], [3.0, 10.4], [7, 9.4], [11.0, 10.4], [11.8, 13, 0]), FUR),
    ...moleHead(2.4, 11.6, 8.2, 0.4),
    ...moleFace(7, 5),
    part(oval(7, 9.3, 0.8, 1.1), "#e0b860"),
    paw(3.6, 8.7, 0),
    paw(10.4, 8.7, 0),
  ],
};
const EARTH = "#6a4a34";
const EARTH_DARK = "#56392a";
const CLOD = "#86664a";
/** A small clod of earth at (x, y): a few straight cuts. */
const clod = (x: number, y: number, r: number, color: string): Piece => flat(shape([x - r, y + r * 0.3, 0], [x - r * 0.3, y - r, 0], [x + r, y - r * 0.4, 0], [x + r * 0.5, y + r * 0.8, 0]), color);
/** Its molehill (16×5): damp earth, darker than the path, the side away from the light in shade. */
const MOLEHILL: Piece[] = [
  part(shape([0.3, 5, 0], [3.4, 1.6], [8, 0.2], [12.6, 1.6], [15.7, 5, 0]), EARTH),
  flat(shape([8, 0.2], [12.6, 1.6], [15.7, 5, 0], [10.4, 5, 0], [9.4, 2.6]), EARTH_DARK),
  clod(3.4, 3.6, 0.6, CLOD),
  clod(6.6, 1.6, 0.5, CLOD),
  clod(9.8, 3.4, 0.55, EARTH),
];
/** What is above the hill (16 wide, `h` high), standing on it. */
const molehill = (h: number, above: Piece[]): Cutout => ({ w: 16, h: h + 5, pieces: [...moved(MOLEHILL, 0, h), ...above] });
const HOLE = flat(oval(8, 8.3, 3.6, 0.7), "#2e2016");
const MOLE_HEAD = moleHead(3.8, 12.2, 8.4, 0.4);
/** Just the hill: rising before it looks out, or left as it goes. */
export const MOLE_HILL = molehill(0, []);
/** Up out of its hill, paws on the edge, looking at nobody. */
export const MOLE_UP = molehill(8, [HOLE, ...MOLE_HEAD, ...moleFace(8, 4.8), paw(4, 7.6, 0), paw(12, 7.6, 0)]);
/** Caught: big eyes, mouth open, paws up. */
export const MOLE_PANIC = molehill(8, [
  HOLE,
  part(limb([[4.6, 6], [2, 2.4]], 1.1), FUR),
  part(limb([[11.4, 6], [14, 2.4]], 1.1), FUR),
  ...MOLE_HEAD,
  flat(oval(6.2, 3.4, 1.05), "#fff8ec"),
  flat(oval(9.8, 3.4, 1.05), "#fff8ec"),
  flat(oval(6.3, 3.5, 0.45), INK),
  flat(oval(9.7, 3.5, 0.45), INK),
  part(shape([7.0, 4.8], [8, 4.4], [9.0, 4.8], [8.4, 5.7], [7.6, 5.7]), SNOUT),
  flat("M7.1 6.4 C7.1 7.5 8.9 7.5 8.9 6.4 Z", "#2e2016"),
  paw(1.8, 1.6, 160),
  paw(14.2, 1.6, 200),
]);
/** The top of its head, going down. */
const MOLE_TOP = moleHead(4.2, 11.8, 5.4, 2.1);
/** Digging back down, fast: half in, earth flying (two frames, the earth in different places). */
export const MOLE_DIG = molehill(5, [clod(2.6, 0.6, 0.5, CLOD), clod(13.6, 0.5, 0.5, EARTH), clod(4.6, 1.6, 0.45, EARTH), clod(11.4, 1.5, 0.45, CLOD), clod(2.6, 2.6, 0.45, EARTH), ...MOLE_TOP]);
export const MOLE_DIG_2 = molehill(5, [clod(1.6, 0.5, 0.5, EARTH), clod(13.8, 0.6, 0.5, CLOD), clod(3.6, 1.5, 0.45, CLOD), clod(12.6, 1.6, 0.45, EARTH), clod(13.8, 2.6, 0.45, EARTH), ...MOLE_TOP]);

// ---- Goat ----
const GOAT_WHITE = "#efe7d6";
const GOAT_LIT = "#faf6ec";
const GOAT_SHADE = "#cfc3aa";
const HORN = "#b8976a";
const HOOF = "#5a4a3a";
/** A leg, its top at (x, y), its hoof on the ground in a cut-out 17.2 high (the folded foot is under it). */
const goatLeg = (x: number, y: number, color: string): Piece[] => [
  part(shape([x, y], [x + 2.0, y], [x + 1.6, 13.4], [x + 1.55, 16.5, 0], [x + 0.45, 16.5, 0], [x + 0.4, 13.4]), color),
  part(shape([x + 0.4, 16.3, 0], [x + 1.6, 16.3, 0], [x + 1.75, 17.2, 0], [x + 1.05, 17.2, 0], [x + 1.0, 16.8, 0], [x + 0.95, 17.2, 0], [x + 0.25, 17.2, 0]), HOOF),
];
/** A white goat, side on, head to the left: its barrel body folded along its side, horns curved back, a beard, an ear folded out. */
export const GOAT: Cutout = {
  w: 21,
  h: 18,
  pieces: [
    tab(4.2, 18.6, 18),
    ...goatLeg(5.0, 10.6, GOAT_SHADE),
    ...goatLeg(15.0, 10.8, GOAT_SHADE),
    part(shape([18.0, 8.4, 0], [19.6, 6.2, 0], [19.4, 8.6, 0]), GOAT_WHITE),
    // Its neck, up from the chest.
    part(shape([4.8, 11.2], [4.0, 8.6], [4.4, 6.0], [6.4, 4.6], [8.0, 6.4], [8.8, 8.6], [9.2, 10.4]), GOAT_WHITE),
    part(shape([5.4, 9.6], [6.8, 7.6], [9.6, 7.0], [13.0, 7.3], [16.4, 7.1], [18.4, 7.4], [19.6, 9.2], [19.1, 11.4], [17.0, 12.0], [14.2, 11.5], [11.0, 12.3], [7.4, 12.3], [5.6, 11.2]), GOAT_WHITE),
    // The lit side above the fold.
    flat(shape([5.4, 9.6], [6.8, 7.6], [9.6, 7.0], [13.0, 7.3], [16.4, 7.1], [18.4, 7.4], [19.6, 9.2, 0], [15.0, 9.7], [10.0, 9.9], [5.5, 10.4, 0]), GOAT_LIT),
    ...goatLeg(6.6, 10.8, GOAT_WHITE),
    part(shape([15.4, 9.6], [18.4, 9.6], [19.0, 11.4], [18.1, 13.6], [17.65, 16.5, 0], [16.55, 16.5, 0], [16.6, 14.2], [16.1, 12.2]), GOAT_WHITE),
    part(shape([16.5, 16.3, 0], [17.7, 16.3, 0], [17.85, 17.2, 0], [17.15, 17.2, 0], [17.1, 16.8, 0], [17.05, 17.2, 0], [16.35, 17.2, 0]), HOOF),
    part(shape([4.6, 3.6, 0], [5.0, 1.8], [6.6, 0.5], [8.9, 0.6, 0], [7.0, 1.3], [6.0, 2.5], [5.9, 3.7, 0]), HORN),
    part(shape([2.4, 3.8], [4.6, 3.0], [6.6, 3.6], [7.2, 5.0], [6.0, 6.4], [3.6, 7.2], [1.4, 7.4, 0.4], [0.8, 6.4], [1.2, 5.0]), GOAT_WHITE),
    part(shape([2.2, 7.0], [3.6, 6.9], [3.1, 9.4, 0], [2.6, 8.6, 0.3], [2.1, 9.1, 0]), GOAT_SHADE),
    // The ear, out sideways, folded along its length: its under half shows a shade darker.
    part(shape([6.0, 4.0, 0], [8.2, 3.7], [9.8, 4.4, 0], [8.2, 5.1], [6.2, 5.1, 0]), GOAT_SHADE),
    part(shape([6.0, 4.0, 0], [8.2, 3.7], [9.8, 4.4, 0], [8.0, 4.5], [6.1, 4.6, 0]), GOAT_LIT),
    flat(oval(1.3, 5.9, 0.32), "#d8a090"),
    flat(oval(3.8, 4.7, 0.55, 0.45), "#d8a84a"),
    flat(oval(3.8, 4.7, 0.42, 0.13), INK),
  ],
};

// ---- The note pinned up in the strip ----
/** A gardener's note pinned up, unread (#654): paper with pencil lines, its corner folded over, held by a red pin, a little crooked. */
export const NOTE_PIN: Cutout = {
  w: 11,
  h: 13,
  pieces: [
    part(shape([1.4, 3, 0], [9.4, 2.4, 0], [10, 12.4, 0], [2.4, 12.7, 0]), "#fbf3df"),
    line("M2.6 4.8 L7.6 4.5 M2.7 6.6 L8 6.3 M2.9 8.4 L6.4 8.2 M3 10.2 L8 10", "#9aa6b4", 0.4),
    // Its corner, folded over: the back of the paper, a shade darker.
    part(shape([8.4, 12.46, 0], [10, 12.4, 0], [9.9, 10.8, 0]), "#e2d6ba"),
    part(oval(5.4, 1.5, 1.2), "#c24a3a"),
    flat(oval(5, 1.1, 0.4), "#f08070"),
  ],
};

/** Garden words (#209) whose visitor has art so far. The rest arrive with their art (#209 phase B). The fish comes in its bowl. */
export const GARDEN_VISITOR_ART: Partial<Record<GardenWord, Cutout>> = { cat: CAT_AWAKE, bird: BIRD, frog: FROG, snail: SNAIL, dog: DOG, fish: FISHBOWL, butterfly: BUTTERFLY };
