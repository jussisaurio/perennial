// The moment after a good answer: the word's plant glides down from the card's
// corner, then gets water and grows into its new form, or a new word's seed goes
// into the soil. About a second, any tap or key skips it, and the next card
// waits for it (#200).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FORM, PlantForm, plantFrame, plantTop, stemHeight, stemPoint } from "./plant";
import { growthOf } from "../garden/plants";
import type { PlantStage } from "../core/memory";
import type { Cutout } from "../garden/visitorArt";
import { CutoutShapes } from "./cutout";
import { WateringCanIcon, WateringCanOffIcon } from "./icons";

export interface PlantLook {
  s: number;
  stage: PlantStage;
}

export interface GrowthMoment {
  word: string;
  from: PlantLook;
  to: PlantLook;
  /** A new word: its seed is planted first. */
  planted: boolean;
  /** A garden word's visitor (#209), arriving with this first good answer. */
  visitor?: Cutout;
  /**
   * A remembered word that was hard: back on its retry after "I forgot", or likely
   * forgotten. More water and a little spring, so the feedback fits the answer (#412).
   */
  strong?: boolean;
  /** One quiet line under the plant, such as the word's longest wait yet (#412). */
  note?: string;
  /** Listening or writing just became strong: its dot comes onto the plant, as in the garden. */
  dot?: "listen" | "write";
}

// Showing the moment is a per-device choice, like sound.
const GROWTH_KEY = "growth";

function growthSetting(): boolean {
  try {
    return localStorage.getItem(GROWTH_KEY) !== "off";
  } catch {
    return true; // No storage: the default.
  }
}

const growthListeners = new Set<(on: boolean) => void>();

function setGrowthSetting(on: boolean): void {
  try {
    localStorage.setItem(GROWTH_KEY, on ? "on" : "off");
  } catch {
    // Not saved; nothing else to do.
  }
  for (const fn of growthListeners) fn(on);
}

/** The setting, kept up to date when the session bar or Settings changes it. */
export function useGrowthSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(growthSetting);
  useEffect(() => {
    growthListeners.add(setOn);
    return () => void growthListeners.delete(setOn);
  }, []);
  return [on, setGrowthSetting];
}

/**
 * An icon button in the session bar that turns the moment on or off, like sound. It hides when the device
 * asks for less motion: then nothing moves anyway. A watering can alone is guesswork, so its label shows
 * on hover and focus, and for a moment after a tap, where phones have no hover.
 */
