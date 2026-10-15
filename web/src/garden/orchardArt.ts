// The orchard's trees as pixel art (#315), in the style of the trees outside
// the fence (textures.ts trees()): one atlas, a 96×128 cell per kind and look.
// The shapes are plain data, so the orchard's hit boxes follow the drawing.

import { ORCHARD_WORDS, type OrchardWord } from "../deck/schema";
import { rng } from "../lib/seed";
import { canvas, px } from "./textures";

export const CELL_W = 96;
export const CELL_H_PX = 128;
/** Atlas rows, top to bottom. */
export const LOOKS = ["leaves", "blossom", "fruit"] as const;

type Fruit = {
  /** round: 3 px; small: 2 px (olives); pair: cherries on a stem; drop: a pear; bunch: grapes; nest: the plain tree's bird nest. */
  shape: "round" | "small" | "pair" | "drop" | "bunch" | "nest";
  /** Light and dark colour. */
  color: [string, string];
  count: number;
};

/** A tree drawn as blobs of leaves ([dx from the middle, y of the middle, radius], in pixels) on a trunk, or a vine on a trellis. */
export interface TreeShape {
  blobs: [number, number, number][];
  trunk: { top: number; w: number };
  /** Light, mid and dark leaves. */
  leaf: [string, string, string];
  /** Flower colours, scattered on the crown in blossom. */
  blossom: string[];
  fruit: Fruit;
  trellis?: true;
}

const GREEN: [string, string, string] = ["#7cc35e", "#58a145", "#3d7a35"];
const DEEP: [string, string, string] = ["#5fae4e", "#3f8a3c", "#2b6330"];

export const TREE_SHAPES: Record<OrchardWord, TreeShape> = {
  // A plain big tree; in its "fruit" look a small nest sits in it.
  tree: { blobs: [[-22, 58, 20], [22, 56, 20], [0, 34, 28], [0, 62, 22]], trunk: { top: 70, w: 9 }, leaf: GREEN, blossom: ["#d8e89a", "#c4dc7c"], fruit: { shape: "nest", color: ["#a8784a", "#6e4a2a"], count: 1 } },
  apple: { blobs: [[-22, 66, 18], [22, 64, 18], [0, 42, 26], [0, 68, 20]], trunk: { top: 78, w: 7 }, leaf: GREEN, blossom: ["#fff4f6", "#ffc8d8"], fruit: { shape: "round", color: ["#e2473a", "#a82a24"], count: 18 } },
  orange: { blobs: [[-16, 60, 20], [16, 60, 20], [0, 40, 26]], trunk: { top: 76, w: 6 }, leaf: DEEP, blossom: ["#ffffff", "#fff3cf"], fruit: { shape: "round", color: ["#ffa53a", "#d9741a"], count: 16 } },
  lemon: { blobs: [[-15, 62, 18], [15, 62, 18], [0, 44, 24]], trunk: { top: 76, w: 6 }, leaf: ["#8ccc62", "#62a847", "#447f36"], blossom: ["#ffffff", "#f6ecff"], fruit: { shape: "round", color: ["#fbe55a", "#d4b52a"], count: 15 } },
  cherry: { blobs: [[-24, 62, 18], [24, 62, 18], [0, 40, 26], [-10, 30, 16]], trunk: { top: 76, w: 7 }, leaf: GREEN, blossom: ["#ffd1e3", "#f4a4c4", "#fff0f6"], fruit: { shape: "pair", color: ["#d0243a", "#86121f"], count: 14 } },
  pear: { blobs: [[-12, 70, 16], [12, 70, 16], [0, 48, 20], [0, 26, 20]], trunk: { top: 82, w: 7 }, leaf: GREEN, blossom: ["#ffffff", "#f3f0e2"], fruit: { shape: "drop", color: ["#c9dc5a", "#8fa636"], count: 13 } },
  plum: { blobs: [[-18, 62, 19], [18, 62, 19], [0, 40, 25]], trunk: { top: 78, w: 7 }, leaf: ["#78b85a", "#559845", "#3a7234"], blossom: ["#ffffff", "#fbefff"], fruit: { shape: "round", color: ["#8a4fb0", "#56287a"], count: 16 } },
  fig: { blobs: [[-26, 64, 16], [26, 64, 16], [0, 52, 24], [-10, 40, 16], [12, 40, 16]], trunk: { top: 74, w: 8 }, leaf: ["#6aa84c", "#4a8a3a", "#2f6428"], blossom: ["#a4c86a", "#8cb456"], fruit: { shape: "round", color: ["#7a4a72", "#4a2a46"], count: 12 } },
  olive: { blobs: [[-22, 60, 16], [22, 58, 16], [0, 46, 22], [8, 32, 14]], trunk: { top: 70, w: 8 }, leaf: ["#b4c494", "#8fa36a", "#6a7d4c"], blossom: ["#f6f1d4", "#e8e2b4"], fruit: { shape: "small", color: ["#4e5a32", "#2c321c"], count: 24 } },
  // A vine on a trellis: two posts and two rails, leaves along the top rail.
  grape: { blobs: [[-30, 58, 10], [-10, 56, 11], [10, 56, 11], [30, 58, 10], [-20, 70, 8], [20, 70, 8]], trunk: { top: 70, w: 4 }, leaf: GREEN, blossom: ["#d8e89a", "#e8f0b4"], fruit: { shape: "bunch", color: ["#7a52b4", "#4a2c7a"], count: 7 }, trellis: true },
  peach: { blobs: [[-18, 62, 18], [18, 62, 18], [0, 42, 25]], trunk: { top: 78, w: 7 }, leaf: ["#80c460", "#5ca046", "#3e7a34"], blossom: ["#ffb8d0", "#f48aae", "#ffe0ec"], fruit: { shape: "round", color: ["#ffb27a", "#e8705a"], count: 15 } },
};

