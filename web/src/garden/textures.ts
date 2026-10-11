// Tiny procedural pixel-art textures, drawn on canvases and shown with
// nearest-neighbour filtering: the look of a mid-90s 3D game.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { Plant } from "../ui/plant";
import type { PlacedPlant } from "./world";
import * as Art from "./visitorArt";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export function pixelTexture(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const px = (ctx: CanvasRenderingContext2D, x: number, y: number, color: string, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

/** Speckled ground: base colour plus a scatter of lighter and darker pixels. */
function speckle(seed: number, base: string, dots: [string, number][], size = 32): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  const r = rng(seed);
  px(ctx, 0, 0, base, size, size);
  for (const [color, n] of dots) for (let i = 0; i < n; i++) px(ctx, Math.floor(r() * size), Math.floor(r() * size), color);
  return c;
}

export function grass(): HTMLCanvasElement {
  const c = speckle(1, "#5fa44a", [
    ["#4e9140", 110],
    ["#72b85a", 80],
    ["#8ccc6a", 18],
  ]);
  const ctx = c.getContext("2d")!;
  const r = rng(7);
  // Little tufts and the odd daisy.
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(r() * 30);
    const y = Math.floor(r() * 30) + 1;
    px(ctx, x, y, "#3f7d36");
    px(ctx, x + 1, y - 1, "#3f7d36");
    px(ctx, x + 2, y, "#3f7d36");
  }
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(r() * 30) + 1;
    const y = Math.floor(r() * 30) + 1;
    px(ctx, x, y, "#fff8e7");
    px(ctx, x + 1, y, "#fff8e7");
    px(ctx, x, y + 1, "#fff8e7");
    px(ctx, x + 1, y + 1, "#ffd25a");
  }
  return c;
}

export function path(): HTMLCanvasElement {
  const c = speckle(2, "#d9bf8c", [
    ["#cbb07c", 140],
    ["#e6d1a3", 70],
    ["#b29767", 30],
  ]);
  const ctx = c.getContext("2d")!;
  const r = rng(8);
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(r() * 30);
    const y = Math.floor(r() * 30);
    px(ctx, x, y, "#a9a29a", 2, 1);
    px(ctx, x, y + 1, "#8a847c", 2, 1);
  }
  return c;
}

export function soil(): HTMLCanvasElement {
  return speckle(3, "#6b4630", [
    ["#5a3a27", 160],
    ["#7d5640", 90],
    ["#3f281b", 40],
  ]);
}

export function wood(): HTMLCanvasElement {
  const [c, ctx] = canvas(32, 16);
  const r = rng(4);
  px(ctx, 0, 0, "#b07a45", 32, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) if (r() < 0.18) px(ctx, x, y, r() < 0.5 ? "#9d6a3a" : "#bf8a53");
  // Two planks with a dark seam, a highlight on top, and a knot.
  px(ctx, 0, 7, "#6e4524", 32, 1);
  px(ctx, 0, 15, "#6e4524", 32, 1);
  px(ctx, 0, 0, "#cf9c66", 32, 1);
  px(ctx, 0, 8, "#cf9c66", 32, 1);
  px(ctx, 11, 3, "#7c4f2a", 2, 2);
  px(ctx, 24, 11, "#7c4f2a", 2, 2);
  return c;
}

export function picket(): HTMLCanvasElement {
  const [c, ctx] = canvas(32, 32);
  for (let i = 0; i < 4; i++) {
    const x = i * 8 + 2;
    px(ctx, x, 6, "#f4ecdc", 4, 26);
    px(ctx, x + 1, 4, "#f4ecdc", 2, 2);
    px(ctx, x + 3, 6, "#d6cbb5", 1, 26);
  }
  px(ctx, 0, 11, "#e9dfca", 32, 3);
  px(ctx, 0, 24, "#e9dfca", 32, 3);
  px(ctx, 0, 14, "#c4b89f", 32, 1);
  px(ctx, 0, 27, "#c4b89f", 32, 1);
  return c;
}

export interface Sky {
  top: string;
  mid: string;
  horizon: string;
  fog: string;
  tint: [number, number, number];
}