export function GrowthToggle() {
  const [on, set] = useGrowthSetting();
  const [tapped, setTapped] = useState(false);
  useEffect(() => {
    if (!tapped) return;
    const t = setTimeout(() => setTapped(false), 1500);
    return () => clearTimeout(t);
  }, [tapped, on]);
  if (reducedMotion()) return null;
  return (
    <button
      className={tapped ? "icon tip-shown" : "icon"}
      onClick={() => {
        set(!on);
        setTapped(true);
      }}
      aria-pressed={on}
      aria-label="Show plants growing"
      data-tip={on ? "Growing plants: on" : "Growing plants: off"}
    >
      {on ? <WateringCanIcon /> : <WateringCanOffIcon />}
    </button>
  );
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Height in drawing units: the moment is only worth a pause if the plant visibly grows. */
const height = (l: PlantLook) => (l.stage === "seed" ? 0 : stemHeight(growthOf(l.s)));

/** Whether the plant visibly grew: a planted seed, a new stage, or a plant that grows taller. The summary replays only these. */
export function grows(m: GrowthMoment): boolean {
  return m.planted || FORM[m.to.stage] > FORM[m.from.stage] || height(m.to) - height(m.from) >= 3;
}

/** Whether the moment plays at all: the learner's setting, and the device not asking for less motion. */
export const growthOn = () => growthSetting() && !reducedMotion();

// The timeline, in ms, after the plant's glide from the corner. Watering: the can
// tips in, three drops fall, and the plant grows as they land. Planting: the seed
// drops in and the soil settles.
const T = {
  /** The corner plant moving to where it is watered, so the learner sees it is the same plant. */
  glide: 320,
  seedFall: 260,
  soilPat: 140,
  canIn: 180,
  tip: 110,
  drop: 220,
  dropGap: 70,
  canOut: 200,
  grow: 520,
  /** Opening into bloom shows the flower for the first time (#207): a little longer, so it can be seen. */
  bloom: 760,
  hold: 80,
  sparkle: 380,
  /** A strong moment's spring, after the water lands. */
  perk: 420,
  /** A new skill dot pops onto the stem. */
  dot: 420,
  /** Longer on screen when there is a line to read. */
  note: 1100,
};

function timeline(m: GrowthMoment) {
  const plantEnd = m.planted ? T.seedFall + T.soilPat : 0;
  const rises = FORM[m.to.stage] > FORM[m.from.stage] || height(m.to) > height(m.from);
  const watered = !m.planted;
  const growStart = m.planted ? plantEnd - 40 : T.canIn + T.tip + 30;
  // The word is now known: the flower opens for the first time, with a little sparkle.
  const blooms = m.to.stage === "bloom" && m.from.stage !== "bloom";
  const growMs = blooms ? T.bloom : T.grow;
  // Watered without growing: the moment ends once the water has landed.
  const growEnd = rises ? growStart + growMs : watered ? growStart : plantEnd;
  const sparkleStart = growEnd - 160;
  const perkStart = growEnd;
  const end = Math.max(plantEnd, growEnd + Math.max(m.strong ? T.perk : 0, m.dot ? T.dot : 0)) + (m.note ? T.note : T.hold);
  return { plantEnd, watered, growStart, growMs, growEnd, blooms, sparkleStart, perkStart, end: blooms ? Math.max(end, sparkleStart + T.sparkle) : end };
}

/** When the moment's chime should sound (ms): as the seed lands, or as the first drop reaches the soil. */
export function chimeDelay(m: GrowthMoment): number {
  return T.glide + (m.planted ? T.seedFall : T.canIn + T.tip - 30 + T.drop);
}

const easeIn = (t: number) => t * t;
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Like easeOut, but overshoots a little and settles: a springy stretch upward. */
export const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const phase = (e: number, start: number, length: number) => clamp01((e - start) / length);

function WateringCan({ e, side, growStart, growMs, drops }: { e: number; side: number; growStart: number; growMs: number; drops: number }) {
  const k = side / 90;
  const shown = phase(e, 0, T.canIn) * (1 - phase(e, growStart + growMs * 0.45, T.canOut));
  const tip = 28 * phase(e, T.canIn, T.tip) * (1 - 0.65 * phase(e, growStart + growMs * 0.45, T.canOut));
  const slide = (1 - phase(e, 0, T.canIn)) * -10;
  // The spout's end once tipped, where the drops start.
  const sx = -0.17 * side;
  const sy = -0.62 * side;
  return (
    <g>
      <g transform={`translate(${-0.48 * side + slide * k} ${-0.62 * side}) scale(${k}) rotate(${tip})`} opacity={shown}>
        <path d="M-8 -9 Q 0 -21 8 -9" fill="none" stroke="var(--sky)" strokeWidth={2.6} strokeLinecap="round" />
        <path d="M10 -2 L 24 -12" stroke="var(--sky)" strokeWidth={3.4} strokeLinecap="round" />
        <circle cx={25} cy={-13} r={2.8} fill="var(--sky)" />
        <rect x={-12} y={-9} width={24} height={18} rx={4} fill="var(--sky)" />
        <rect x={-8} y={-5} width={9} height={3} rx={1.5} fill="var(--sky-soft)" opacity={0.7} />
      </g>
      {Array.from({ length: drops }, (_, i) => {
        const t = phase(e, T.canIn + T.tip - 30 + i * T.dropGap, T.drop);
        if (t <= 0 || t >= 1) return null;
        const f = easeIn(t);
        const x = sx + (0.08 + i * 0.035) * side * f;
        const y = sy + 0.56 * side * f;
        return <ellipse key={i} cx={x} cy={y} rx={1.5 * k * 1.4} ry={2.1 * k * 1.4} fill="var(--sky)" opacity={1 - t * 0.5} />;
      })}
    </g>
  );
}

/** A garden word's visitor (#209) hops in along the soil from the left, and stops beside the plant. */
function Visitor({ art, e, side, until }: { art: Cutout; e: number; side: number; until: number }) {
  const { w, h } = art;
  // About a third of the frame wide, whatever the plant's size: it should read as an animal, not a crumb.
  const k = (side * 0.34) / w;
  const t = clamp01(e / Math.max(1, until));
  const x = -side * 0.95 + side * 0.6 * easeOut(t);
  // Three small hops on the way in.
  const hop = Math.abs(Math.sin(t * Math.PI * 3)) * side * 0.04 * (1 - t);
  return (
    <g transform={`translate(${x - (w * k) / 2} ${3 - h * k - hop}) scale(${k})`}>
      <CutoutShapes art={art} />
    </g>
  );
}

/** The moment's svg is this many times as wide as it is high: its viewBox. */
const WIDE = 1.7;

/**
 * The moment itself, drawn frame by frame. Calls `onDone` once, when it ends.
 * `corner` is where the card's plant was drawn (a WordPlant): the moment starts there.
 * `spot` is the box of the empty `.growth-spot`, the svg's box with no width: the
 * svg is centred on it.
 */
export function Growth({ m, corner, spot, onDone }: { m: GrowthMoment; corner: DOMRect; spot: DOMRect; onDone: () => void }) {
  const [e, setE] = useState(0);
  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });
  const tl = timeline(m);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const el = now - t0;
      setE(Math.max(0, el - T.glide));
      if (el >= T.glide + tl.end) done.current();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tl.end]);

  // One frame for the whole moment, sized for the larger plant, so growing shows.
  const side = Math.max(plantFrame(m.word, m.from.s, m.from.stage), plantFrame(m.word, m.to.s, m.to.stage));
  const svg = useRef<SVGSVGElement>(null);
  // Before the first paint, so the plant is never seen at the bottom first. Both
  // drawings put the plant's root at x 0, y 0, with 8 units below it. The svg's box
  // comes from `spot`, read with `corner`: reading it here would force a layout (#572).
  useLayoutEffect(() => {
    const el = svg.current!;
    const cornerSide = plantFrame(m.word, m.from.s, m.from.stage);
    const k = corner.height / cornerSide / (spot.height / side);
    const ox = (spot.height * WIDE) / 2;
    const oy = (spot.height * (side - 8)) / side;
    const dx = corner.left + corner.width / 2 - spot.left;
    const dy = corner.top + (corner.height * (cornerSide - 8)) / cornerSide - (spot.top + oy);
    el.style.transformOrigin = `${ox}px ${oy}px`;
    const glide = el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${k})` }, { transform: "none" }], { duration: T.glide, easing: "cubic-bezier(0.3, 0, 0.2, 1)" });
    return () => glide.cancel();
  }, [corner, spot, m, side]);
  const g = phase(e, tl.growStart, tl.growMs);
  // Height and form share one pace, so leaves and bud come as the stem rises.
  // Only the height springs: an overshooting form would open a bud's flower for a moment.
  // A first bloom opens across the middle of its time, so the reveal is seen, not over in a blink.
  const form = FORM[m.from.stage] + (FORM[m.to.stage] - FORM[m.from.stage]) * (tl.blooms ? easeInOut(g) : easeOut(g));
  const from = m.from.stage === "seed" ? 0 : growthOf(m.from.s);
  const growth = Math.max(0, from + (growthOf(m.to.s) - from) * easeOutBack(g));
  // Planting: the seed falls in, then the soil gives a little and settles.
  const fall = m.planted ? 1 - easeIn(phase(e, 0, T.seedFall)) : 0;
  const patT = phase(e, T.seedFall, T.soilPat);
  const pat = m.planted ? Math.sin(Math.PI * patT) : 0;
  const sparkle = tl.blooms ? phase(e, tl.sparkleStart, T.sparkle) : 0;
  // A strong moment: the plant stretches up once, and settles.
  const perk = m.strong ? Math.sin(Math.PI * phase(e, tl.perkStart, T.perk)) : 0;
  // Where the garden draws the dot (StripPlant), on this plant's stem; it pops in, a little too big, then settles.
  const dotAt = m.dot && stemPoint(m.word, growthOf(m.to.s), m.dot === "listen" ? 0.45 : 0.62, 1.05);
  const dotR = side * 0.035 * easeOutBack(phase(e, tl.perkStart, T.dot));
  const top = plantTop(m.word, growthOf(m.to.s), 1.05);
  return (
    <div className="growth" data-kind={m.planted ? "plant" : "water"} aria-hidden="true">
      <svg ref={svg} viewBox={`${(-side * WIDE) / 2} ${-(side - 8)} ${side * WIDE} ${side}`} height="100%">
        <ellipse cx={0} cy={3} rx={side * 0.3 * (1 + pat * 0.06)} ry={side * 0.06 * (1 + pat * 0.4)} fill="var(--soil-1)" />
        {m.planted &&
          patT > 0 &&
          patT < 1 &&
          // Bits of soil hop out on each side as the seed lands.
          [-1, -0.6, 0.6, 1].map((d) => (
            <circle key={d} cx={d * side * (0.07 + patT * 0.09)} cy={-side * (0.02 + Math.abs(d) * 0.07) * Math.sin(Math.PI * patT)} r={side * 0.016} fill="var(--ink-2)" opacity={0.35 * (1 - patT)} />
          ))}
        {/* The seed squashes a little as it lands. */}
        <g transform={`translate(0 ${-fall * side * 0.55}) scale(${(1 + pat * 0.22) * (1 - perk * 0.05)} ${(1 - pat * 0.28) * (1 + perk * 0.12)})`}>
          <PlantForm word={m.word} growth={growth} form={form} scale={1.05} />
        </g>
        {sparkle > 0 &&
          sparkle < 1 &&
          Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2 + 0.3;
            const r = side * (0.06 + 0.12 * Math.sqrt(sparkle));
            return <circle key={i} cx={top.x + Math.cos(a) * r} cy={top.y + Math.sin(a) * r} r={side * 0.014 * (1 - sparkle * 0.5)} fill="var(--sun)" opacity={1 - sparkle} />;
          })}
        {/* Not during the glide: it hops in from where the plant is going. */}
        {dotAt && dotR > 0 && <circle cx={dotAt.x + (m.dot === "listen" ? 4 : -4)} cy={dotAt.y} r={dotR} fill={m.dot === "listen" ? "var(--sky)" : "var(--persimmon)"} />}
        {m.visitor && e > 0 && <Visitor art={m.visitor} e={e} side={side} until={tl.growEnd} />}
        {tl.watered && <WateringCan e={e} side={side} growStart={tl.growStart} growMs={tl.growMs} drops={m.strong ? 5 : 3} />}
      </svg>
      {m.note && e > tl.growStart && <p className="growth-note">{m.note}</p>}
    </div>
  );
}
