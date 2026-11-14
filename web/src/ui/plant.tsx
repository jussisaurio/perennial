// Procedural plants: every word grows its own, seeded by the word itself, so
// "casa" looks the same in the garden, on its cards, and on every device.
// Growth follows memory stability: sprout → bud → bloom.
//
// Each plant is cut from coloured paper (docs/art-direction.md, "Plants"): a
// few bold pieces, each one flat colour with a lighter half where it is folded
// toward the light (from the upper left), stacked back to front. No outlines.

// No React Compiler: plantCanvas.ts calls these components as plain functions in
// the sprite worker, outside React, and compiled ones need React's hook state there.
"use no memo";

import { memo, type ReactNode } from "react";
import { OLD_S, plantStage, type PlantStage } from "../core/memory";
import { growthOf, leanDeg, stageLabel, type GardenPlant } from "../garden/plants";
import { hash01, hash32, rng } from "../lib/seed";
import { GOLD_COLOURS as GOLD, meaningOf, sizeOf } from "./meaning";
import { bent, Cut, disc, hsl, lightness, line, mirrored, place, then, tone, type Affine, type Outline } from "./plantShapes";

const pick = <T,>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)];
const between = (r: () => number, a: number, b: number) => a + r() * (b - a);

type FlowerType = "daisy" | "star" | "cup" | "bell" | "cluster" | "spike" | "pom";
type LeafShape = "oval" | "lance" | "round" | "heart";
type PetalShape = "round" | "pointed" | "long";

interface Genome {
  flower: FlowerType;
  petals: number;
  petalShape: PetalShape;
  petal: string; // colour
  /** The petals' shaded side, a shade darker. */
  petalEdge: string;
  /** A closed bud: green, from the leaf hue, so the flower's colour is a surprise until it blooms (#207). */
  bud: string;
  /** The green cup (sepals) a bud sits in. */
  budEdge: string;
  center: string;
  leafShape: LeafShape;
  leaves: number;
  opposite: boolean;
  leaf: string;
  stem: string;
  curve: number; // -1..1
  height: number; // 0.75..1.2
  branches: number; // side stems with their own small flowers
  lean: number; // degrees the flower head tilts
}

/** Flower colours: hue families near the app's petal tokens (index.css), soft enough for paper. */
const FAMILIES: [number, number, number, number][] = [
  // [hue min, hue max, saturation, lightness]
  [4, 16, 66, 57], // red-orange, --petal-1
  [30, 42, 80, 58], // marigold, --petal-2
  [44, 52, 76, 62], // yellow
  [330, 346, 52, 67], // pink, --petal-3
  [262, 284, 34, 64], // lavender
  [206, 218, 44, 58], // cornflower, --petal-5
  [36, 48, 40, 92], // cream, --card
];

/** A plant's height in drawing units before its genome and scale: a seedling is 14, a full-grown plant 118. */
export const stemHeight = (growth: number) => 14 + 104 * growth;

/**
 * A flower's size (its petals' reach) in drawing units at `growth`. The tallest head, a spike, reaches 2.8 times
 * this above its stem: the tallest plant (118 · 1.18 · 1.15 for "grande") plus that stays inside the sprite's
 * frame (garden/plantCanvas.ts, 196 above the foot).
 */
const flowerSize = (growth: number, scale: number) => 8 * scale * (0.85 + growth * 0.6);

/** @internal Exported for tests. */
export function genome(word: string): Genome {
  const r = rng(hash32(word.normalize("NFC").toLowerCase()));
  const [h0, h1, s, l] = pick(r, FAMILIES);
  const hue = between(r, h0, h1);
  const flower = pick(r, ["daisy", "daisy", "star", "cup", "bell", "cluster", "spike", "pom"] as const);
  // Leaf greens between --leaf and --leaf-2: muted, never a "game" green.
  const leafHue = between(r, 84, 126);
  return {
    flower,
    petals: flower === "star" ? Math.round(between(r, 5, 7)) : Math.round(between(r, 5, 13)),
    petalShape: pick(r, ["round", "pointed", "long"] as const),
    petal: hsl(hue, s, l),
    petalEdge: hsl(hue + 4, s, l - 13),
    center: pick(r, [hsl(44, 84, 56), hsl(26, 50, 32), hsl(hue, s, l - 26), hsl(48, 42, 90)]),
    leafShape: pick(r, ["oval", "lance", "round", "heart"] as const),
    leaves: Math.round(between(r, 2, 5)),
    opposite: r() > 0.6,
    leaf: hsl(leafHue, between(r, 26, 38), between(r, 42, 52)),
    // From leafHue only, with no new draws from r, so every other trait stays as it was.
    bud: hsl(leafHue + 6, 38, 56),
    budEdge: hsl(leafHue - 4, 34, 36),
    stem: hsl(leafHue - 6, 30, 36),
    curve: between(r, -1, 1),
    height: between(r, 0.78, 1.18),
    branches: r() > 0.55 ? Math.round(between(r, 1, 2)) : 0,
    lean: between(r, -18, 18),
  };
}