export const SKIES: Record<"day" | "dusk" | "night", Sky> = {
  day: { top: "#5aa8f0", mid: "#8cc8f7", horizon: "#d4efff", fog: "#cbe8f6", tint: [1, 1, 1] },
  dusk: { top: "#4b4f9c", mid: "#b77aa8", horizon: "#ffc28f", fog: "#e9b7a0", tint: [1, 0.86, 0.8] },
  night: { top: "#070b26", mid: "#18204d", horizon: "#33407a", fog: "#1d2550", tint: [0.42, 0.5, 0.78] },
};

/** A banded sky gradient for the inside of the sky dome, retro style: no smooth blend. */
export function sky(s: Sky, stars: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(64, 64);
  const bands = 12;
  const top = new THREE.Color(s.top);
  const mid = new THREE.Color(s.mid);
  const hor = new THREE.Color(s.horizon);
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const col = t < 0.5 ? top.clone().lerp(mid, t * 2) : mid.clone().lerp(hor, (t - 0.5) * 2);
    // v=0 is the bottom of the texture in three.js; top rows are the zenith.
    px(ctx, 0, Math.floor((i / bands) * 64), `#${col.getHexString()}`, 64, Math.ceil(64 / bands));
  }
  if (stars) {
    const r = rng(11);
    for (let i = 0; i < 70; i++) px(ctx, Math.floor(r() * 64), Math.floor(r() * 34), r() < 0.2 ? "#fff6c8" : "#c9d3ff");
  }
  return c;
}

/** Two layers of rolling hills with dithered edges, for a ring around the world. */
export function hills(night: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(256, 64);
  const layers: [string, string, number, number][] = night
    ? [
        ["#2a3566", "#24305d", 30, 1],
        ["#1c2a4c", "#182444", 42, 2],
      ]
    : [
        ["#9ccfa0", "#8fc595", 30, 1],
        ["#6fae6a", "#64a160", 42, 2],
      ];
  for (const [color, shade, base, seed] of layers) {
    const r = rng(seed);
    const ph = r() * 10;
    for (let x = 0; x < 256; x++) {
      // Periodic in x so the ring repeats without a seam.
      const a = (x / 256) * Math.PI * 2;
      const h = base - 9 * Math.sin(a * 2 + ph) - 5 * Math.sin(a * 5 + ph * 2) - 2 * Math.sin(a * 11 + ph);
      const y0 = Math.floor(h);
      px(ctx, x, y0, color, 1, 64 - y0);
      for (let y = y0 + 2; y < 64; y += 3) if ((x + y) % 4 === 0) px(ctx, x, y, shade);
      if (x % 2 === 0) px(ctx, x, y0 - 1, color);
    }
  }
  return c;
}

/** Trees and bushes for outside the fence: one atlas, 4 cells of 64×128. */
export function trees(): HTMLCanvasElement {
  const [c, ctx] = canvas(256, 128);
  const blob = (r: () => number, cx: number, cy: number, rad: number, colors: string[]) => {
    for (let y = -rad; y <= rad; y++)
      for (let x = -rad; x <= rad; x++) {
        const d = Math.hypot(x, y * 1.1) + r() * 1.6;
        if (d > rad) continue;
        // Light from the top left, three shades plus speckle.
        const light = (-x - y) / rad;
        const i = light > 0.45 ? 0 : light > -0.3 ? 1 : 2;
        px(ctx, cx + x, cy + y, r() < 0.08 ? colors[Math.min(2, i + 1)] : colors[i]);
      }
  };
  const trunk = (cx: number, top: number, w: number) => {
    px(ctx, cx - w / 2, top, "#7a5233", w, 128 - top);
    px(ctx, cx - w / 2, top, "#5c3b22", 1, 128 - top);
    px(ctx, cx + w / 2 - 1, top, "#946540", 1, 128 - top);
  };
  // 0: round oak
  let r = rng(21);
  trunk(32, 70, 6);
  blob(r, 22, 58, 14, ["#7cc35e", "#58a145", "#3d7a35"]);
  blob(r, 42, 56, 15, ["#7cc35e", "#58a145", "#3d7a35"]);
  blob(r, 32, 40, 17, ["#7cc35e", "#58a145", "#3d7a35"]);
  // 1: pine
  r = rng(22);
  trunk(96, 100, 4);
  for (let i = 0; i < 5; i++) {
    const y = 18 + i * 17;
    const w = 7 + i * 5;
    for (let yy = 0; yy < 20; yy++) {
      const half = Math.floor((yy / 20) * w);
      for (let x = -half; x <= half; x++) px(ctx, 96 + x, y + yy, x < -half / 3 ? "#3f8a5a" : x > half / 2 ? "#245a3d" : r() < 0.1 ? "#2f7049" : "#2f7a4d");
    }
  }
  // 2: blossom tree
  r = rng(23);
  trunk(160, 74, 6);
  blob(r, 148, 58, 14, ["#ffd1e3", "#f4a4c4", "#d97aa3"]);
  blob(r, 172, 58, 13, ["#ffd1e3", "#f4a4c4", "#d97aa3"]);
  blob(r, 160, 42, 16, ["#ffd1e3", "#f4a4c4", "#d97aa3"]);
  // 3: bush with berries
  r = rng(24);
  blob(r, 214, 112, 14, ["#6fb556", "#4f9441", "#367233"]);
  blob(r, 236, 114, 12, ["#6fb556", "#4f9441", "#367233"]);
  for (let i = 0; i < 9; i++) px(ctx, 204 + Math.floor(r() * 40), 104 + Math.floor(r() * 16), "#e2474b");
  return c;
}