/** The trellis posts stand this far either side of the middle, from this row down. */
const TRELLIS = { half: 40, top: 54 };

/** The drawn crown: half its width (cell widths) and its top (cell heights from the bottom), for the hit boxes. */
export function crownBox(kind: OrchardWord): { half: number; top: number } {
  const s = TREE_SHAPES[kind];
  let half = Math.max(...s.blobs.map(([dx, , r]) => Math.abs(dx) + r));
  let top = Math.min(...s.blobs.map(([, cy, r]) => cy - r));
  if (s.trellis) {
    half = Math.max(half, TRELLIS.half + 1);
    top = Math.min(top, TRELLIS.top);
  }
  return { half: half / CELL_W, top: (CELL_H_PX - top) / CELL_H_PX };
}

/** Every kind in every look: a column per kind (in ORCHARD_WORDS order), a row per look (LOOKS). */
export function orchardAtlas(): HTMLCanvasElement {
  const [c, ctx] = canvas(CELL_W * ORCHARD_WORDS.length, CELL_H_PX * LOOKS.length);
  ORCHARD_WORDS.forEach((kind, col) =>
    LOOKS.forEach((look, row) => {
      const s = TREE_SHAPES[kind];
      const ox = col * CELL_W;
      const oy = row * CELL_H_PX;
      const mid = CELL_W / 2;
      // The same seed in every look, so blossom and fruit sit on the very same tree.
      const r = rng(70 + col);
      // Draws in the cell's own pixels.
      const p = (x: number, y: number, color: string, w = 1, h = 1) => px(ctx, ox + x, oy + y, color, w, h);
      if (s.trellis) {
        for (const sx of [-1, 1]) p(mid + sx * TRELLIS.half - 1, TRELLIS.top, "#8a6440", 3, CELL_H_PX - TRELLIS.top);
        p(mid - TRELLIS.half, TRELLIS.top + 2, "#a37a52", TRELLIS.half * 2, 2);
        p(mid - TRELLIS.half, TRELLIS.top + 22, "#a37a52", TRELLIS.half * 2, 2);
      }
      // The trunk, lit from the left like the trees outside the fence.
      const tw = s.trunk.w;
      p(mid - tw / 2, s.trunk.top, "#7a5233", tw, CELL_H_PX - s.trunk.top);
      p(mid - tw / 2, s.trunk.top, "#946540", 1, CELL_H_PX - s.trunk.top);
      p(mid + tw / 2 - 1, s.trunk.top, "#5c3b22", 1, CELL_H_PX - s.trunk.top);
      // The crown: blobs of three shades, light from the top left, with speckle. Its pixels are kept for the flowers and fruit.
      const crown = new Set<number>();
      for (const [dx, cy, rad] of s.blobs)
        for (let y = -rad; y <= rad; y++)
          for (let x = -rad; x <= rad; x++) {
            const d = Math.hypot(x, y * 1.1) + r() * 1.6;
            if (d > rad) continue;
            const light = (-x - y) / rad;
            const i = light > 0.45 ? 0 : light > -0.3 ? 1 : 2;
            const X = mid + dx + x;
            const Y = cy + y;
            p(X, Y, r() < 0.08 ? s.leaf[Math.min(2, i + 1)] : s.leaf[i]);
            crown.add(Y * CELL_W + X);
          }
      // Spots well inside the crown, in a fixed order for this tree.
      const inner = [...crown].filter((k) => [3, -3, CELL_W * 3, -CELL_W * 3].every((o) => crown.has(k + o)));
      const spot = () => {
        const k = inner[Math.floor(r() * inner.length)];
        return [k % CELL_W, Math.floor(k / CELL_W)];
      };
      if (look === "blossom")
        for (let i = 0; i < 90; i++) {
          const [x, y] = spot();
          p(x, y, s.blossom[i % s.blossom.length], i % 2 ? 1 : 2, i % 4 ? 1 : 2);
        }
      if (look === "fruit") {
        const f = s.fruit;
        const [light, dark] = f.color;
        for (let i = 0; i < f.count; i++) {
          const [x, y] = spot();
          if (f.shape === "round" || f.shape === "small") {
            const n = f.shape === "round" ? 3 : 2;
            p(x, y, dark, n, n);
            p(x, y, light, n - 1, n - 1);
          } else if (f.shape === "pair") {
            p(x + 1, y - 2, "#4e7a2a", 1, 2);
            p(x, y, dark, 2, 2);
            p(x + 2, y + 1, light, 2, 2);
          } else if (f.shape === "drop") {
            p(x, y, light, 1, 1);
            p(x - 1, y + 1, light, 3, 2);
            p(x + 1, y + 2, dark, 1, 1);
          } else if (f.shape === "bunch") {
            for (let k = 0; k < 4; k++) p(x - 3 + k, y + k * 2, k % 2 ? dark : light, 7 - k * 2, 2);
          } else {
            p(x - 5, y, dark, 11, 2);
            p(x - 4, y - 1, light, 9, 1);
            p(x - 2, y - 2, "#f4efe2", 2, 1);
          }
        }
      }
    }),
  );
  return c;
}