/**
 * Rare flowers (#208): about 1 word in 40 grows something special. It is
 * picked from the word with its own hash, so it is the same for every learner
 * and changes nothing else about the plant. It shows only once the word blooms.
 */
export type Rare = "golden" | "twin" | "bee" | "striped";
const RARE_ONE_IN = 40;
const RARE_SALT = 0x5eed;

export function rareOf(word: string): Rare | null {
  const key = word.normalize("NFC").toLowerCase();
  if (hash32(key, RARE_SALT) % RARE_ONE_IN !== 0) return null;
  // Stripes need separate petals to sit on.
  const g = genome(word);
  const kinds: readonly Rare[] = g.flower === "daisy" || g.flower === "star" ? ["golden", "twin", "bee", "striped"] : ["golden", "twin", "bee"];
  // hash01 (the high bits): the low bits of this hash are tied to the rare check above.
  return kinds[Math.floor(hash01(key, RARE_SALT + 1) * kinds.length)];
}

export type Stage = "sprout" | "bud" | "bloom";

/**
 * A plant's form as one number, so it can grow smoothly from one stage into
 * the next: 0 seed, 1 sprout, 2 bud, 3 bloom. Whole numbers draw the stages.
 */
export const FORM: Record<PlantStage, number> = { seed: 0, sprout: 1, bud: 2, bloom: 3 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Where the top of the word's stem is, where its flower sits: as Plant draws it. */
export function plantTop(word: string, growth: number, scale = 1): { x: number; y: number } {
  return stemPoint(word, growth, 1, scale);
}

/** A point `t` of the way up the word's stem (0 the root, 1 the top), as Plant draws it. */
export function stemPoint(word: string, growth: number, t: number, scale = 1): { x: number; y: number } {
  return onStem(plantHeight(word, growth, scale), genome(word).curve * 10 * scale, t);
}

/** How tall the word's stem is drawn: its growth, its genome, and a big or small meaning (#214). The one place for it. */
export function plantHeight(word: string, growth: number, scale = 1): number {
  return stemHeight(growth) * genome(word).height * sizeOf(meaningOf(word)) * scale;
}

/** Point and tangent angle on the quadratic stem curve at t (0 = base, 1 = top). */
function onStem(h: number, bend: number, t: number): { x: number; y: number; angle: number } {
  const cx = bend;
  const cy = -h / 2;
  const x = 2 * (1 - t) * t * cx;
  const y = 2 * (1 - t) * t * cy + t * t * -h;
  const dx = 2 * (1 - t) * cx - 2 * t * cx;
  const dy = 2 * (1 - t) * cy + 2 * t * (-h - cy);
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI + 90 };
}

// ---- Tones ----
// Every piece is one colour of paper; its half folded toward the light is lighter.

/** The lit side of a piece of `colour`: lighter, a little less saturated, a touch warmer. */
const lit = (colour: string) => tone(colour, 9, -6, -3);
/** Deep in the shade: a flower's heart, the inside of a cup. */
const deep = (colour: string) => tone(colour, -24, 4, 4);

// ---- Outlines ----
// Each drawn upright: its base at (0, 0), its tip up at (0, -len). `half`: only the left half, as a folded piece's one side.

/** How long a leaf of each shape is, against an oval one: a slim leaf is longer, a round one shorter. */
const LEAF_LEN: Record<LeafShape, number> = { oval: 1, lance: 1.25, round: 0.8, heart: 0.9 };

/** A leaf of `shape`, `len` long, its tip drooping by `droop`·len to the right. */
function leafOutline(shape: LeafShape, len: number, droop: number, half = false): Outline {
  const w = len * { oval: 0.3, lance: 0.15, round: 0.42, heart: 0.4 }[shape];
  const left =
    shape === "heart"
      ? // Two round lobes below the stalk, then a long point.
        [-w * 0.25, len * 0.14, -w * 0.98, len * 0.12, -w, -len * 0.2, -w, -len * 0.5, -w * 0.4, -len * 0.78, 0, -len]
      : shape === "round"
        ? [-w * 0.55, -len * 0.02, -w, -len * 0.22, -w, -len * 0.48, -w, -len * 0.78, -w * 0.35, -len * 0.9, 0, -len]
        : // Oval and lance: widest below the middle, then a knife-sharp point.
          [-w * 0.55, -len * 0.04, -w, -len * 0.18, -w, -len * 0.4, -w, -len * 0.62, -w * 0.32, -len * 0.8, 0, -len];
  return bent(mirrored(left, half), len, droop);
}

/** A petal of `shape`, `len` long and `w` across at most (each side). `notch`: a V cut into its tip. */
function petalOutline(shape: PetalShape, len: number, w: number, notch = false, half = false): Outline {
  if (shape === "pointed") return mirrored([-w * 0.6, -len * 0.12, -w, -len * 0.35, -w, -len * 0.5, -w, -len * 0.7, -w * 0.35, -len * 0.85, 0, -len], half);
  const round = [-w * 0.5, -len * 0.1, -w, -len * 0.4, -w, -len * 0.65];
  if (notch) return mirrored([...round, -w, -len * 0.88, -w * 0.75, -len, -w * 0.4, -len, ...line(-w * 0.4, -len, 0, -len * 0.88)], half);
  return mirrored([...round, -w, -len * 0.9, -w * 0.55, -len, 0, -len], half);
}