export function cloud(): HTMLCanvasElement {
  const [c, ctx] = canvas(64, 32);
  const r = rng(31);
  const puffs = [
    [18, 20, 10],
    [32, 14, 13],
    [46, 20, 10],
    [28, 22, 9],
  ];
  for (const [cx, cy, rad] of puffs)
    for (let y = -rad; y <= rad; y++)
      for (let x = -rad; x <= rad; x++) if (Math.hypot(x, y) + r() * 1.2 <= rad && cy + y < 30) px(ctx, cx + x, cy + y, y > rad * 0.35 ? "#dfe9f5" : "#ffffff");
  return c;
}

/** A butterfly in two frames (wings open, wings closed), side by side. */
export function butterfly(hue: number): HTMLCanvasElement {
  const [c, ctx] = canvas(16, 8);
  const wing = `hsl(${hue} 85% 65%)`;
  const dark = `hsl(${hue} 70% 42%)`;
  // open
  px(ctx, 1, 1, wing, 3, 3);
  px(ctx, 4, 1, wing, 3, 3);
  px(ctx, 2, 4, dark, 2, 2);
  px(ctx, 4, 4, dark, 2, 2);
  px(ctx, 3, 1, "#2b2230", 2, 5);
  // closed
  px(ctx, 11, 1, wing, 2, 4);
  px(ctx, 11, 5, dark, 2, 1);
  px(ctx, 13, 1, "#2b2230", 1, 5);
  return c;
}

/** A wooden sign board with a label, in a chunky pixel font size. */
export function sign(label: string): HTMLCanvasElement {
  const [c, ctx] = canvas(128, 40);
  px(ctx, 0, 0, "#7a4f2c", 128, 40);
  px(ctx, 2, 2, "#c99257", 124, 36);
  px(ctx, 2, 2, "#ddb07a", 124, 2);
  px(ctx, 2, 20, "#b8834b", 124, 1);
  ctx.fillStyle = "#3b2414";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 16;
  do ctx.font = `bold ${size}px ui-monospace, Menlo, monospace`;
  while (ctx.measureText(label).width > 116 && --size > 7);
  ctx.fillText(label, 64, 21);
  crispText(ctx, 128, 40);
  return c;
}

