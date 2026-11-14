// Draws word plants (ui/plant.tsx) straight onto a 2D canvas, the way the
// browser draws the same SVG, for the walk's plant sprites (#459). It walks
// Plant's React elements and draws each shape with Path2D, so it runs in a
// worker (spriteWorker.ts): a browser cannot draw SVG off the main thread,
// and drawing 2000 plants there blocks the page for seconds on a slow laptop.

import { createElement, Fragment, isValidElement, type ReactNode } from "react";
import { Plant, type Stage } from "../ui/plant";

/** SVG units per sprite: the same frame for every plant keeps sizes comparable. */
const VIEW_W = 100;
export const VIEW_H = 200;

export interface SpritePlant {
  lemma: string;
  growth: number;
  stage: Stage;
}

/** The SVG attributes Plant uses. Any other one throws, so a new one is drawn on purpose, not skipped. */
const KNOWN = new Set(["children", "transform", "opacity", "d", "cx", "cy", "r", "rx", "ry", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeOpacity"]);

type Props = Record<string, unknown>;
const num = (v: unknown) => Number(v);

/** An SVG transform list: translate, rotate (about a point too) and scale, the ones Plant writes. */
function transform(ctx: OffscreenCanvasRenderingContext2D, list: string) {
  for (const [, name, args] of list.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const a = args.trim().split(/[\s,]+/).map(Number);
    if (name === "translate") ctx.translate(a[0], a[1] ?? 0); // SVG: no y is 0
    else if (name === "scale") ctx.scale(a[0], a[1] ?? a[0]); // SVG: no y is the same as x
    else if (name === "rotate") {
      const [deg, cx = 0, cy = 0] = a; // SVG: no point turns about the origin
      ctx.translate(cx, cy);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    } else throw new Error(`plantCanvas: transform ${name} is not drawn`);
  }
}

/**
 * The smallest marks the walk keeps wherever they fall on the pixel grid, in
 * pixels: it cuts a sprite at half alpha (scenePlants.ts). Smaller ones covered
 * less than half of every pixel: a small sprite lost its 0.6 px stems and a
 * spike's top buds, and the plant seemed to grow when its full-size sprite came in (#1109).
 */
const MIN_LINE_PX = 1.25;
const MIN_DOT_PX = 1.75;

/** Pixels per unit here: Plant only scales evenly, so the transform's determinant is its square. */
function pxPerUnit(ctx: OffscreenCanvasRenderingContext2D) {
  const m = ctx.getTransform();
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
}

/**
 * Fill, then stroke, with SVG's defaults: a black fill, no stroke, a stroke 1 wide with butt caps and a miter limit of 4.
 * For a sprite the walk cuts, a line with no fill, such as a stem, is never narrower than MIN_LINE_PX. An outline on a
 * fill may thin away: the fill keeps the shape, and a wider outline would darken a small flower.
 */
function paint(ctx: OffscreenCanvasRenderingContext2D, shape: Path2D, p: Props, alpha: number, cut: boolean) {
  const fill = p.fill === undefined ? "black" : String(p.fill);
  if (fill !== "none") {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fill(shape);
  }
  if (p.stroke !== undefined && p.stroke !== "none") {
    ctx.globalAlpha = alpha * (p.strokeOpacity === undefined ? 1 : num(p.strokeOpacity));
    ctx.strokeStyle = String(p.stroke);
    const width = p.strokeWidth === undefined ? 1 : num(p.strokeWidth);
    ctx.lineWidth = cut && fill === "none" ? Math.max(width, MIN_LINE_PX / pxPerUnit(ctx)) : width;
    ctx.lineCap = p.strokeLinecap === undefined ? "butt" : (String(p.strokeLinecap) as CanvasLineCap);
    ctx.lineJoin = "miter";
    ctx.miterLimit = 4;
    ctx.stroke(shape);
  }
}

/**
 * Draws a React node of SVG shapes. Opacity multiplies down a group: the same
 * as SVG's group opacity unless shapes in the group overlap. The walk draws
 * whole stages only, where the one group with an opacity (a golden glow) has it at 1.
 * For a sprite the walk cuts, a circle or an ellipse is never less than MIN_DOT_PX across.
 */
function draw(ctx: OffscreenCanvasRenderingContext2D, node: ReactNode, alpha: number, cut: boolean) {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const n of node) draw(ctx, n, alpha, cut);
    return;
  }
  if (!isValidElement<Props>(node)) throw new Error(`plantCanvas: cannot draw ${String(node)}`);
  const { type, props } = node;
  if (type === Fragment) return draw(ctx, props.children as ReactNode, alpha, cut);
  // Plant's parts are plain functions of their props, with no hooks: call them.
  if (typeof type === "function") return draw(ctx, (type as (p: Props) => ReactNode)(props), alpha, cut);
  for (const k of Object.keys(props)) if (!KNOWN.has(k)) throw new Error(`plantCanvas: ${String(type)} ${k} is not drawn`);
  ctx.save();
  if (props.transform !== undefined) transform(ctx, String(props.transform));
  const a = alpha * (props.opacity === undefined ? 1 : num(props.opacity));
  const cx = props.cx === undefined ? 0 : num(props.cx); // SVG: no centre is the origin
  const cy = props.cy === undefined ? 0 : num(props.cy);
  if (type === "g") draw(ctx, props.children as ReactNode, a, cut);
  else if (type === "path") paint(ctx, new Path2D(String(props.d)), props, a, cut);
  else if (type === "circle") {
    const s = new Path2D();
    const least = cut ? MIN_DOT_PX / 2 / pxPerUnit(ctx) : 0;
    s.arc(cx, cy, Math.max(num(props.r), least), 0, Math.PI * 2);
    paint(ctx, s, props, a, cut);
  } else if (type === "ellipse") {
    const s = new Path2D();
    const least = cut ? MIN_DOT_PX / 2 / pxPerUnit(ctx) : 0;
    s.ellipse(cx, cy, Math.max(num(props.rx), least), Math.max(num(props.ry), least), 0, 0, Math.PI * 2);
    paint(ctx, s, props, a, cut);
  } else throw new Error(`plantCanvas: <${String(type)}> is not drawn`);
  ctx.restore();
}

