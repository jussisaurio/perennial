// Procedural plants: every word grows its own, seeded by the word itself, so
// "casa" looks the same in the garden, on its cards, and on every device.
// Growth follows memory stability: sprout → bud → bloom.

import { memo, type ReactNode } from "react";
import { OLD_S, plantStage, type PlantStage } from "../core/memory";
import { growthOf, leanDeg, stageLabel, type GardenPlant } from "../garden/plants";
import { hash32, rng } from "../lib/seed";

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
    bud: hsl(leafHue + 8, 42, 68),
    budEdge: hsl(leafHue, 36, 44),
    stem: hsl(leafHue - 6, 35, 40),
    curve: between(r, -1, 1),
    height: between(r, 0.78, 1.18),
    branches: r() > 0.55 ? Math.round(between(r, 1, 2)) : 0,
    lean: between(r, -18, 18),
  };
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
  const g = genome(word);
  return onStem(stemHeight(growth) * g.height * scale, g.curve * 10 * scale, 1);
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

function Flower({ g, r, open }: { g: Genome; r: number; open: boolean }): ReactNode {
  if (!open) {
    // A closed bud, still green: the flower's colour shows only when it opens.
    return <path d={`M0 0 C ${-r * 0.7} ${-r * 0.4} ${-r * 0.55} ${-r * 1.5} 0 ${-r * 1.8} C ${r * 0.55} ${-r * 1.5} ${r * 0.7} ${-r * 0.4} 0 0Z`} fill={g.bud} stroke={g.budEdge} strokeWidth={0.6} />;
  }
  const ring = (n: number, len: number, w: number, shape = g.petalShape) =>
    Array.from({ length: n }, (_, i) => <path key={i} d={petalPath(shape, len, w)} fill={g.petal} stroke={g.petalEdge} strokeWidth={0.5} transform={`rotate(${(i * 360) / n})`} />);
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
  const g = genome(word);
  const h = stemHeight(growth) * g.height * scale;
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
    for (const side of sides)
      leaves.push(<path key={`${i}${side}`} d={leafPath(g.leafShape, leafLen * (1 - t * 0.35) * k, leafW * k)} fill={g.leaf} transform={`translate(${p.x} ${p.y}) rotate(${p.angle + side * 52})`} />);
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
            <Flower g={g} r={flowerR * 0.6 * u} open />
          </g>
        </g>,
      );
    }

  // The bud swells after the first leaves, then opens: it shrinks into the
  // flower's heart while the petals unfurl.
  const bud = clamp01((q - 0.3) / 0.7) * (1 - u);
  return (
    <g>
      {branches}
      <path d={`M0 0 Q ${bend} ${-h / 2} ${top.x} ${top.y}`} fill="none" stroke={g.stem} strokeWidth={lerp(sproutStroke, Math.max(1.3, 2.1 * scale), q)} strokeLinecap="round" />
      {q < 1 &&
        [-1, 1].map((side) => (
          <path key={side} d={leafPath(g.leafShape, leafLen * 0.9 * (1 - q), leafW * (1 - q))} fill={g.leaf} transform={`translate(${top.x} ${top.y}) rotate(${side * (48 + g.curve * 14)})`} />
        ))}
      {leaves}
      <g transform={`translate(${top.x} ${top.y}) rotate(${g.lean})`}>
        {bud > 0 && <Flower g={g} r={flowerR * bud} open={false} />}
        {u > 0 && (u < 1 ? <g transform={`rotate(${(1 - u) * -50}) scale(${u})`}><Flower g={g} r={flowerR} open /></g> : <Flower g={g} r={flowerR} open />)}
      </g>
    </g>
  );
}

/** The side of the square that frames a word's plant at stability `s` and `stage`, so a sprout fills it as well as a tall bloom. */
export function plantFrame(word: string, s: number, stage: PlantStage): number {
  const h = stemHeight(growthOf(s)) * genome(word).height * 1.05 + (stage === "seed" || stage === "sprout" ? 12 : 22);
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
export function StripPlant({ p, scale, highlighted }: { p: GardenPlant; scale: number; highlighted: boolean }) {
  const h = (16 + 118 * p.growth) * scale;
  return (
    <g transform={`rotate(${leanDeg(p.id, p.r).toFixed(1)})`}>
      {highlighted && <circle className="glow" cy={-h} r={14 * scale} />}
      <Plant word={p.lemma} growth={p.growth} stage={p.stage} scale={scale} />
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