/** A closed bud, `r` the flower's size: a teardrop. */
function budOutline(r: number, half = false): Outline {
  return mirrored([-r * 0.55, -r * 0.05, -r * 0.66, -r * 0.7, -r * 0.42, -r * 1.12, -r * 0.26, -r * 1.4, -r * 0.08, -r * 1.6, 0, -r * 1.75], half);
}

/** A bell hanging from (0, 0), `s` across, its rim cut in three points. */
function bellOutline(s: number, half = false): Outline {
  return mirrored([-s * 0.42, 0, -s * 0.56, s * 0.28, -s * 0.58, s * 0.66, -s * 0.6, s * 0.92, -s * 0.72, s * 1.08, -s * 0.86, s * 1.3, ...line(-s * 0.86, s * 1.3, -s * 0.44, s * 1.1), ...line(-s * 0.44, s * 1.1, 0, s * 1.32)], half);
}

// ---- Cutting pieces ----

/** A piece and its folded half in one go: `whole` in the base colour, the half facing the light in `lit`. */
class Folded {
  readonly base = new Cut();
  readonly light = new Cut();
  /** Adds an upright piece at `m`; its left half is lit, or its right half with `right`. */
  add(whole: Outline, half: Outline, m: Affine, right = false): void {
    this.base.add(whole, m);
    this.light.add(half, right ? then(m, place(0, 0, 0, -1, 1)) : m);
  }
}

/**
 * Which half of a petal turned `deg` (0 points up) catches the light from the upper left. `cupped`: its two
 * halves fold up toward the middle (a daisy's petals); otherwise they fold down from a ridge (a star's).
 */
function rightHalfLit(deg: number, cupped: boolean): boolean {
  const a = (deg * Math.PI) / 180;
  return Math.cos(a) + Math.sin(a) > 0 === cupped;
}

/** Path elements for cuts, back to front; an empty cut draws nothing. */
function paths(list: [Cut, string][]): ReactNode {
  return list.map(([c, fill], i) => (c.count ? <path key={i} d={c.path} fill={fill} /> : null));
}

// ---- Flower heads ----
// Each around the top of its stem at (0, 0), facing up; r sets its size.

interface HeadLook {
  g: Genome;
  r: number;
  striped?: boolean;
  crazy?: boolean;
  /** The golden rare's ring of rays, behind the head. */
  rays?: boolean;
}

/** A stripe of pale paper down a petal's middle (the striped rare), white petals get a pink one. */
const stripeColour = (petal: string) => (lightness(petal) > 80 ? "hsl(350 58% 66%)" : "hsl(42 70% 95%)");
const RAY = "hsl(46 88% 78%)";

/** Where a head's middle is, in r, for its rays: some flowers sit above their stem's top. */
const HEART_Y: Record<FlowerType, number> = { daisy: 0, star: 0, pom: 0, cup: -0.95, bell: 0.2, cluster: -0.75, spike: -0.7 };

