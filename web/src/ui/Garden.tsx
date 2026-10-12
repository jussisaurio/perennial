// The word garden: every word you've started is a plant. Height follows
// memory stability, flowers open once a word is known, and plants droop as
// recall fades — until the next session waters them. Nothing ever dies.
// The plants themselves come from garden/plants.ts, shared with the walk.

import { memo, type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LoadedDeck } from "../data/deck";
import type { Learner } from "../data/learner";
import { plantLine, reservedStake, WORM_LINE } from "../content/voice";
import { language } from "../content/languages";
import { StripPlant } from "./plant";
import { hash01 } from "../lib/seed";
import { plantMood, plantsFromLearner, showcasePlants, stageLabel, THIRSTY, type GardenPlant, type PlantSource } from "../garden/plants";
import { CAT_ASLEEP, MOLE, runs, SNAIL, WATERING_CAN, WORM_ASLEEP, type PixelArt } from "../garden/visitorArt";
import { stripVisitor, type VisitorView } from "../garden/visitors";
import { isSleepyHour, keepsakeLabel, neighbourPerks, sleeperId } from "../garden/whimsy";
import { today } from "../core/day";

export { GrowthStrip } from "./plant";

type Plant = GardenPlant;
const H = 210;
const GROUND = H - 34;

/**
 * Hover is for mice and pens. A touch "enters" on touchdown and "leaves" on
 * lift, before its click (#113): the card would close under the finger.
 */
const hovers = (e: PointerEvent) => e.pointerType !== "touch";

export interface GardenData extends PlantSource {
  total: number;
}

const counted = (g: PlantSource): GardenData => ({ ...g, total: g.plants.length });

/** The learner's garden for the strip: the same plants as the walk. */
export function gardenFromLearner(l: Learner, now = Date.now()): GardenData {
  return counted(plantsFromLearner(l, now));
}

/** The landing page's strip: the same words, at the same stages, as the landing page's walk. */
export function showcaseGarden(deck: LoadedDeck, count = 64): GardenData {
  return counted(showcasePlants(deck, count));
}

/** Width per plant when the garden scrolls: every plant stays a real, tappable flower. */
const SPACING = 22;
/** Plants drawn beyond each edge of the view, so a quick pan never shows gaps. */
const OVERSCAN = 160;

/**
 * Small gardens (the landing page, a first week) fit the width. Bigger ones
 * become a strip you pan sideways, in course order, so the newest growth is
 * at the right, where it opens; only the plants in view are drawn, so 2000
 * words cost the same as 200.
 */
