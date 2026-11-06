// The moment after a good answer: the word's plant glides down from the card's
// corner, then gets water and grows into its new form, or a new word's seed goes
// into the soil. About a second, any tap or key skips it, and the next card
// waits for it (#200).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FORM, PlantForm, plantFrame, plantTop, stemHeight, stemPoint } from "./plant";
import { growthOf } from "../garden/plants";
import type { PlantStage } from "../core/memory";
import type { PixelArt } from "../garden/visitorArt";
import { PixelRects } from "./pixel";
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
  visitor?: PixelArt;
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

/**
 * Plays keyframes on an element of the moment, `delay` ms after the glide begins. The fixed-shape parts (can,
 * drops, visitor, sparkles) animate this way, so React does not redraw them every frame (#478).
 * CSS transforms on SVG elements are in user units, from the origin.
 */
function play(el: Element, keyframes: Keyframe[], delay: number, duration: number, fill: FillMode): Animation {
  return el.animate(keyframes, { delay: T.glide + delay, duration, fill });
}

/** `n + 1` keyframes of `frame` over t in 0..1, for curves that are not linear. */
const sample = (n: number, frame: (t: number) => Keyframe): Keyframe[] => Array.from({ length: n + 1 }, (_, i) => frame(i / n));

function WateringCan({ side, growStart, growMs, drops }: { side: number; growStart: number; growMs: number; drops: number }) {
  const k = side / 90;
  // The spout's end once tipped, where the drops start.
  const sx = -0.17 * side;
  const sy = -0.62 * side;
  const can = useRef<SVGGElement>(null);
  const water = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    // The can slides and fades in, tips, holds, then fades out half tipped back. Each step is linear.
    const out = growStart + growMs * 0.45;
    const at = (slide: number, tip: number) => `translate(${-0.48 * side + slide * k}px, ${-0.62 * side}px) scale(${k}) rotate(${tip}deg)`;
    const end = out + T.canOut;
    const anims = [
      play(
        can.current!,
        [
          { offset: 0, transform: at(-10, 0), opacity: 0 },
          { offset: T.canIn / end, transform: at(0, 0), opacity: 1 },
          { offset: (T.canIn + T.tip) / end, transform: at(0, 28), opacity: 1 },
          { offset: out / end, transform: at(0, 28), opacity: 1 },
          { offset: 1, transform: at(0, 28 * 0.35), opacity: 0 },
        ],
        0,
        end,
        "both",
      ),
      ...Array.from(water.current!.children, (drop, i) =>
        play(
          drop,
          sample(8, (t) => {
            const f = easeIn(t);
            return { transform: `translate(${sx + (0.08 + i * 0.035) * side * f}px, ${sy + 0.56 * side * f}px)`, opacity: 1 - t * 0.5 };
          }),
          T.canIn + T.tip - 30 + i * T.dropGap,
          T.drop,
          "none",
        ),
      ),
    ];
    return () => anims.forEach((a) => a.cancel());
  }, [side, k, sx, sy, growStart, growMs]);
  return (
    <g>
      <g ref={can} opacity={0}>
        <path d="M-8 -9 Q 0 -21 8 -9" fill="none" stroke="var(--sky)" strokeWidth={2.6} strokeLinecap="round" />
        <path d="M10 -2 L 24 -12" stroke="var(--sky)" strokeWidth={3.4} strokeLinecap="round" />
        <circle cx={25} cy={-13} r={2.8} fill="var(--sky)" />
        <rect x={-12} y={-9} width={24} height={18} rx={4} fill="var(--sky)" />
        <rect x={-8} y={-5} width={9} height={3} rx={1.5} fill="var(--sky-soft)" opacity={0.7} />
      </g>
      {/* Hidden but while each drop falls. */}
      <g ref={water}>
        {Array.from({ length: drops }, (_, i) => (
          <ellipse key={i} rx={1.5 * k * 1.4} ry={2.1 * k * 1.4} fill="var(--sky)" opacity={0} />
        ))}
      </g>
    </g>
  );
}