function Head({ g, r, striped = false, crazy = false, rays = false }: HeadLook): ReactNode {
  const back = new Cut();
  const front = new Folded();
  const shade = new Cut();
  const marks = new Cut();
  const heart = new Cut();
  const heartLit = new Cut();
  const stripes = new Cut();
  const stalks = new Cut();
  const ray = new Cut();

  if (rays) {
    const cy = HEART_Y[g.flower] * r;
    for (let i = 0; i < 16; i++) {
      const a = (i * 360) / 16 + 11;
      const m = then(place(0, cy, a), place(0, -r * 1.25));
      ray.add([-r * 0.16, 0, ...line(-r * 0.16, 0, 0, -r * (i % 2 ? 0.55 : 0.8)), ...line(0, -r * (i % 2 ? 0.55 : 0.8), r * 0.16, 0), ...line(r * 0.16, 0, -r * 0.16, 0)], m);
    }
  }

  /** A ring of `n` petals: each its own size and angle when "loco". */
  const ring = (cut: Cut | Folded, n: number, len: number, w: number, shape: PetalShape, turn0: number, opts: { notch?: boolean; cupped?: boolean; stripe?: boolean } = {}) => {
    for (let i = 0; i < n; i++) {
      // "loco": a fixed pattern, so the plant is the same each time.
      const wild = crazy ? ((i * 37) % 11) / 10 : 0.5;
      const turn = turn0 + (i * 360) / n + (crazy ? (wild - 0.5) * 50 : 0);
      const l = crazy ? len * (0.6 + wild * 0.8) : len;
      const m = place(0, 0, turn);
      const whole = petalOutline(shape, l, w, opts.notch);
      if (cut instanceof Folded) cut.add(whole, petalOutline(shape, l, w, opts.notch, true), m, rightHalfLit(turn, opts.cupped ?? true));
      else cut.add(whole, m);
      if (opts.stripe) stripes.add(mirrored([-w * 0.3, -l * 0.2, -w * 0.3, -l * 0.55, 0, -l * 0.7]), then(m, place(0, -l * 0.15)));
    }
  };

  switch (g.flower) {
    case "daisy": {
      // Two rings: the back one a shade darker, between the front one's petals; a raised button in the middle.
      const n = Math.max(7, g.petals);
      const len = r * 1.25;
      const w = len * Math.min(0.3, 1.5 / n);
      ring(back, n, len * 0.94, w, g.petalShape, 180 / n);
      ring(front, n, len, w, g.petalShape, 0, { notch: g.petalShape === "round", stripe: striped });
      heart.add(disc(0, 0, r * 0.4));
      heartLit.add(disc(-r * 0.1, -r * 0.1, r * 0.24));
      shade.add(disc(r * 0.05, r * 0.06, r * 0.44));
      break;
    }
    case "star": {
      // Broad pointed petals folded along a ridge, and a darker star of points between them.
      const n = g.petals;
      const len = r * 1.35;
      ring(back, n, len * 0.72, len * 0.16, "pointed", 180 / n);
      ring(front, n, len, len * Math.min(0.42, 2.2 / n), "pointed", 0, { cupped: false, stripe: striped });
      heart.add(disc(0, 0, r * 0.26));
      heartLit.add(disc(-r * 0.07, -r * 0.07, r * 0.13));
      break;
    }
    case "pom": {
      // A rosette: three rings of round petals, each smaller and lighter, cupped around a tight middle.
      ring(back, 13, r * 1.12, r * 0.34, "round", 0);
      ring(front.base, 10, r * 0.86, r * 0.3, "round", 18);
      ring(front.light, 7, r * 0.56, r * 0.24, "round", 6);
      heart.add(disc(0, 0, r * 0.17));
      break;
    }
    case "cup": {
      // A tulip seen from the side: two petals behind, one in front folded down its middle, and the inner one's tip between.
      const at = place(0, r * 0.15);
      marks.add(petalOutline("pointed", r * 2, r * 0.5), at);
      back.add(petalOutline("pointed", r * 1.9, r * 0.62), then(at, place(-r * 0.12, 0, -17)));
      back.add(petalOutline("pointed", r * 1.9, r * 0.62), then(at, place(r * 0.12, 0, 17)));
      front.add(petalOutline("pointed", r * 1.72, r * 0.8), petalOutline("pointed", r * 1.72, r * 0.8, false, true), at);
      break;
    }
    case "bell": {
      // An arched stalk, with one to three bells hanging from it; the outer ones bigger. It arches the way the head leans.
      const side = g.lean >= 0 ? 1 : -1;
      const nb = 1 + (g.petals % 3);
      const [cx, cy, ex, ey] = [side * r * 1, -r * 1.8, side * r * 2.2, -r * 0.6];
      const arch = (t: number) => ({ x: 2 * (1 - t) * t * cx + t * t * ex, y: 2 * (1 - t) * t * cy + t * t * ey });
      for (let i = 0; i < nb; i++) {
        const t = nb === 1 ? 1 : 0.42 + (i / (nb - 1)) * 0.58;
        const p = arch(t);
        // More bells, smaller ones, so they hang side by side.
        const s = r * (0.72 + 0.3 * t) * [1.1, 0.85, 0.7][nb - 1];
        stalks.add(disc(p.x, p.y + s * 0.12, s * 0.06, s * 0.18));
        front.add(bellOutline(s), bellOutline(s, true), place(p.x, p.y + s * 0.28));
      }
      return (
        <>
          <path d={`M0 0 Q ${cx} ${cy} ${ex} ${ey}`} fill="none" stroke={g.stem} strokeWidth={Math.max(0.8, r * 0.1)} strokeLinecap="round" />
          {paths([
            [ray, RAY],
            [stalks, g.stem],
            [front.base, g.petal],
            [front.light, lit(g.petal)],
          ])}
        </>
      );
    }
    case "cluster": {
      // A round dome on a darker bed, as a hydrangea: small four-petalled florets in a sunflower spiral, so no two
      // line up; the ones toward the light lit.
      const cy = -r * 0.75;
      back.add(disc(0, cy, r * 0.85, r * 0.78));
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (1.05 + (i / 8) * 0.9);
        back.add(disc(Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.68, r * 0.36));
      }
      back.add(disc(0, cy + r * 0.45, r * 0.7, r * 0.42));
      // Five to seven florets: more crowd into a blur.
      const n = 5 + (g.petals % 3);
      const s = r * 0.38;
      for (let i = 0; i < n; i++) {
        const a = i * 2.4;
        const d = Math.sqrt((i + 0.5) / n);
        const x = Math.cos(a) * d * r * 0.78;
        const y = cy + Math.sin(a) * d * r * 0.62;
        const floret = x + (y - cy) < -r * 0.15 ? front.light : front.base;
        for (let k = 0; k < 4; k++) floret.add(petalOutline("round", s, s * 0.36), place(x, y, (i * 37) % 90 + k * 90));
        heart.add(disc(x, y, s * 0.16));
      }
      break;
    }
    case "spike": {
      // A tapering spire: florets in pairs up a darker core, smaller to the top, ending in closed buds on its tip.
      back.add(mirrored([-r * 0.5, 0, -r * 0.62, -r * 0.9, -r * 0.4, -r * 2, -r * 0.2, -r * 2.8, -r * 0.06, -r * 3.25, 0, -r * 3.4]), place(0, r * 1.0));
      const rows = 7;
      for (let i = 0; i < rows; i++) {
        const y = r * 0.9 - i * r * 0.46;
        const s = r * (0.62 - i * 0.055);
        for (const side of [-1, 1]) {
          const turn = side * (62 - i * 3) + (i % 2 ? 6 : -6);
          const m = place(side * r * 0.08, y + (side > 0 ? r * 0.2 : 0), turn);
          front.add(petalOutline("round", s * 1.2, s * 0.52), petalOutline("round", s * 1.2, s * 0.52, false, true), m, side < 0);
        }
      }
      heart.add(budOutline(r * 0.3), place(0, -r * 2.05));
      break;
    }
  }

  return paths([
    [ray, RAY],
    [marks, deep(g.petal)],
    [back, g.petalEdge],
    [shade, deep(g.petal)],
    [front.base, g.petal],
    [front.light, lit(g.petal)],
    [stripes, stripeColour(g.petal)],
    [heart, g.flower === "spike" ? lit(g.petal) : g.center],
    [heartLit, lit(g.center)],
  ]);
}