/**
 * One plant at `scale`, its frame (VIEW_W × VIEW_H at scale 1) from the current origin, its foot 4 above the frame's bottom.
 * `cut`: the walk keeps only its pixels of half alpha or more, so no mark is drawn too small to keep.
 */
function drawPlant(ctx: OffscreenCanvasRenderingContext2D, p: SpritePlant, scale: number, cut: boolean) {
  ctx.translate((VIEW_W / 2) * scale, (VIEW_H - 4) * scale);
  draw(ctx, createElement(Plant, { word: p.lemma, growth: p.growth, stage: p.stage, scale }), 1, cut);
}

/** Where plantPng's sprite sits, in SVG units about the plant's foot: whole device pixels, so it is drawn 1:1. */
export function spriteBox(scale: number, dpr: number) {
  return { x: (-VIEW_W / 2) * scale, y: -(VIEW_H - 4) * scale, width: Math.ceil(VIEW_W * scale * dpr) / dpr, height: Math.ceil(VIEW_H * scale * dpr) / dpr };
}

/**
 * One plant for the garden strip (#486), drawn at the strip's scale (Plant's
 * strokes do not scale with it) and `dpr` device pixels per SVG unit, as a PNG.
 * Soft edges, unlike the walk's: it stands in for the same plant drawn as SVG.
 */
export function plantPng(p: SpritePlant, scale: number, dpr: number): Promise<Blob> {
  const box = spriteBox(scale, dpr);
  const c = new OffscreenCanvas(Math.round(box.width * dpr), Math.round(box.height * dpr));
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  // Every mark at its true size: the strip shows soft edges and cuts nothing away.
  drawPlant(ctx, p, scale, false);
  return c.convertToBlob();
}

/** The 4 sides first, then the corners. */
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const;

/**
 * Gives every empty pixel (alpha 0) the colour of the nearest drawn one, still empty. A texture filtered smooth mixes
 * an edge pixel with its empty neighbours, and its mipmaps mix in empty pixels further out; a canvas leaves those
 * black, so the edge got a dark rim (#1051), worse far off. A fill out from the drawing, one ring at a time.
 */
export function bleedEdges(d: Uint8Array | Uint8ClampedArray, w: number, h: number) {
  const queue = new Int32Array(w * h);
  const coloured = new Uint8Array(w * h);
  let tail = 0;
  for (let p = 0; p < w * h; p++)
    if (d[p * 4 + 3] !== 0) {
      coloured[p] = 1;
      queue[tail++] = p;
    }
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    const x = p % w;
    const y = (p - x) / w;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (coloured[q]) continue;
      coloured[q] = 1;
      d[q * 4] = d[p * 4];
      d[q * 4 + 1] = d[p * 4 + 1];
      d[q * 4 + 2] = d[p * 4 + 2];
      queue[tail++] = q;
    }
  }
}

/**
 * Plants in a grid of `cols`, each in a cell of w × h pixels, as premultiplied
 * RGBA with soft edges. The walk filters them smooth, with mipmaps (#1091):
 * premultiplied colours average right, so an edge gets no dark rim.
 */
export function drawPlants(plants: SpritePlant[], cols: number, w: number, h: number): ImageData {
  const c = new OffscreenCanvas(Math.min(plants.length, cols) * w, Math.ceil(plants.length / cols) * h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  plants.forEach((p, i) => {
    ctx.save();
    // Each plant is clipped to its own cell, and its frame scaled to fit (viewBox -50 -196 100 200).
    ctx.beginPath();
    ctx.rect((i % cols) * w, Math.floor(i / cols) * h, w, h);
    ctx.clip();
    ctx.translate((i % cols) * w, Math.floor(i / cols) * h);
    ctx.scale(w / VIEW_W, h / VIEW_H);
    drawPlant(ctx, p, 1, true);
    ctx.restore();
  });
  const data = ctx.getImageData(0, 0, c.width, c.height);
  premultiply(data.data);
  return data;
}

/** getImageData gives each pixel's colour unpremultiplied: this multiplies it by the pixel's alpha again. @internal Exported for tests. */
export function premultiply(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    d[i] *= a;
    d[i + 1] *= a;
    d[i + 2] *= a;
  }
}

/**
 * The next mipmap level of premultiplied RGBA, w × h with both even: each pixel
 * the mean of a 2 × 2 square. A cell with even sides stays apart from its neighbours.
 */
export function halve(d: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h / 2; y++)
    for (let x = 0; x < w / 2; x++) {
      const i = (2 * y * w + 2 * x) * 4;
      const j = i + w * 4;
      const o = (y * (w / 2) + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = (d[i + c] + d[i + 4 + c] + d[j + c] + d[j + 4 + c] + 2) >> 2;
    }
  return out;
}