/** A garden word's visitor (#209) hops in along the soil from the left, and stops beside the plant. */
function Visitor({ art, side, until }: { art: PixelArt; side: number; until: number }) {
  const w = art.rows[0].length;
  const h = art.rows.length;
  // About a third of the frame wide, whatever the plant's size: it should read as an animal, not a crumb.
  const k = (side * 0.34) / w;
  const el = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    const frames = sample(36, (t) => {
      const x = -side * 0.95 + side * 0.6 * easeOut(t);
      // Three small hops on the way in.
      const hop = Math.abs(Math.sin(t * Math.PI * 3)) * side * 0.04 * (1 - t);
      return { transform: `translate(${x - (w * k) / 2}px, ${3 - h * k - hop}px) scale(${k})`, opacity: 1 };
    });
    // Not during the glide: it hops in from where the plant is going, and then stays.
    const a = play(el.current!, frames, 0, Math.max(1, until), "forwards");
    return () => a.cancel();
  }, [side, until, w, h, k]);
  return (
    <g ref={el} opacity={0} shapeRendering="crispEdges">
      <PixelRects art={art} />
    </g>
  );
}

/** A first bloom's sparkle: six dots fly out from the flower and fade. */
function Sparkle({ at, side, start }: { at: { x: number; y: number }; side: number; start: number }) {
  const el = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    const anims = Array.from(el.current!.children, (dot, i) => {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      return play(
        dot,
        sample(10, (t) => {
          const r = side * (0.06 + 0.12 * Math.sqrt(t));
          return { transform: `translate(${at.x + Math.cos(a) * r}px, ${at.y + Math.sin(a) * r}px) scale(${1 - t * 0.5})`, opacity: 1 - t };
        }),
        start,
        T.sparkle,
        "none",
      );
    });
    return () => anims.forEach((a) => a.cancel());
  }, [at.x, at.y, side, start]);
  return (
    <g ref={el}>
      {Array.from({ length: 6 }, (_, i) => (
        <circle key={i} r={side * 0.014} fill="var(--sun)" opacity={0} />
      ))}
    </g>
  );
}

/**
 * The moment itself, drawn frame by frame. Calls `onDone` once, when it ends.
 * `corner` is where the card's plant was drawn (a WordPlant): the moment starts there.
 */
export function Growth({ m, corner, onDone }: { m: GrowthMoment; corner: DOMRect; onDone: () => void }) {
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
  // drawings put the plant's root at x 0, y 0, with 8 units below it.
  useLayoutEffect(() => {
    const el = svg.current!;
    const r = el.getBoundingClientRect();
    const cornerSide = plantFrame(m.word, m.from.s, m.from.stage);
    const k = corner.height / cornerSide / (r.height / side);
    const ox = r.width / 2;
    const oy = (r.height * (side - 8)) / side;
    const dx = corner.left + corner.width / 2 - (r.left + ox);
    const dy = corner.top + (corner.height * (cornerSide - 8)) / cornerSide - (r.top + oy);
    el.style.transformOrigin = `${ox}px ${oy}px`;
    const glide = el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${k})` }, { transform: "none" }], { duration: T.glide, easing: "cubic-bezier(0.3, 0, 0.2, 1)" });
    return () => glide.cancel();
  }, [corner, m, side]);
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
  // A strong moment: the plant stretches up once, and settles.
  const perk = m.strong ? Math.sin(Math.PI * phase(e, tl.perkStart, T.perk)) : 0;
  // Where the garden draws the dot (StripPlant), on this plant's stem; it pops in, a little too big, then settles.
  const dotAt = m.dot && stemPoint(m.word, growthOf(m.to.s), m.dot === "listen" ? 0.45 : 0.62, 1.05);
  const dotR = side * 0.035 * easeOutBack(phase(e, tl.perkStart, T.dot));
  const top = plantTop(m.word, growthOf(m.to.s), 1.05);
  return (
    <div className="growth" data-kind={m.planted ? "plant" : "water"} aria-hidden="true">
      <svg ref={svg} viewBox={`${-side * 0.85} ${-(side - 8)} ${side * 1.7} ${side}`} height="100%">
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
        {tl.blooms && <Sparkle at={top} side={side} start={tl.sparkleStart} />}
        {/* Not during the glide: it hops in from where the plant is going. */}
        {dotAt && dotR > 0 && <circle cx={dotAt.x + (m.dot === "listen" ? 4 : -4)} cy={dotAt.y} r={dotR} fill={m.dot === "listen" ? "var(--sky)" : "var(--persimmon)"} />}
        {m.visitor && <Visitor art={m.visitor} side={side} until={tl.growEnd} />}
        {tl.watered && <WateringCan side={side} growStart={tl.growStart} growMs={tl.growMs} drops={m.strong ? 5 : 3} />}
      </svg>
      {m.note && e > tl.growStart && <p className="growth-note">{m.note}</p>}
    </div>
  );
}