/** Threshold anti-aliased text on a sign so it stays crisp pixels. */
function crispText(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const dark = img.data[i] < 140;
    if (dark) {
      img.data[i] = 0x3b;
      img.data[i + 1] = 0x24;
      img.data[i + 2] = 0x14;
    } else if (img.data[i] < 190) {
      img.data[i] = 0xc9;
      img.data[i + 1] = 0x92;
      img.data[i + 2] = 0x57;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** A taller notice board for a short sentence: up to two lines, as large as fits. */
export function notice(text: string): HTMLCanvasElement {
  const W = 160;
  const H = 64;
  const [c, ctx] = canvas(W, H);
  px(ctx, 0, 0, "#7a4f2c", W, H);
  px(ctx, 2, 2, "#c99257", W - 4, H - 4);
  px(ctx, 2, 2, "#ddb07a", W - 4, 2);
  px(ctx, 2, H / 2, "#b8834b", W - 4, 1);
  ctx.fillStyle = "#3b2414";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const font = (size: number) => (ctx.font = `bold ${size}px ui-monospace, Menlo, monospace`);
  const fits = (lines: string[]) => lines.every((l) => ctx.measureText(l).width <= W - 14);
  // Every way to break the words into one or two lines; keep the one with the biggest text.
  const words = text.split(" ");
  const options = [[text], ...words.slice(1).map((_, i) => [words.slice(0, i + 1).join(" "), words.slice(i + 1).join(" ")])];
  let best = { size: 0, lines: [text] };
  for (const lines of options)
    for (let size = lines.length === 1 ? 22 : 18; size > 7; size--) {
      font(size);
      if (fits(lines)) {
        // At the same size, two balanced lines read better than one long and one short.
        const longest = (ls: string[]) => Math.max(...ls.map((l) => l.length));
        if (size > best.size || (size === best.size && lines.length === best.lines.length && longest(lines) < longest(best.lines))) best = { size, lines };
        break;
      }
    }
  font(best.size || 8);
  const step = best.size + 4;
  best.lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + 1 + (i - (best.lines.length - 1) / 2) * step));
  crispText(ctx, W, H);
  return c;
}

export function water(): HTMLCanvasElement {
  const c = speckle(5, "#4f9fd6", [
    ["#62b2e4", 90],
    ["#3e88c0", 70],
  ]);
  const ctx = c.getContext("2d")!;
  const r = rng(9);
  for (let i = 0; i < 6; i++) px(ctx, Math.floor(r() * 28), Math.floor(r() * 30), "#bfe6ff", 3, 1);
  return c;
}

export function lilypad(): HTMLCanvasElement {
  const [c, ctx] = canvas(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const notch = x > 7 && Math.abs(y - 7.5) < (x - 7) * 0.5;
      if (d < 7 && !notch) px(ctx, x, y, d > 5.5 ? "#3f8f3a" : "#5fb24c");
    }
  px(ctx, 5, 5, "#ff9cc4", 2, 2);
  return c;
}

/** A small pixel arrow that bobs over the selected plant. */
export function marker(): HTMLCanvasElement {
  const [c, ctx] = canvas(16, 16);
  const rows = [
    "...######...",
    "...#ffff#...",
    "...#ffff#...",
    "####ffff####",
    ".#ffffffff#.",
    "..#ffffff#..",
    "...#ffff#...",
    "....#ff#....",
    ".....##.....",
  ];
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== "." && px(ctx, x + 2, y + 3, ch === "#" ? "#5a2a12" : "#ffd84a")));
  return c;
}

// ---- Word plants --------------------------------------------------------
//
// Two levels of detail. Every plant has a small sprite in a "low" sheet,
// drawn from one big SVG per sheet (one decode for up to 2048 plants). The
// plants near you also get a full-size sprite in a fixed pool of slots,
// streamed in batches as you walk.

export const ATLAS = 2048;
/** SVG units per sprite: the same frame for every plant keeps sizes comparable. */
export const VIEW_W = 100;
export const VIEW_H = 200;
export const LOW_W = 32;
export const LOW_H = 64;
export const LOW_COLS = ATLAS / LOW_W;
export const LOW_PER_SHEET = LOW_COLS * (ATLAS / LOW_H);
export const HI_W = 96;
export const HI_H = 192;
export const HI_COLS = Math.floor(ATLAS / HI_W);
export const HI_SLOTS = HI_COLS * Math.floor(ATLAS / HI_H);
const BATCH_COLS = 8;
export const BATCH = BATCH_COLS * 3;

function plantMarkup(p: PlacedPlant): string {
  return renderToStaticMarkup(createElement(Plant, { word: p.lemma, growth: p.growth, stage: p.stage, scale: 1 }));
}