/** A closed head: a teardrop in its sepals. Green for a bud; in the petals' colours for a sleeping flower. */
function ClosedHead({ r, body, edge }: { r: number; body: string; edge: string }): ReactNode {
  const head = new Folded();
  head.add(budOutline(r), budOutline(r, true), place(0, 0));
  const sepals = new Cut();
  for (const turn of [-38, 0, 38]) sepals.add(petalOutline("pointed", r * (turn ? 0.62 : 0.7), r * 0.2), place(0, r * 0.05, turn));
  return paths([
    [head.base, body],
    [head.light, lit(body)],
    [sepals, edge],
  ]);
}

/** A small paper bee that lives on a rare plant, drawn around (0, 0). */
function Bee({ size }: { size: number }) {
  const k = size / 10;
  const wings = new Cut().add(disc(-1.4, -3.6, 2.5, 1.7), place(0, 0, -25, k)).add(disc(1.8, -3.4, 2.3, 1.5), place(0, 0, 20, k));
  const body = new Cut().add(disc(0, 0, 4.2, 2.9), place(0, 0, 0, k));
  const bands = new Cut().add(disc(-1.2, 0, 0.6, 2.75), place(0, 0, 0, k)).add(disc(1.4, 0, 0.6, 2.6), place(0, 0, 0, k)).add(disc(4.1, -0.4, 1.3), place(0, 0, 0, k));
  return paths([
    [wings, "hsl(200 40% 95%)"],
    [body, "hsl(46 92% 55%)"],
    [bands, "hsl(30 40% 18%)"],
  ]);
}

/**
 * A stem as a strip of paper, from (0, 0) up to `top` along the plant's curve, `w0` wide at the foot and
 * `w1` at the top, its left half lit. A line along its middle, as wide as its top, keeps it whole in a small
 * sprite (plantCanvas.ts draws a line never thinner than a pixel and a half; a strip could thin away).
 */
function Stem({ h, bend, w0, w1, colour }: { h: number; bend: number; w0: number; w1: number; colour: string }): ReactNode {
  // The curve's three points, and its left side's direction at each.
  const pts = [
    [0, 0],
    [bend, -h / 2],
    [0, -h],
  ];
  const tangents = [
    [bend, -h / 2],
    [0, -h],
    [-bend, -h / 2],
  ];
  const widths = [w0, (w0 + w1) / 2, w1];
  const side = (k: number) =>
    pts.map(([x, y], i) => {
      const [dx, dy] = tangents[i];
      const d = Math.hypot(dx, dy);
      return [x + (dy / d) * (widths[i] / 2) * k, y + (-dx / d) * (widths[i] / 2) * k];
    });
  // A quadratic curve as a cubic one.
  const curve = (p: number[][]) => [p[0][0] + ((p[1][0] - p[0][0]) * 2) / 3, p[0][1] + ((p[1][1] - p[0][1]) * 2) / 3, p[2][0] + ((p[1][0] - p[2][0]) * 2) / 3, p[2][1] + ((p[1][1] - p[2][1]) * 2) / 3, p[2][0], p[2][1]];
  const strip = (a: number[][], b: number[][]) => [a[0][0], a[0][1], ...curve(a), ...line(a[2][0], a[2][1], b[2][0], b[2][1]), ...curve([b[2], b[1], b[0]]), ...line(b[0][0], b[0][1], a[0][0], a[0][1])];
  const left = side(1);
  const right = side(-1);
  const mid = side(0);
  return (
    <>
      <path d={`M0 0 Q ${bend} ${-h / 2} 0 ${-h}`} fill="none" stroke={colour} strokeWidth={w1} strokeLinecap="round" />
      {paths([
        [new Cut().add(strip(left, right)), colour],
        [new Cut().add(strip(left, mid)), lit(colour)],
      ])}
    </>
  );
}