/** Memoised: on the landing page a chip tap must not redraw every plant. */
export const Garden = memo(function Garden({
  data,
  highlight,
  compact,
  showcase,
  onView,
  visitors,
}: {
  data: GardenData | null | undefined;
  highlight?: Set<string>;
  compact?: boolean;
  showcase?: boolean;
  /** Today's visitors drawn in the strip: the snail on the soil line, the cat asleep at the right end, the mole past it. */
  visitors?: { views: VisitorView[]; snailAt: number; lang: string; mole?: boolean } | null;
  /** Offered in the plant card: open this plant in the 3D garden. */
  onView?: (id: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [scrollX, setScrollX] = useState(0);
  const [hover, setHover] = useState<{ p: Plant; x: number; y: number } | null>(null);
  // Hover intent: with a card open, switching to another plant waits a moment,
  // so the pointer can cross other plants on its way to the card's button.
  const switching = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [visitorTip, setVisitorTip] = useState<{ v: TipVisitor; x: number; line?: string } | null>(null);
  // A tapped plant hops (#60); `n` restarts the animation on every tap. Rarely the neighbour hops too.
  const [perk, setPerk] = useState<{ id: string; n: number; neighbour: string | null } | null>(null);
  const show = (h: { p: Plant; x: number; y: number }, now = false) => {
    clearTimeout(switching.current);
    setVisitorTip(null);
    if (now || !hover) setHover(h);
    else switching.current = setTimeout(() => setHover(h), 160);
  };
  const hide = () => {
    clearTimeout(switching.current);
    setHover(null);
    setVisitorTip(null);
  };
  useEffect(() => () => clearTimeout(switching.current), []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plants = useMemo(() => data?.plants ?? [], [data]);
  const n = plants.length;
  const pad = 18;
  const snail = visitors?.views.find((v) => v.id === "snail" && v.word);
  const cat = visitors?.views.find((v) => v.id === "cat" && v.word);
  // Room at the right end for the cat, so it does not sleep on the newest plant.
  const catRoom = cat ? 46 : 0;
  const scrolls = n * SPACING + pad * 2 + catRoom > width;
  // Only a strip that scrolls has ends to find (#61): the first word's post at the far left, the mole past the seeds.
  const first = scrolls && !showcase ? data?.first : null;
  const mole = scrolls && visitors?.mole ? stripVisitor("mole", visitors.lang) : null;
  const keepRoom = first ? 92 : 0;
  const moleRoom = mole ? 56 : 0;
  const fullWidth = scrolls ? n * SPACING + pad * 2 + catRoom + keepRoom + moleRoom : width;

  const layout = useMemo(() => {
    // Small gardens cluster in the middle instead of scattering across the width.
    const spacing = scrolls ? SPACING : n ? Math.min(34, (width - pad * 2 - catRoom) / n) : width;
    const offset = scrolls ? pad + keepRoom : (width - catRoom - spacing * n) / 2;
    const scale = Math.max(0.42, Math.min(1.05, spacing / 20));
    return plants.map((p, i) => ({ p, x: offset + spacing * (i + 0.5) + (hash01(p.id, 17) - 0.5) * spacing * 0.8, y: GROUND + hash01(p.id, 19) * 4, scale }));
  }, [plants, n, scrolls, width, catRoom, keepRoom]);

  // Open where the newest growth is, or on today's words after a session, and
  // keep following it while words sync in, until the learner scrolls.
  const autoX = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !scrolls || (autoX.current !== null && Math.abs(el.scrollLeft - autoX.current) > 2)) return;
    const lit = highlight?.size ? layout.filter((l) => highlight.has(l.p.id)) : [];
    el.scrollLeft = lit.length ? lit.reduce((a, l) => a + l.x, 0) / lit.length - width / 2 : fullWidth;
    autoX.current = el.scrollLeft;
    setScrollX(el.scrollLeft);
    // Not on highlight/layout identity changes: n and width cover growth and resizes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrolls, width, n]);

  // Swipe on touch, two-finger scroll on trackpads, and arrows on desktop.
  const atStart = scrollX <= 4;
  const atEnd = scrollX >= fullWidth - width - 4;
  const page = (dir: -1 | 1) => scroller.current?.scrollBy({ left: dir * width * 0.7, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });

  const onScroll = () => {
    const x = scroller.current?.scrollLeft ?? 0;
    requestAnimationFrame(() => setScrollX(x));
    hide();
  };

  const visible = scrolls ? layout.filter((l) => l.x > scrollX - OVERSCAN && l.x < scrollX + width + OVERSCAN) : layout;
  const seeds = Math.min(data?.seeds ?? 0, 24);
  const blooming = data?.plants.filter((p) => p.stage === "bloom").length ?? 0;
  const label = data ? `Word garden: ${blooming} known, ${data.total - blooming} learning, ${data.seeds} new.` : "Word garden";
  const from = scrolls ? Math.max(0, scrollX - OVERSCAN) : 0;
  const to = scrolls ? Math.min(fullWidth, scrollX + width + OVERSCAN) : width;
  // Late at night one bloom snores (#62): the same one all day, the same as in the walk.
  const day = today();
  const sleeper = useMemo(() => sleeperId(plants.filter((p) => p.stage === "bloom").map((p) => p.id)), [plants, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const snoring = sleeper && isSleepyHour() ? sleeper : null;
  const empty = !!data && data.total === 0 && !showcase;
  const stake = empty && visitors ? reservedStake(language(visitors.lang).name, visitors.lang) : null;
  const worm = empty && visitors ? stripVisitor("worm", visitors.lang) : null;
  const tap = (l: { p: Plant; x: number; y: number }, i: number) => {
    show(l, true);
    const next = neighbourPerks() ? ((visible[i + 1] ?? visible[i - 1])?.p.id ?? null) : null;
    setPerk((o) => ({ id: l.p.id, n: (o?.n ?? 0) + 1, neighbour: next }));
  };

  return (
    <div className={`garden ${compact ? "compact" : ""} ${scrolls ? "scrolls" : ""}`} ref={wrap} onPointerLeave={(e) => hovers(e) && hide()}>
      <div className="garden-scroll" ref={scroller} onScroll={scrolls ? onScroll : undefined}>
        <svg width={fullWidth} height={H} viewBox={`0 0 ${fullWidth} ${H}`} role="img" aria-label={label}>
          <defs>
            <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--soil-1)" />
              <stop offset="1" stopColor="var(--soil-2)" />
            </linearGradient>
          </defs>
          {Array.from({ length: 6 }, (_, i) => (
            <circle key={i} className="firefly" cx={scrollX + (width / 6) * (i + 0.5)} cy={40 + (i % 3) * 30} r={1.8} style={{ animationDelay: `${i * 1.3}s` }} />
          ))}
          {visible.map(({ p, x, y, scale }, i) => (
            <g key={p.id} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} onPointerEnter={(e) => hovers(e) && show({ p, x, y })} onClick={() => tap({ p, x, y }, i)}>
              <g className="sway" style={{ animationDelay: `${-hash01(p.id, 23) * 6}s`, animationDuration: `${5 + hash01(p.id, 29) * 4}s` }}>
                <g key={perk?.id === p.id ? `perk${perk.n}` : perk?.neighbour === p.id ? `late${perk.n}` : "still"} className={perk?.id === p.id ? "perk" : perk?.neighbour === p.id ? "perk late" : undefined}>
                  <StripPlant p={p} scale={scale} highlighted={!!highlight?.has(p.id)} />
                </g>
                {snoring === p.id && <Snore y={-(16 + 118 * p.growth) * scale + 4} />}
                {/* generous invisible hit area */}
                <rect x={-8} y={-140 * scale} width={16} height={140 * scale} fill="transparent" />
              </g>
            </g>
          ))}
          {first && <Keepsake x={pad + keepRoom / 2 - 4} text={keepsakeLabel(first.lemma, first.at)} />}
          <path d={`M0 ${GROUND + 4} Q ${fullWidth * 0.25} ${GROUND - 3} ${fullWidth * 0.5} ${GROUND + 3} T ${fullWidth} ${GROUND + 1} V ${H} H 0 Z`} fill="url(#soil)" />
          {Array.from({ length: Math.ceil((to - from) / 38) }, (_, k) => {
            const i = Math.floor(from / 38) + k;
            const gx = (i + hash01(String(i), 31)) * 38;
            return <path key={i} className="tuft" d={`M${gx} ${GROUND + 6} l -3 -7 M${gx} ${GROUND + 6} l 0 -9 M${gx} ${GROUND + 6} l 3 -6`} />;
          })}
          {Array.from({ length: seeds }, (_, i) => {
            const sx = (scrolls ? fullWidth - width : 0) + 24 + hash01(`seed${i}`, 37) * (width - 48);
            const sy = GROUND + 14 + hash01(`seed${i}`, 41) * 12;
            return <ellipse key={i} className="seed" cx={sx} cy={sy} rx={2.6} ry={1.7} transform={`rotate(${hash01(`seed${i}`, 43) * 180} ${sx} ${sy})`} />;
          })}
          {empty && <PixelSprite art={WATERING_CAN} scale={2} x={width / 2 + 96} y={GROUND + 7} />}
        </svg>
        {snail && (
          <VisitorMark
            v={snail}
            art={SNAIL}
            scale={2.2}
            x={pad + (visitors?.snailAt ?? 0) * (fullWidth - pad * 2)}
            onShow={(x) => {
              setHover(null);
              setVisitorTip({ v: snail, x });
            }}
            onHide={() => setVisitorTip(null)}
          />
        )}
        {cat && (
          <VisitorMark
            v={cat}
            art={CAT_ASLEEP}
            scale={2}
            x={fullWidth - moleRoom - 30}
            onShow={(x) => {
              setHover(null);
              setVisitorTip({ v: cat, x });
            }}
            onHide={() => setVisitorTip(null)}
          />
        )}
        {worm && (
          <VisitorMark
            v={worm}
            art={WORM_ASLEEP}
            scale={2}
            x={width / 2 + 44}
            onShow={(x) => setVisitorTip({ v: worm, x, line: WORM_LINE })}
            onHide={() => setVisitorTip(null)}
          />
        )}
        {mole && (
          <MoleHole
            v={mole}
            x={fullWidth - 38}
            up={atEnd}
            onShow={(x) => {
              setHover(null);
              setVisitorTip({ v: mole, x });
            }}
            onHide={() => setVisitorTip(null)}
          />
        )}
        {stake && (
          <div className="garden-stake" style={{ left: width / 2 - 64, top: GROUND - 74 }}>
            <span>{stake.line}</span>
            {stake.local && <small lang={visitors?.lang}>{stake.local}</small>}
          </div>
        )}
      </div>
      {visitorTip && (
        <div className="visitor-tip" role="tooltip" style={{ left: Math.min(width - 150, Math.max(8, visitorTip.x - scrollX - 60)), top: GROUND - (visitorTip.line ? 78 : 58) }}>
          <i lang={visitors?.lang}>{visitorTip.v.word}</i>
          <span> · {visitorTip.v.gloss}</span>
          {visitorTip.line && <em>{visitorTip.line}</em>}
        </div>
      )}
      {data && data.total === 0 && !stake && <p className="garden-empty">Your words will grow here.</p>}
      {hover && (
        <div className={onView ? "plant-tip interactive" : "plant-tip"} style={{ left: Math.min(width - 170, Math.max(8, hover.x - scrollX - 80)), top: 8 }} role="status" onPointerEnter={() => clearTimeout(switching.current)}>
          <strong>{hover.p.lemma}</strong>
          <span>{hover.p.gloss}</span>
          <em>
            {showcase ? stageLabel(hover.p.stage) : `${hover.p.stage === "bloom" ? "known" : "learning"} · ${hover.p.r >= THIRSTY ? "fresh in memory" : "ready for practice"}`}
            {hover.p.listen && " · listening ✓"}
            {hover.p.write && " · writing ✓"}
          </em>
          {!showcase && <span className="tip-flavour">{plantLine(hover.p.lemma, plantMood(hover.p))}</span>}
          {onView && (
            <button className="ghost small" onClick={() => onView(hover.p.id)}>
              View in garden →
            </button>
          )}
        </div>
      )}
      {data && !compact && !showcase && (
        <div className="garden-legend">
          <span>
            <b>{blooming}</b> known
          </span>
          <span>
            <b>{data.total - blooming}</b> learning
          </span>
          <span>
            <b>{data.seeds}</b> new
          </span>
          {scrolls && <span className="muted swipe-hint">Swipe to see the whole garden</span>}
          {scrolls && (
            <span className="garden-arrows">
              <button className="garden-arrow left" disabled={atStart} onClick={() => page(-1)} aria-label="Earlier words">
                <SproutArrow />
              </button>
              <button className="garden-arrow right" disabled={atEnd} onClick={() => page(1)} aria-label="Later words">
                <SproutArrow />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
});

/** What a strip tooltip needs: a word and its gloss. */
type TipVisitor = { id: string; word: string | null; gloss: string };

/**
 * A visitor in the strip, standing on the soil line: a small pixel sprite in a
 * button, so it can be focused and tapped. Hover, focus or tap shows its word.
 */
function VisitorMark({ v, art, x, scale, onShow, onHide, top }: { v: TipVisitor; art: PixelArt; x: number; scale: number; onShow: (x: number) => void; onHide: () => void; top?: number }) {
  const w = art.rows[0].length;
  const h = art.rows.length;
  return (
    <button
      type="button"
      className={`garden-visitor visitor-${v.id}`}
      aria-label={`${v.word} · ${v.gloss}`}
      style={{ left: x - (w * scale) / 2, top: top ?? GROUND + 4 - h * scale }}
      onPointerEnter={(e) => hovers(e) && onShow(x)}
      onPointerLeave={(e) => hovers(e) && onHide()}
      onFocus={() => onShow(x)}
      onBlur={onHide}
      onClick={() => onShow(x)}
    >
      <svg width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden="true">
        {runs(art).map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
        ))}
      </svg>
    </button>
  );
}

/** Pixel art as SVG rects, standing on (x, y): for things in the strip that are not buttons. */
function PixelSprite({ art, x, y, scale }: { art: PixelArt; x: number; y: number; scale: number }) {
  const w = art.rows[0].length;
  const h = art.rows.length;
  return (
    <g transform={`translate(${(x - (w * scale) / 2).toFixed(1)} ${(y - h * scale).toFixed(1)}) scale(${scale})`} shapeRendering="crispEdges" aria-hidden="true">
      {runs(art).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </g>
  );
}

/** One small "z" drifting up from a sleeping bloom (still, with reduced motion). */
function Snore({ y }: { y: number }) {
  return (
    <text className="snore" x={7} y={y} aria-hidden="true">
      z
    </text>
  );
}

/** The first word's post at the far left of the strip: the word and the day it was planted. */
function Keepsake({ x, text }: { x: number; text: string }) {
  return (
    <g className="keepsake" transform={`translate(${x.toFixed(1)} ${GROUND + 3})`}>
      <title>Your first word</title>
      <rect x={-1.5} y={-34} width={3} height={36} fill="var(--soil-2)" />
      <rect x={-40} y={-50} width={80} height={19} rx={3} className="keepsake-board" />
      <text x={0} y={-36.5} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

/**
 * The mole at the far right end: it looks up, holding one seed, while you are
 * at the end of the strip, and goes back down when you scroll away.
 */
function MoleHole({ v, x, up, onShow, onHide }: { v: TipVisitor; x: number; up: boolean; onShow: (x: number) => void; onHide: () => void }) {
  const scale = 2;
  const w = MOLE.rows[0].length * scale;
  const h = MOLE.rows.length * scale;
  return (
    <div className={up ? "mole up" : "mole"} style={{ left: x - w / 2 - 6, top: GROUND + 9 - h, width: w + 12, height: h }}>
      <div className="mole-body" inert={!up}>
        <VisitorMark v={v} art={MOLE} scale={scale} x={w / 2 + 6} top={0} onShow={() => onShow(x)} onHide={onHide} />
      </div>
      <svg className="mole-hill" width={w + 12} height={7} viewBox={`0 0 ${w + 12} 7`} aria-hidden="true">
        <path d={`M0 7 Q ${(w + 12) / 2} -3 ${w + 12} 7 Z`} fill="color-mix(in oklab, var(--soil-2), var(--ink) 22%)" />
      </svg>
    </div>
  );
}

/** A chevron made of two leaves meeting at a bud, pointing right (mirrored for "back"). */
function SproutArrow() {
  return (
    <svg viewBox="0 0 32 40" width="18" height="22" aria-hidden="true">
      <path d="M6 7 C 13 6, 21 12, 24 20 C 15 19, 8 14, 6 7 Z" fill="var(--leaf-2)" />
      <path d="M6 33 C 8 26, 15 21, 24 20 C 21 28, 13 34, 6 33 Z" fill="var(--leaf)" />
      <path d="M8 9 C 14 11, 19 15, 23 19.5 M8 31 C 14 28, 19 24, 23 20.5" fill="none" stroke="var(--stem)" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      <circle cx="25" cy="20" r="3.2" fill="var(--sun)" />
    </svg>
  );
}