/** A nested <svg> per cell clips each plant to its own cell. */
const cell = (p: PlacedPlant, x: number, y: number, w: number, h: number) =>
  `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${-VIEW_W / 2} ${-VIEW_H + 4} ${VIEW_W} ${VIEW_H}">${plantMarkup(p)}</svg>`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function rasterise(width: number, height: number, body: string): Promise<HTMLCanvasElement> {
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`)}`);
  const [c, ctx] = canvas(width, height);
  ctx.drawImage(img, 0, 0);
  // Hard alpha edges, so the sprites look hand-pixelled rather than blurry.
  // getImageData is not premultiplied, so a soft edge pixel already has its full colour.
  const data = ctx.getImageData(0, 0, width, height);
  const d = data.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] < 110 ? 0 : 255;
  ctx.putImageData(data, 0, 0);
  return c;
}

/** Small sprites for every plant: one sheet per 2048 plants, only as tall as needed. */
export async function lowSheets(plants: PlacedPlant[]): Promise<HTMLCanvasElement[]> {
  const sheets: HTMLCanvasElement[] = [];
  for (let start = 0; start < plants.length; start += LOW_PER_SHEET) {
    const chunk = plants.slice(start, start + LOW_PER_SHEET);
    const rows = Math.ceil(chunk.length / LOW_COLS);
    const h = Math.min(ATLAS, 2 ** Math.ceil(Math.log2(Math.max(LOW_H, rows * LOW_H))));
    const body = chunk.map((p, i) => cell(p, (i % LOW_COLS) * LOW_W, Math.floor(i / LOW_COLS) * LOW_H, LOW_W, LOW_H)).join("");
    sheets.push(await rasterise(ATLAS, h, body));
  }
  return sheets;
}

/** Full-size sprites for up to BATCH plants, in a grid of BATCH_COLS. */
export function highBatch(plants: PlacedPlant[]): Promise<HTMLCanvasElement> {
  const body = plants.map((p, i) => cell(p, (i % BATCH_COLS) * HI_W, Math.floor(i / BATCH_COLS) * HI_H, HI_W, HI_H)).join("");
  return rasterise(BATCH_COLS * HI_W, Math.ceil(plants.length / BATCH_COLS) * HI_H, body);
}

export const batchCell = (i: number) => ({ x: (i % BATCH_COLS) * HI_W, y: Math.floor(i / BATCH_COLS) * HI_H });

// ---- Decorations ----------------------------------------------------------

/** Ground decorations, one atlas of 4 cells of 32×64: tuft, wildflowers, mushrooms, stone. */
export function decor(): HTMLCanvasElement {
  const [c, ctx] = canvas(128, 64);
  const r = rng(41);
  // 0: grass tuft
  for (let i = 0; i < 9; i++) {
    const x = 9 + i * 1.6;
    const h = 8 + Math.floor(r() * 10);
    const lean = (i - 4) * 0.5;
    for (let y = 0; y < h; y++) px(ctx, Math.round(x + (lean * y) / h), 63 - y, y > h - 3 ? "#8ccc6a" : i % 2 ? "#4e9140" : "#5fa44a");
  }
  // 1: wildflowers
  for (let i = 0; i < 5; i++) {
    const x = 36 + i * 5 + Math.floor(r() * 3);
    const h = 9 + Math.floor(r() * 14);
    px(ctx, x, 64 - h, "#4e9140", 1, h);
    const col = ["#fff8e7", "#ffd25a", "#c9a3ff", "#ff9cc4", "#9fd4ff"][i];
    px(ctx, x - 1, 63 - h, col, 3, 1);
    px(ctx, x, 62 - h, col, 1, 3);
    px(ctx, x, 63 - h, "#f0a020");
  }
  // 2: mushrooms. Plain brown on purpose: the red, spotted toadstool is a
  // visitor with a name (visitors.ts), and decor never looks like a visitor.
  const shroom = (x: number, w: number, h: number) => {
    px(ctx, x - 1, 64 - h, "#ece2cf", 3, h);
    for (let y = 0; y < Math.ceil(w / 2); y++) px(ctx, x - w / 2 + y, 64 - h - y, y === 0 ? "#8a5a3c" : "#a8714a", w - y * 2, 1);
  };
  shroom(74, 10, 6);
  shroom(84, 7, 4);
  // 3: stone
  for (let y = 0; y < 8; y++)
    for (let x = -9; x <= 9; x++) if (Math.hypot(x / 9, (y - 7) / 8) < 1) px(ctx, 112 + x, 63 - y, y > 5 ? "#c9c3b8" : x > 3 ? "#8a847c" : "#a9a29a");
  return c;
}