/**
 * The plant for `word`, drawn upward from (0, 0). `growth` (0..1) sets the
 * height; `stage` decides leaves, bud, or flower.
 */
export function Plant({ word, growth, stage, scale = 1 }: { word: string; growth: number; stage: Stage; scale?: number }) {
  return <PlantForm word={word} growth={growth} form={FORM[stage]} scale={scale} />;
}

/**
 * The plant at any `form` between two stages (see FORM). In between, each part
 * grows, opens or fades on its own schedule, so the change reads as growing:
 * the stem rises out of the seed, leaves unfold one by one, the bud swells and
 * opens into the flower.
 */
export function PlantForm({ word, growth, form, scale = 1 }: { word: string; growth: number; form: number; scale?: number }) {
  const rare = rareOf(word);
  const meaning = meaningOf(word);
  // The word's meaning wins over a golden rare: "azul" is blue first of all.
  const g = {
    ...genome(word),
    ...(rare === "golden" && GOLD),
    ...(meaning?.kind === "colour" && { petal: meaning.petal, petalEdge: meaning.petalEdge, center: meaning.center }),
    // Asleep: the flower stays closed, in its own colours, and nods. Happy: it faces straight up.
    ...(meaning?.kind === "sleep" && { lean: 70 }),
    ...(meaning?.kind === "happy" && { lean: 0 }),
    // "loco" needs separate petals to scramble.
    ...(meaning?.kind === "crazy" && { flower: "daisy" as const, petals: 9 }),
  };
  const striped = rare === "striped";
  const crazy = meaning?.kind === "crazy";
  const asleep = meaning?.kind === "sleep";
  const h = plantHeight(word, growth, scale);
  const bend = g.curve * 10 * scale;
  const leafLen = (13 + 7 * growth) * scale;
  const flowerR = flowerSize(growth, scale);
  // The stem's width at the foot and the top: a sprout's is slender, a grown plant's sturdier.
  const w0 = (1.8 + 1.6 * growth) * scale;
  const w1 = (1.3 + 0.6 * growth) * scale;
  const leafLit = lit(g.leaf);

  if (form <= 1) {
    // Seed → sprout: the stem rises out of the seed, and its two seed leaves unfold.
    const p = clamp01(form);
    const sh = h * p;
    const leaves = new Folded();
    for (const side of [-1, 1]) {
      // Even a sprout's seed leaves are in its word's colour.
      const len = leafLen * 0.7 * p;
      leaves.add(leafOutline("round", len, 0.06), leafOutline("round", len, 0.06, true), place(0, -sh, side * (50 + g.curve * 14) * p, side, 1));
    }
    return (
      <>
        {p < 1 && <ellipse cx={0} cy={-1.2 * scale} rx={3.4 * scale} ry={2.3 * scale} fill="var(--ink-2)" opacity={0.55 * (1 - p * p)} />}
        {p > 0 && (
          <>
            <Stem h={sh} bend={bend * p} w0={w1 * 1.2} w1={w1} colour={g.stem} />
            {paths([
              [leaves.base, g.leaf],
              [leaves.light, leafLit],
            ])}
          </>
        )}
      </>
    );
  }

  // Sprout → bud (q), then bud → bloom (u).
  const q = clamp01(form - 1);
  const u = clamp01(form - 2);
  const top = onStem(h, bend, 1);

  // The leaves: a pair at the foot, then the genome's along the lower half of the stem, each folded down its middle.
  const leaves = new Folded();
  const frost = new Cut();
  const drops = new Cut();
  const dropLit = new Cut();
  // Spaced up to two thirds of the way, smaller as they go: the plant's weight at its foot, and room around the flower.
  const spots = [{ t: 0.02, turn: 64, size: 1.1, pair: true }, ...Array.from({ length: g.leaves }, (_, i) => ({ t: 0.16 + (i / g.leaves) * 0.52, turn: 54 - i * 5, size: 0.95 - (i / g.leaves) * 0.4, pair: g.opposite }))];
  spots.forEach(({ t, turn, size, pair }, i) => {
    // Lower leaves first; every leaf is full grown by the bud.
    const k = clamp01(q * 1.6 - (i / spots.length) * 0.6);
    if (k === 0) return;
    const p = onStem(h, bend, t);
    // "feliz": the leaves reach up.
    const reach = meaning?.kind === "happy" ? turn - 20 : turn;
    for (const side of pair ? [-1, 1] : [i % 2 ? 1 : -1]) {
      const len = leafLen * LEAF_LEN[g.leafShape] * size * k;
      const at = place(p.x, p.y, p.angle + side * reach, side, 1);
      leaves.add(leafOutline(g.leafShape, len, 0.12), leafOutline(g.leafShape, len, 0.12, true), at);
      // "frío": every leaf's tip white with frost, a small leaf of its shape laid on its tip. "agua": a drop on every other leaf.
      if (meaning?.kind === "cold") frost.add(leafOutline(g.leafShape, len * 0.34, 0.12), then(at, place(len * 0.12 * 0.66 * 0.66, -len * 0.66, 9)));
      if (meaning?.kind === "water" && i % 2 === 0) {
        drops.add(budOutline(len * 0.14), then(at, place(len * 0.06, -len * 0.3)));
        dropLit.add(disc(len * 0.035, -len * 0.38, len * 0.025), at);
      }
    }
  });
  const sprout = new Folded();
  if (q < 1)
    for (const side of [-1, 1]) {
      const len = leafLen * 0.7 * (1 - q);
      sprout.add(leafOutline("round", len, 0.06), leafOutline("round", len, 0.06, true), place(top.x, top.y, side * (50 + g.curve * 14), side, 1));
    }

  const sideStems: string[] = [];
  const sideHeads: ReactNode[] = [];
  if (u > 0)
    for (let i = 0; i < g.branches; i++) {
      const p = onStem(h, bend, 0.55 + i * 0.15);
      const side = i % 2 ? 1 : -1;
      const len = h * 0.28 * u;
      const ex = p.x + side * len * 0.7;
      const ey = p.y - len * 0.7;
      sideStems.push(`M${p.x} ${p.y} Q ${p.x + side * len * 0.6} ${p.y - len * 0.1} ${ex} ${ey}`);
      sideHeads.push(
        <g key={`b${i}`} transform={`translate(${ex} ${ey}) rotate(${side * 20})`}>
          {asleep ? <ClosedHead r={flowerR * 0.7 * u} body={g.petal} edge={g.budEdge} /> : <Head g={g} r={flowerR * 0.6 * u} striped={striped} crazy={crazy} />}
        </g>,
      );
    }
  if (u > 0 && rare === "twin") {
    // The stem forks near the top: a second head as big as the first, side by
    // side, away from the highest side branch (branch i leans to i % 2 ? 1 : -1).
    const p = onStem(h, bend, 0.84);
    const side = g.branches ? ((g.branches - 1) % 2 ? -1 : 1) : g.lean > 0 ? -1 : 1;
    const len = h * 0.2 * u;
    const ex = p.x + side * len * 0.75;
    const ey = p.y - len * 0.85;
    sideStems.push(`M${p.x} ${p.y} Q ${p.x + side * len * 0.7} ${p.y - len * 0.05} ${ex} ${ey}`);
    sideHeads.push(
      <g key="twin" transform={`translate(${ex} ${ey}) rotate(${side * 25})`}>
        <Head g={g} r={flowerR * u} striped={striped} />
      </g>,
    );
  }

  // The bud swells after the first leaves, then opens: it shrinks into the
  // flower's heart while the petals unfurl.
  const bud = clamp01((q - 0.3) / 0.7) * (1 - u);
  return (
    <>
      {paths([
        [leaves.base, g.leaf],
        [leaves.light, leafLit],
      ])}
      {sideStems.length > 0 && <path d={sideStems.join(" ")} fill="none" stroke={g.stem} strokeWidth={Math.max(1, 1.4 * scale)} strokeLinecap="round" />}
      <Stem h={h} bend={bend} w0={lerp(w1 * 1.2, w0, q)} w1={w1} colour={g.stem} />
      {paths([
        [sprout.base, g.leaf],
        [sprout.light, leafLit],
        [frost, "#fff"],
        [drops, "hsl(208 70% 62%)"],
        [dropLit, "hsl(200 80% 92%)"],
      ])}
      {sideHeads}
      <g transform={`translate(${top.x} ${top.y}) rotate(${g.lean})`}>
        {bud > 0 && <ClosedHead r={flowerR * 0.8 * bud} body={g.bud} edge={g.budEdge} />}
        {u > 0 &&
          (asleep ? (
            // Asleep, also while it blooms: the closed head grows in its own colours over the green bud, and never opens.
            <ClosedHead r={flowerR * 0.95 * u} body={g.petal} edge={g.budEdge} />
          ) : u < 1 ? (
            <g transform={`rotate(${(1 - u) * -50}) scale(${u})`}>
              <Head g={g} r={flowerR} striped={striped} crazy={crazy} rays={rare === "golden"} />
            </g>
          ) : (
            <Head g={g} r={flowerR} striped={striped} crazy={crazy} rays={rare === "golden"} />
          ))}
      </g>
      {u > 0 && meaning?.kind === "fall" && (
        // "caer": one petal has fallen to the ground beside the plant.
        <g transform={`translate(${flowerR * 1.8} -0.6) rotate(78)`}>
          {paths([
            [new Cut().add(petalOutline(g.petalShape, flowerR * 1.1 * u, flowerR * 0.3 * u)), g.petal],
            [new Cut().add(petalOutline(g.petalShape, flowerR * 1.1 * u, flowerR * 0.3 * u, false, true)), lit(g.petal)],
          ])}
        </g>
      )}
      {u > 0 && rare === "bee" && (
        <g transform={`translate(${top.x + flowerR * 1.9} ${top.y - flowerR * 1.4}) scale(${u})`}>
          <Bee size={flowerR * 1.4} />
        </g>
      )}
    </>
  );
}

