// Procedural plants: every word grows its own, seeded by the word itself, so
// "casa" looks the same in the garden, on its cards, and on every device.
// Growth follows memory stability: sprout → bud → bloom.

import { memo, type ReactNode } from "react";
import { OLD_S, plantStage, type PlantStage } from "../core/memory";
import { growthOf, leanDeg, stageLabel, type GardenPlant } from "../garden/plants";
import { hash01, hash32, rng } from "../lib/seed";
import { GOLD_COLOURS as GOLD, meaningOf, sizeOf } from "./meaning";

const pick = <T,>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)];
const between = (r: () => number, a: number, b: number) => a + r() * (b - a);

type FlowerType = "daisy" | "star" | "cup" | "bell" | "cluster" | "spike" | "pom";
type LeafShape = "oval" | "lance" | "round" | "heart";

interface Genome {
  flower: FlowerType;
  petals: number;
  petalShape: "round" | "pointed" | "long";
  petal: string; // colour
  petalEdge: string;
  /** A closed bud: green, from the leaf hue, so the flower's colour is a surprise until it blooms (#207). */
  bud: string;
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

/** Flower colours: curated hue families so no plant looks muddy. */
const FAMILIES: [number, number, number, number][] = [
  // [hue min, hue max, saturation, lightness]
  [2, 22, 72, 60], // red-orange
  [32, 48, 85, 60], // marigold
  [48, 56, 88, 64], // yellow
  [318, 345, 62, 68], // pink
  [268, 292, 45, 66], // lavender
  [205, 222, 58, 62], // cornflower
  [0, 360, 18, 92], // near-white
];

const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;

/** A plant's height in drawing units before its genome and scale: a seedling is 14, a full-grown plant 134. */
export const stemHeight = (growth: number) => 14 + 120 * growth;

export function genome(word: string): Genome {
  const r = rng(hash32(word.normalize("NFC").toLowerCase()));
  const [h0, h1, s, l] = pick(r, FAMILIES);
  const hue = between(r, h0, h1);
  const flower = pick(r, ["daisy", "daisy", "star", "cup", "bell", "cluster", "spike", "pom"] as const);
  const leafHue = between(r, 88, 138);
  return {
    flower,
    petals: flower === "star" ? Math.round(between(r, 5, 7)) : Math.round(between(r, 5, 13)),
    petalShape: pick(r, ["round", "pointed", "long"] as const),
    petal: hsl(hue, s, l),
    petalEdge: hsl(hue, s, l - 14),
    center: pick(r, [hsl(45, 90, 55), hsl(30, 60, 35), hsl(hue, s, l - 25), hsl(60, 30, 92)]),
    leafShape: pick(r, ["oval", "lance", "round", "heart"] as const),
    leaves: Math.round(between(r, 2, 5)),
    opposite: r() > 0.6,
    leaf: hsl(leafHue, between(r, 32, 50), between(r, 52, 62)),
    // From leafHue only, with no new draws from r, so every other trait stays as it was.
    bud: hsl(leafHue + 8, 46, 60),
    budEdge: hsl(leafHue, 36, 44),
    stem: hsl(leafHue - 6, 35, 40),
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


/** A small bee that lives on a rare plant, drawn around (0, 0). */
function Bee({ size }: { size: number }) {
  return (
    <g transform={`scale(${size / 10})`}>
      <ellipse cx={-1.5} cy={-3.6} rx={2.6} ry={1.8} fill="#fff" opacity={0.75} transform="rotate(-25 -1.5 -3.6)" />
      <ellipse cx={1.8} cy={-3.4} rx={2.4} ry={1.6} fill="#fff" opacity={0.75} transform="rotate(20 1.8 -3.4)" />
      <ellipse rx={4.2} ry={2.9} fill="hsl(46 92% 55%)" stroke="hsl(30 40% 18%)" strokeWidth={0.5} />
      <path d="M-1.2 -2.8 V2.8 M1.4 -2.7 V2.7" stroke="hsl(30 40% 18%)" strokeWidth={1.1} />
      <circle cx={4.1} cy={-0.4} r={1.3} fill="hsl(30 40% 18%)" />
    </g>
  );
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
  return onStem(plantHeight(word, growth, scale), genome(word).curve * 10 * scale, 1);
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

function leafPath(shape: LeafShape, len: number, w: number): string {
  switch (shape) {
    case "lance":
      return `M0 0 C ${w * 0.5} ${-len * 0.25} ${w * 0.35} ${-len * 0.8} 0 ${-len} C ${-w * 0.35} ${-len * 0.8} ${-w * 0.5} ${-len * 0.25} 0 0Z`;
    case "round":
      return `M0 0 C ${w * 1.1} ${-len * 0.1} ${w * 1.1} ${-len * 0.95} 0 ${-len} C ${-w * 1.1} ${-len * 0.95} ${-w * 1.1} ${-len * 0.1} 0 0Z`;
    case "heart":
      return `M0 ${-len * 0.12} C ${w * 1.1} ${len * 0.15} ${w * 0.9} ${-len * 0.75} 0 ${-len} C ${-w * 0.9} ${-len * 0.75} ${-w * 1.1} ${len * 0.15} 0 ${-len * 0.12}Z`;
    default:
      return `M0 0 C ${w * 0.8} ${-len * 0.2} ${w * 0.7} ${-len * 0.8} 0 ${-len} C ${-w * 0.7} ${-len * 0.8} ${-w * 0.8} ${-len * 0.2} 0 0Z`;
  }
}

function petalPath(shape: Genome["petalShape"], len: number, w: number): string {
  if (shape === "pointed") return `M0 0 C ${w} ${-len * 0.3} ${w * 0.6} ${-len * 0.8} 0 ${-len} C ${-w * 0.6} ${-len * 0.8} ${-w} ${-len * 0.3} 0 0Z`;
  if (shape === "long") return `M0 0 C ${w * 0.7} ${-len * 0.2} ${w * 0.7} ${-len * 0.95} 0 ${-len} C ${-w * 0.7} ${-len * 0.95} ${-w * 0.7} ${-len * 0.2} 0 0Z`;
  return `M0 0 C ${w * 1.2} ${-len * 0.1} ${w * 1.1} ${-len} 0 ${-len} C ${-w * 1.1} ${-len} ${-w * 1.2} ${-len * 0.1} 0 0Z`;
}

function Flower({ g, r, open, striped = false, crazy = false }: { g: Genome; r: number; open: boolean; striped?: boolean; crazy?: boolean }): ReactNode {
  if (!open) {
    // A closed bud, still green: the flower's colour shows only when it opens.
    return <path d={`M0 0 C ${-r * 0.7} ${-r * 0.4} ${-r * 0.55} ${-r * 1.5} 0 ${-r * 1.8} C ${r * 0.55} ${-r * 1.5} ${r * 0.7} ${-r * 0.4} 0 0Z`} fill={g.bud} stroke={g.budEdge} strokeWidth={0.6} />;
  }
  const ring = (n: number, len: number, w: number, shape = g.petalShape) =>
    Array.from({ length: n }, (_, i) => {
      // "loco": every petal its own size and angle (a fixed pattern, so the plant is the same each time).
      const wild = crazy ? ((i * 37) % 11) / 10 : 0.5;
      const turn = (i * 360) / n + (crazy ? (wild - 0.5) * 50 : 0);
      const l = crazy ? len * (0.6 + wild * 0.8) : len;
      return (
        <g key={i} transform={`rotate(${turn})`}>
          <path d={petalPath(shape, l, w)} fill={g.petal} stroke={g.petalEdge} strokeWidth={0.5} />
          {striped && <path d={`M0 ${-l * 0.15} L0 ${-l * 0.85}`} stroke="#fff" strokeOpacity={0.7} strokeWidth={Math.max(0.6, w * 0.34)} strokeLinecap="round" />}
        </g>
      );
    });
  switch (g.flower) {
    case "daisy":
      return (
        <g>
          {ring(g.petals, r * 1.25, r * 0.32)}
          <circle r={r * 0.42} fill={g.center} />
        </g>
      );
    case "star":
      return (
        <g>
          {ring(g.petals, r * 1.3, r * 0.45, "pointed")}
          <circle r={r * 0.28} fill={g.center} />
        </g>
      );
    case "cup":
      return <path d={`M${-r} ${-r * 0.1} C ${-r} ${r * 0.9} ${r} ${r * 0.9} ${r} ${-r * 0.1} L ${r * 0.5} ${-r * 1.1} L 0 ${-r * 0.45} L ${-r * 0.5} ${-r * 1.1} Z`} fill={g.petal} stroke={g.petalEdge} strokeWidth={0.6} transform={`translate(0 ${r * 0.3})`} />;
    case "bell":
      // Hangs from a little arched stalk.
      return (
        <g>
          <path d={`M0 0 Q ${r * 1.1} ${-r * 0.6} ${r * 1.3} ${r * 0.5}`} fill="none" stroke={g.stem} strokeWidth={1} />
          <path d={`M${r * 1.3 - r * 0.7} ${r * 0.5} C ${r * 0.6} ${r * 1.6} ${r * 2} ${r * 1.6} ${r * 2} ${r * 0.5} Z`} fill={g.petal} stroke={g.petalEdge} strokeWidth={0.6} />
        </g>
      );
    case "cluster":
      return (
        <g>
          {Array.from({ length: Math.max(5, Math.min(9, g.petals)) }, (_, i) => {
            const n = Math.max(5, Math.min(9, g.petals));
            const t = (i / (n - 1)) * Math.PI;
            return <circle key={i} cx={Math.cos(t) * r * 1.1} cy={-Math.sin(t) * r * 0.9} r={r * 0.36} fill={g.petal} stroke={g.petalEdge} strokeWidth={0.5} />;
          })}
        </g>
      );
    case "spike":
      return (
        <g>
          {Array.from({ length: 6 }, (_, i) => (
            <ellipse key={i} cx={(i % 2 ? 1 : -1) * r * 0.28} cy={-i * r * 0.5} rx={r * (0.42 - i * 0.04)} ry={r * (0.32 - i * 0.03)} fill={g.petal} stroke={g.petalEdge} strokeWidth={0.4} />
          ))}
        </g>
      );
    case "pom":
      return (
        <g>
          {Array.from({ length: 14 }, (_, i) => {
            const a = i * 2.4;
            const d = r * 0.85 * Math.sqrt((i + 0.5) / 14);
            return <circle key={i} cx={Math.cos(a) * d} cy={Math.sin(a) * d} r={r * 0.3} fill={g.petal} stroke={g.petalEdge} strokeWidth={0.4} />;
          })}
        </g>
      );
  }
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
  const leafTurn = meaning?.kind === "happy" ? 34 : 52;
  const h = plantHeight(word, growth, scale);
  const bend = g.curve * 10 * scale;
  const leafLen = 11 * scale;
  const leafW = 5 * scale;
  const flowerR = 6.5 * scale * (0.9 + growth * 0.5);
  const sproutStroke = Math.max(1.2, 1.9 * scale);

  if (form <= 1) {
    // Seed → sprout: the stem rises out of the seed, and its two leaves unfold.
    const p = clamp01(form);
    const sh = h * p;
    const top = onStem(sh, bend * p, 1);
    return (
      <g>
        {p < 1 && <ellipse cx={0} cy={-1.2 * scale} rx={3.4 * scale} ry={2.3 * scale} fill="var(--ink-2)" opacity={0.55 * (1 - p * p)} />}
        {p > 0 && (
          <>
            <path d={`M0 0 Q ${bend * p} ${-sh / 2} ${top.x} ${top.y}`} fill="none" stroke={g.stem} strokeWidth={sproutStroke} strokeLinecap="round" />
            {[-1, 1].map((side) => (
              // Even a sprout carries its word's leaf shape and colour.
              <path key={side} d={leafPath(g.leafShape, leafLen * 0.9 * p, leafW * p)} fill={g.leaf} transform={`translate(${top.x} ${top.y}) rotate(${side * (48 + g.curve * 14) * p})`} />
            ))}
          </>
        )}
      </g>
    );
  }

  // Sprout → bud (q), then bud → bloom (u).
  const q = clamp01(form - 1);
  const u = clamp01(form - 2);
  const top = onStem(h, bend, 1);

  const leaves: ReactNode[] = [];
  for (let i = 0; i < g.leaves; i++) {
    const t = 0.2 + (i / Math.max(1, g.leaves)) * 0.6;
    // Lower leaves first; every leaf is full grown by the bud.
    const k = clamp01(q * 1.6 - (i / Math.max(1, g.leaves)) * 0.6);
    if (k === 0) continue;
    const p = onStem(h, bend, t);
    const sides = g.opposite ? [-1, 1] : [i % 2 ? 1 : -1];
    for (const side of sides) {
      const len = leafLen * (1 - t * 0.35) * k;
      leaves.push(
        <g key={`${i}${side}`} transform={`translate(${p.x} ${p.y}) rotate(${p.angle + side * leafTurn})`}>
          <path d={leafPath(g.leafShape, len, leafW * k)} fill={g.leaf} />
          {/* "frío": frost on every leaf tip. "agua": a drop on every other leaf. */}
          {meaning?.kind === "cold" && <circle cy={-len * 0.86} r={leafW * k * 0.32} fill="#fff" />}
          {meaning?.kind === "water" && i % 2 === 0 && <ellipse cy={-len * 0.5} rx={leafW * k * 0.3} ry={leafW * k * 0.4} fill="hsl(208 70% 62%)" />}
        </g>,
      );
    }
  }

  const branches: ReactNode[] = [];
  if (u > 0)
    for (let i = 0; i < g.branches; i++) {
      const p = onStem(h, bend, 0.55 + i * 0.15);
      const side = i % 2 ? 1 : -1;
      const len = h * 0.28 * u;
      const ex = p.x + side * len * 0.7;
      const ey = p.y - len * 0.7;
      branches.push(
        <g key={`b${i}`}>
          <path d={`M${p.x} ${p.y} Q ${p.x + side * len * 0.6} ${p.y - len * 0.1} ${ex} ${ey}`} fill="none" stroke={g.stem} strokeWidth={Math.max(1, 1.4 * scale)} strokeLinecap="round" />
          <g transform={`translate(${ex} ${ey}) rotate(${side * 20})`}>
            {asleep ? <Flower g={{ ...g, bud: g.petal, budEdge: g.petalEdge }} r={flowerR * 0.7 * u} open={false} /> : <Flower g={g} r={flowerR * 0.6 * u} open striped={striped} crazy={crazy} />}
          </g>
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
    branches.push(
      <g key="twin">
        <path d={`M${p.x} ${p.y} Q ${p.x + side * len * 0.7} ${p.y - len * 0.05} ${ex} ${ey}`} fill="none" stroke={g.stem} strokeWidth={Math.max(1.1, 1.8 * scale)} strokeLinecap="round" />
        <g transform={`translate(${ex} ${ey}) rotate(${side * 25})`}>
          <Flower g={g} r={flowerR * u} open striped={striped} />
        </g>
      </g>,
    );
  }

  // The bud swells after the first leaves, then opens: it shrinks into the
  // flower's heart while the petals unfurl.
  const bud = clamp01((q - 0.3) / 0.7) * (1 - u);
  return (
    <g>
      {u > 0 && rare === "golden" && (
        // A soft glow behind the whole flower head (drawn first) and a glint: gold, not just yellow.
        <g transform={`translate(${top.x} ${top.y})`} opacity={u}>
          <circle r={flowerR * 2.3} fill={GOLD.petal} opacity={0.22} />
          <path d={`M${flowerR * 1.5} ${-flowerR * 1.9} l0 ${flowerR * 0.9} M${flowerR * 1.05} ${-flowerR * 1.45} l${flowerR * 0.9} 0`} stroke="#fff" strokeWidth={Math.max(0.8, flowerR * 0.16)} strokeLinecap="round" />
        </g>
      )}
      {branches}
      <path d={`M0 0 Q ${bend} ${-h / 2} ${top.x} ${top.y}`} fill="none" stroke={g.stem} strokeWidth={lerp(sproutStroke, Math.max(1.3, 2.1 * scale), q)} strokeLinecap="round" />
      {q < 1 &&
        [-1, 1].map((side) => (
          <path key={side} d={leafPath(g.leafShape, leafLen * 0.9 * (1 - q), leafW * (1 - q))} fill={g.leaf} transform={`translate(${top.x} ${top.y}) rotate(${side * (48 + g.curve * 14)})`} />
        ))}
      {leaves}
      <g transform={`translate(${top.x} ${top.y}) rotate(${g.lean})`}>
        {bud > 0 && <Flower g={g} r={flowerR * bud} open={false} />}
        {u > 0 &&
          (asleep ? (
            // Asleep, also while it blooms: the closed head grows in its own colours over the green bud, and never opens.
            <Flower g={{ ...g, bud: g.petal, budEdge: g.petalEdge }} r={flowerR * 1.2 * u} open={false} />
          ) : u < 1 ? (
            <g transform={`rotate(${(1 - u) * -50}) scale(${u})`}>
              <Flower g={g} r={flowerR} open striped={striped} crazy={crazy} />
            </g>
          ) : (
            <Flower g={g} r={flowerR} open striped={striped} crazy={crazy} />
          ))}
      </g>
      {u > 0 && meaning?.kind === "fall" && (
        // "caer": one petal has fallen to the ground beside the plant.
        <path d={petalPath(g.petalShape, flowerR * 1.1 * u, flowerR * 0.38 * u)} fill={g.petal} stroke={g.petalEdge} strokeWidth={0.5} transform={`translate(${flowerR * 1.8} -0.6) rotate(78)`} />
      )}
      {u > 0 && rare === "bee" && (
        <g transform={`translate(${top.x + flowerR * 1.9} ${top.y - flowerR * 1.4}) scale(${u})`}>
          <Bee size={flowerR * 1.4} />
        </g>
      )}
    </g>
  );
}

/** The side of the square that frames a word's plant at stability `s` and `stage`, so a sprout fills it as well as a tall bloom. */
export function plantFrame(word: string, s: number, stage: PlantStage): number {
  const h = plantHeight(word, growthOf(s), 1.05) + (stage === "seed" || stage === "sprout" ? 12 : 22);
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

/** A plant as the 2D garden draws it: leaning as recall fades (the walk's lean too), with dots for listening and writing. */
export function StripPlant({ p, scale, highlighted, look }: { p: GardenPlant; scale: number; highlighted: boolean; look?: { growth: number; form: number } }) {
  // The glow and the dots follow the plant as drawn, also mid-replay.
  const h = (16 + 118 * (look?.growth ?? p.growth)) * sizeOf(meaningOf(p.lemma)) * scale;
  return (
    <g transform={`rotate(${leanDeg(p.id, p.r).toFixed(1)})`}>
      {highlighted && <circle className="glow" cy={-h} r={14 * scale} />}
      {/* look: a frame of the summary's replay, between how the plant looked and how it looks now. */}
      {look ? <PlantForm word={p.lemma} growth={look.growth} form={look.form} scale={scale} /> : <Plant word={p.lemma} growth={p.growth} stage={p.stage} scale={scale} />}
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
                    p={{ id: `demo${i + 2}`, lemma: ["", "casa", "mañana", "Blume", "perennial"][i], gloss: "", pos: "", rank: 0, s: st.s, r: 1, stage, growth: growthOf(st.s), listen: st.s >= OLD_S, write: st.s >= OLD_S }}
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