/** A garden lantern on a post, lit (right) and unlit (left), 16×48 each. */
export function lantern(): HTMLCanvasElement {
  const [c, ctx] = canvas(32, 48);
  for (const [ox, lit] of [
    [0, false],
    [16, true],
  ] as const) {
    px(ctx, ox + 7, 14, "#3b2a20", 2, 34);
    px(ctx, ox + 4, 3, "#2b2230", 8, 2);
    px(ctx, ox + 5, 1, "#2b2230", 6, 2);
    px(ctx, ox + 4, 5, "#2b2230", 1, 8);
    px(ctx, ox + 11, 5, "#2b2230", 1, 8);
    px(ctx, ox + 5, 5, lit ? "#ffe9a0" : "#8d8a7a", 6, 8);
    if (lit) px(ctx, ox + 6, 7, "#fffbe0", 4, 4);
    px(ctx, ox + 4, 13, "#2b2230", 8, 1);
  }
  return c;
}

/** A pixel "z" for the sleeping bloom (#62), pale with a dark edge so it shows on the night sky. */
export function snoreZ(): HTMLCanvasElement {
  const rows = ["oooooooo", "oZZZZZZo", "ooooZZoo", "..oZZo..", ".oZZo...", "ooZZoooo", "oZZZZZZo", "oooooooo"];
  const [c, ctx] = canvas(8, 8);
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch !== "." && px(ctx, x, y, ch === "Z" ? "#eef2ff" : "#2a2f4a")));
  return c;
}

/** A soft round glow in a few hard rings, for additive light pools and halos. */
export function glow(): HTMLCanvasElement {
  const [c, ctx] = canvas(32, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5) / 16;
      // Ordered dithering at the edge keeps the retro look.
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y % 4) * 4 + (x % 4)] / 16;
      const v = Math.max(0, 1 - d);
      const level = Math.floor(v * 4 + bayer * 0.9) / 4;
      if (level > 0) px(ctx, x, y, `rgba(255, 200, 110, ${level * 0.55})`);
    }
  return c;
}

export function sun(kind: "day" | "dusk" | "night"): HTMLCanvasElement {
  const [c, ctx] = canvas(32, 32);
  const [core, rim] = kind === "night" ? ["#fff6d8", "#d9d2b8"] : kind === "dusk" ? ["#ffd28a", "#ff9b5e"] : ["#fffbe6", "#ffe58a"];
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5);
      if (d < 11) px(ctx, x, y, d > 9 ? rim : core);
      // A crescent: carve out an offset disc.
      if (kind === "night" && Math.hypot(x - 20, y - 12) < 9) ctx.clearRect(x, y, 1, 1);
    }
  if (kind === "night") {
    px(ctx, 10, 14, "#cfc8ac", 2, 2);
    px(ctx, 13, 21, "#cfc8ac", 3, 2);
  }
  return c;
}

/**
 * The sunflower, two frames of 32×64 side by side: its face (left, a small
 * calm smile) and the back of its head (right). No text.
 */