/** The side of the square that frames a word's plant at stability `s` and `stage`, so a sprout fills it as well as a tall bloom. */
export function plantFrame(word: string, s: number, stage: PlantStage): number {
  const growth = growthOf(s);
  const h = plantHeight(word, growth, 1.05) + (stage === "seed" || stage === "sprout" ? 12 : flowerSize(growth, 1.05) * 2.9);
  return Math.max(44, h + 10);
}

/** A word's plant on a little mound of soil, framed to fit, for cards. */
export function WordPlant({ word, s, stage, size = 96, className }: { word: string; s: number; stage: PlantStage; size?: number; className?: string }) {
  const side = plantFrame(word, s, stage);
  return (
    <svg className={className} width={size} height={size} viewBox={`${-side / 2} ${-(side - 8)} ${side} ${side}`} role="img" aria-label={`${word}: ${stageLabel(stage)}`}>
      <ellipse cx={0} cy={3} rx={side * 0.3} ry={side * 0.06} fill="var(--soil-1)" />
      <PlantForm word={word} growth={growthOf(s)} form={FORM[stage]} scale={1.05} />
    </svg>
  );
}

/** A plant's sprite (garden/plantCanvas.ts plantPng) and its box about the plant's foot. */
export interface SpriteImage {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A plant as the 2D garden draws it: leaning as recall fades (the walk's lean too), with dots for listening and writing. */
export function StripPlant({ p, scale, highlighted, look, sprite }: { p: GardenPlant; scale: number; highlighted: boolean; look?: { growth: number; form: number }; sprite?: SpriteImage }) {
  // The glow and the dots follow the plant as drawn, also mid-replay.
  const h = stemHeight(look?.growth ?? p.growth) * sizeOf(meaningOf(p.lemma)) * scale;
  return (
    <g transform={`rotate(${leanDeg(p.id, p.r).toFixed(1)})`}>
      {highlighted && <circle className="glow" cy={-h} r={14 * scale} />}
      {/* look: a frame of the summary's replay, between how the plant looked and how it looks now. */}
      {/* sprite: the same plant drawn by a worker, one element instead of ~25 (#486). */}
      {look ? <PlantForm word={p.lemma} growth={look.growth} form={look.form} scale={scale} /> : sprite ? <image {...sprite} /> : <Plant word={p.lemma} growth={p.growth} stage={p.stage} scale={scale} />}
      {p.listen && <circle cx={4 * scale} cy={-h * 0.45} r={2.4 * scale} fill="var(--sky)" />}
      {p.write && <circle cx={-4 * scale} cy={-h * 0.62} r={2.4 * scale} fill="var(--persimmon)" />}
    </g>
  );
}

/**
 * The landing page's row of one word growing up, from a seed to an old bloom.
 * Memoised: it never changes, so a parent's re-render must not redraw it.
 */
export const GrowthStrip = memo(function GrowthStrip() {
  const stages: { label: string; s: number; reps: number }[] = [
    { label: "new word", s: 0, reps: 0 },
    { label: "first review", s: 1.2, reps: 1 },
    { label: "learning", s: 4, reps: 2 },
    { label: "known", s: 30, reps: 4 },
    { label: "known well", s: OLD_S, reps: 8 },
  ];
  return (
    <div className="growth-strip" aria-label="Each word grows from a seed to a flower as you remember it">
      {stages.map((st, i) => {
        const stage = plantStage(st);
        return (
          <figure key={st.label} style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
            <svg width="72" height="150" viewBox="-36 -170 72 182" aria-hidden="true" className="garden-mini">
              <path d="M-34 4 Q0 -3 34 4 V12 H-34Z" fill="var(--soil-1)" />
              {stage === "seed" ? (
                <ellipse className="seed" cx="0" cy="6" rx="4" ry="2.6" />
              ) : (
                <g className="sway" style={{ animationDelay: `${-i}s` }}>
                  <StripPlant
                    p={{ id: `demo${i + 2}`, lemma: ["", "casa", "mañana", "Blume", "perennial"][i], gloss: "", pos: "", rank: 0, planted: 0, s: st.s, r: 1, stage, growth: growthOf(st.s), listen: st.s >= OLD_S, write: st.s >= OLD_S, forms: [] }}
                    scale={1.25}
                    highlighted={false}
                  />
                </g>
              )}
            </svg>
            <figcaption>{st.label}</figcaption>
          </figure>
        );
      })}
    </div>
  );
});
