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

/** Fill, then stroke, with SVG's defaults: a black fill, no stroke, a stroke 1 wide with butt caps and a miter limit of 4. */
function paint(ctx: OffscreenCanvasRenderingContext2D, shape: Path2D, p: Props, alpha: number) {
  const fill = p.fill === undefined ? "black" : String(p.fill);
  if (fill !== "none") {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fill(shape);
  }
  if (p.stroke !== undefined && p.stroke !== "none") {
    ctx.globalAlpha = alpha * (p.strokeOpacity === undefined ? 1 : num(p.strokeOpacity));
    ctx.strokeStyle = String(p.stroke);
    ctx.lineWidth = p.strokeWidth === undefined ? 1 : num(p.strokeWidth);
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
 */
function draw(ctx: OffscreenCanvasRenderingContext2D, node: ReactNode, alpha: number) {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const n of node) draw(ctx, n, alpha);
    return;
  }
  if (!isValidElement<Props>(node)) throw new Error(`plantCanvas: cannot draw ${String(node)}`);
  const { type, props } = node;
  if (type === Fragment) return draw(ctx, props.children as ReactNode, alpha);
  // Plant's parts are plain functions of their props, with no hooks: call them.
  if (typeof type === "function") return draw(ctx, (type as (p: Props) => ReactNode)(props), alpha);
  for (const k of Object.keys(props)) if (!KNOWN.has(k)) throw new Error(`plantCanvas: ${String(type)} ${k} is not drawn`);
  ctx.save();
  if (props.transform !== undefined) transform(ctx, String(props.transform));
  const a = alpha * (props.opacity === undefined ? 1 : num(props.opacity));
  const cx = props.cx === undefined ? 0 : num(props.cx); // SVG: no centre is the origin
  const cy = props.cy === undefined ? 0 : num(props.cy);
  if (type === "g") draw(ctx, props.children as ReactNode, a);
  else if (type === "path") paint(ctx, new Path2D(String(props.d)), props, a);
  else if (type === "circle") {
    const s = new Path2D();
    s.arc(cx, cy, num(props.r), 0, Math.PI * 2);
    paint(ctx, s, props, a);
  } else if (type === "ellipse") {
    const s = new Path2D();
    s.ellipse(cx, cy, num(props.rx), num(props.ry), 0, 0, Math.PI * 2);
    paint(ctx, s, props, a);
  } else throw new Error(`plantCanvas: <${String(type)}> is not drawn`);
  ctx.restore();
}

/** One plant at `scale`, its frame (VIEW_W × VIEW_H at scale 1) from the current origin, its foot 4 above the frame's bottom. */
function drawPlant(ctx: OffscreenCanvasRenderingContext2D, p: SpritePlant, scale: number) {
  ctx.translate((VIEW_W / 2) * scale, (VIEW_H - 4) * scale);
  draw(ctx, createElement(Plant, { word: p.lemma, growth: p.growth, stage: p.stage, scale }), 1);
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
  drawPlant(ctx, p, scale);
  return c.convertToBlob();
}

/**
 * Plants in a grid of `cols`, each in a cell of w × h pixels, as unpremultiplied
 * RGBA. Hard alpha edges, so the sprites look hand-pixelled rather than
 * blurry: a soft edge pixel already has its full colour.
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
    drawPlant(ctx, p, 1);
    ctx.restore();
  });
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] < 110 ? 0 : 255;
  return data;
}