export function sunflower(): HTMLCanvasElement {
  const [c, ctx] = canvas(64, 64);
  for (const [ox, face] of [
    [0, true],
    [32, false],
  ] as const) {
    const r = rng(51); // the same ragged petals on both sides
    // Stem and two leaves.
    px(ctx, ox + 15, 22, "#3f7d36", 2, 42);
    px(ctx, ox + 16, 22, "#4e9140", 1, 42);
    for (let i = 0; i < 6; i++) {
      const col = i < 4 ? "#5fa44a" : "#4e9140";
      px(ctx, ox + 13 - i, 46 - Math.floor(i / 2), col, 2, 2);
      px(ctx, ox + 17 + i, 38 - Math.floor(i / 2), col, 2, 2);
    }
    // Petals: a ragged ring, lit from the top left.
    const cx = ox + 15.5;
    const cy = 12.5;
    for (let y = 0; y < 26; y++)
      for (let x = ox; x < ox + 32; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy);
        const edge = 11 + Math.cos(Math.atan2(dy, dx) * 10) * 1.6 + r() * 0.6;
        if (d > edge || d < 6) continue;
        const light = (-dx - dy) / d;
        const shade = light > 0.3 ? 0 : light > -0.4 ? 1 : 2;
        px(ctx, x, y, (face ? ["#ffe066", "#f8c537", "#e0a020"] : ["#e8c040", "#d0a028", "#b08018"])[shade]);
      }
    for (let y = 0; y < 26; y++)
      for (let x = ox; x < ox + 32; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d >= 7.5) continue;
        if (face) px(ctx, x, y, d > 6.2 ? "#5a3216" : r() < 0.2 ? "#8a5428" : "#6e4020");
        else {
          // The green back of the head, with bracts in a star.
          const a = Math.atan2(y - cy, x - cx);
          px(ctx, x, y, Math.cos(a * 8) > 0.6 && d > 3 ? "#3f7d36" : d > 6.2 ? "#36692e" : "#5a9a48");
        }
      }
    if (face) {
      // Closed, content eyes, rosy cheeks and a small calm smile.
      const ink = "#2b1608";
      px(ctx, ox + 12, 10, ink, 2, 1);
      px(ctx, ox + 18, 10, ink, 2, 1);
      for (const x of [11, 14, 17, 20]) px(ctx, ox + x, 11, ink);
      px(ctx, ox + 11, 13, "#d0603a");
      px(ctx, ox + 20, 13, "#d0603a");
      px(ctx, ox + 13, 15, ink);
      px(ctx, ox + 14, 16, ink, 4, 1);
      px(ctx, ox + 18, 15, ink);
    } else px(ctx, ox + 15, 13, "#3f7d36", 2, 9); // the stem joins the middle of the back
  }
  return c;
}


// ---- Visitors ---------------------------------------------------------------

/** Visitor cells (32×32 each, standing on the bottom row), in this order. */
export const VISITOR_CELL = {
  snail: 0,
  catAsleep: 1,
  catAwake: 2,
  toadstool: 3,
  bird: 4,
  birdHop: 5,
  frog: 6,
  frogCroak: 7,
  frogAsleep: 8,
  gnomeFront: 9,
  gnomeSide: 10,
  /** The same two poses with the lantern lit, for dusk and night. */
  gnomeFrontLit: 11,
  gnomeSideLit: 12,
  heron: 13,
  heronStep: 14,
  mothOpen: 15,
  mothClosed: 16,
} as const;
export const VISITOR_CELLS = 17;

/** The garden visitors in one small atlas (drawn once), in VISITOR_CELL order. */
export function visitors(): HTMLCanvasElement {
  const [c, ctx] = canvas(32 * VISITOR_CELLS, 32);
  const poses = ["front", "side"] as const;
  [
    Art.SNAIL,
    Art.CAT_ASLEEP,
    Art.CAT_AWAKE,
    Art.TOADSTOOL,
    Art.BIRD,
    Art.BIRD_HOP,
    Art.FROG,
    Art.FROG_CROAK,
    Art.FROG_ASLEEP,
    ...poses.map((p) => Art.gnomeArt(p, false)),
    ...poses.map((p) => Art.gnomeArt(p, true)),
    Art.HERON,
    Art.HERON_STEP,
    Art.MOTH_OPEN,
    Art.MOTH_CLOSED,
  ].forEach((art, i) => {
    const w = art.rows[0].length;
    const ox = i * 32 + Math.floor((32 - w) / 2);
    const oy = 32 - art.rows.length - (art === Art.BIRD_HOP ? 2 : 0);
    for (const r of Art.runs(art)) px(ctx, ox + r.x, oy + r.y, r.fill, r.w, 1);
  });
  return c;
}
