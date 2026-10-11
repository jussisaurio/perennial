// The word garden: every word you've started is a plant. Height follows
// memory stability, flowers open once a word is known, and plants droop as
// recall fades — until the next session waters them. Nothing ever dies.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LoadedDeck } from "../data/deck";
import { KNOWN_STABILITY, recall, type Learner } from "../data/learner";
import { plantLine } from "../content/voice";
import { Plant as WordPlantShape, stageFor } from "./plant";
import { CAT_ASLEEP, runs, SNAIL, type PixelArt } from "../garden/visitorArt";
import type { VisitorView } from "../garden/visitors";

interface Plant {
  id: string;
  lemma: string;
  gloss: string;
  s: number;
  r: number;
  listen: boolean;
  write: boolean;
  order: number;
}

function hash(str: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10007) / 10007;
}

export type { Plant };
const H = 210;
const GROUND = H - 34;

export interface GardenData {
  plants: Plant[];
  total: number;
  seeds: number;
}

/** The learner's garden: every word with progress is a plant. */
export function gardenFromLearner(l: Learner, now = Date.now()): GardenData {
  const plants: Plant[] = [];
  for (const m of l.memories) {
    if (m.skill !== "read" || m.reps === 0) continue;
    const w = l.words.get(m.lexemeId);
    if (!w || w.status === "ignored") continue;
    const strong = (skill: string) => {
      const x = l.memory.get(`${w.id}:${skill}`);
      return !!x && x.reps > 0 && x.s >= KNOWN_STABILITY;
    };
    plants.push({ id: w.id, lemma: w.lemma, gloss: w.gloss, s: m.s, r: recall(m, now), listen: strong("listen"), write: strong("write"), order: w.rank });
  }
  plants.sort((a, b) => a.order - b.order);
  return { plants, total: plants.length, seeds: l.fresh().length };
}

/**
 * A made-up but believable garden for the landing page: the deck's most common
 * words at a spread of stages, so newcomers see what learning will look like.
 */
export function showcaseGarden(deck: LoadedDeck, count = 64): GardenData {
  const plants = deck.words.slice(0, count).map((w, i) => {
    const h = hash(w.id, 7);
    // Mostly blooming, some budding, a few sprouts; common words grew longest.
    const s = h < 0.15 ? 1 + h * 10 : h < 0.35 ? 3 + h * 8 : 8 + (1 - i / count) * 120 * h;
    return { id: w.id, lemma: w.lemma, gloss: w.gloss, s, r: 0.92, listen: s > 60, write: s > 90, order: w.rank };
  });
  return { plants, total: plants.length, seeds: Math.max(0, deck.words.length - count) };
}

function PlantShape({ p, scale, highlighted }: { p: Plant; scale: number; highlighted: boolean }) {
  const growth = Math.min(1, Math.log1p(p.s) / Math.log1p(120));
  const h = (16 + 118 * growth) * scale;
  const dir = hash(p.id, 9) > 0.5 ? 1 : -1;
  // Lean a little as recall fades, as a hint, never a punishment: plants stay
  // green and never lean more than 18°, however long the break.
  const droop = dir * Math.max(0, Math.min(1, (0.9 - p.r) / 0.4)) * 18;
  return (
    <g transform={`rotate(${droop.toFixed(1)})`}>
      {highlighted && <circle className="glow" cy={-h} r={14 * scale} />}
      <WordPlantShape word={p.lemma} growth={growth} stage={stageFor(p.s, p.s >= KNOWN_STABILITY)} scale={scale} />
      {p.listen && <circle cx={4 * scale} cy={-h * 0.45} r={2.4 * scale} fill="var(--sky)" />}
      {p.write && <circle cx={-4 * scale} cy={-h * 0.62} r={2.4 * scale} fill="var(--persimmon)" />}
    </g>
  );
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
export function Garden({
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
  /** Today's visitors drawn in the strip: the snail on the soil line, the cat asleep at the right end. */
  visitors?: { views: VisitorView[]; snailAt: number; lang: string } | null;
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
  const [visitorTip, setVisitorTip] = useState<{ v: VisitorView; x: number } | null>(null);
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
  const fullWidth = scrolls ? n * SPACING + pad * 2 + catRoom : width;

  const layout = useMemo(() => {
    // Small gardens cluster in the middle instead of scattering across the width.
    const spacing = scrolls ? SPACING : n ? Math.min(34, (width - pad * 2 - catRoom) / n) : width;
    const offset = scrolls ? pad : (width - catRoom - spacing * n) / 2;
    const scale = Math.max(0.42, Math.min(1.05, spacing / 20));
    return plants.map((p, i) => ({ p, x: offset + spacing * (i + 0.5) + (hash(p.id, 17) - 0.5) * spacing * 0.8, y: GROUND + hash(p.id, 19) * 4, scale }));
  }, [plants, n, scrolls, width, catRoom]);

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
  const blooming = data?.plants.filter((p) => p.s >= KNOWN_STABILITY).length ?? 0;
  const label = data ? `Word garden: ${blooming} known, ${data.total - blooming} learning, ${data.seeds} new.` : "Word garden";
  const from = scrolls ? Math.max(0, scrollX - OVERSCAN) : 0;
  const to = scrolls ? Math.min(fullWidth, scrollX + width + OVERSCAN) : width;

  return (
    <div className={`garden ${compact ? "compact" : ""} ${scrolls ? "scrolls" : ""}`} ref={wrap} onPointerLeave={hide}>
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
          {visible.map(({ p, x, y, scale }) => (
            <g key={p.id} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} onPointerEnter={() => show({ p, x, y })} onClick={() => show({ p, x, y }, true)}>
              <g className="sway" style={{ animationDelay: `${-hash(p.id, 23) * 6}s`, animationDuration: `${5 + hash(p.id, 29) * 4}s` }}>
                <PlantShape p={p} scale={scale} highlighted={!!highlight?.has(p.id)} />
                {/* generous invisible hit area */}
                <rect x={-8} y={-140 * scale} width={16} height={140 * scale} fill="transparent" />
              </g>
            </g>
          ))}
          <path d={`M0 ${GROUND + 4} Q ${fullWidth * 0.25} ${GROUND - 3} ${fullWidth * 0.5} ${GROUND + 3} T ${fullWidth} ${GROUND + 1} V ${H} H 0 Z`} fill="url(#soil)" />
          {Array.from({ length: Math.ceil((to - from) / 38) }, (_, k) => {
            const i = Math.floor(from / 38) + k;
            const gx = (i + hash(String(i), 31)) * 38;
            return <path key={i} className="tuft" d={`M${gx} ${GROUND + 6} l -3 -7 M${gx} ${GROUND + 6} l 0 -9 M${gx} ${GROUND + 6} l 3 -6`} />;
          })}
          {Array.from({ length: seeds }, (_, i) => {
            const sx = (scrolls ? fullWidth - width : 0) + 24 + hash(`seed${i}`, 37) * (width - 48);
            const sy = GROUND + 14 + hash(`seed${i}`, 41) * 12;
            return <ellipse key={i} className="seed" cx={sx} cy={sy} rx={2.6} ry={1.7} transform={`rotate(${hash(`seed${i}`, 43) * 180} ${sx} ${sy})`} />;
          })}
        </svg>
        {snail && (
          <VisitorMark
            v={snail}
            art={SNAIL}
            scale={1.5}
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
            x={fullWidth - 30}
            onShow={(x) => {
              setHover(null);
              setVisitorTip({ v: cat, x });
            }}
            onHide={() => setVisitorTip(null)}
          />
        )}
      </div>
      {visitorTip && (
        <div className="visitor-tip" role="tooltip" style={{ left: Math.min(width - 150, Math.max(8, visitorTip.x - scrollX - 60)), top: GROUND - 58 }}>
          <i lang={visitors?.lang}>{visitorTip.v.word}</i>
          <span> · {visitorTip.v.gloss}</span>
        </div>
      )}
      {data && data.total === 0 && <p className="garden-empty">Your words will grow here.</p>}
      {hover && (
        <div className={onView ? "plant-tip interactive" : "plant-tip"} style={{ left: Math.min(width - 170, Math.max(8, hover.x - scrollX - 80)), top: 8 }} role="status" onPointerEnter={() => clearTimeout(switching.current)}>
          <strong>{hover.p.lemma}</strong>
          <span>{hover.p.gloss}</span>
          <em>
            {showcase ? (hover.p.s >= KNOWN_STABILITY ? "in bloom" : hover.p.s >= 3 ? "budding" : "a new sprout") : `${hover.p.s >= KNOWN_STABILITY ? "known" : "learning"} · ${hover.p.r >= 0.85 ? "fresh in memory" : "ready for practice"}`}
            {hover.p.listen && " · listening ✓"}
            {hover.p.write && " · writing ✓"}
          </em>
          {!showcase && <span className="tip-flavour">{plantLine(hover.p.lemma, hover.p.r < 0.7 ? "thirsty" : hover.p.s >= 200 ? "old" : hover.p.s >= KNOWN_STABILITY ? "bloom" : hover.p.s >= 3 ? "bud" : "sprout")}</span>}
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
}

/**
 * A visitor in the strip, standing on the soil line: a small pixel sprite in a
 * button, so it can be focused and tapped. Hover, focus or tap shows its word.
 */
function VisitorMark({ v, art, x, scale, onShow, onHide }: { v: VisitorView; art: PixelArt; x: number; scale: number; onShow: (x: number) => void; onHide: () => void }) {
  const w = art.rows[0].length;
  const h = art.rows.length;
  return (
    <button
      type="button"
      className={`garden-visitor visitor-${v.id}`}
      aria-label={`${v.word} · ${v.gloss}`}
      style={{ left: x - (w * scale) / 2, top: GROUND + 4 - h * scale }}
      onPointerEnter={() => onShow(x)}
      onPointerLeave={onHide}
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

export function GrowthStrip() {
  const stages: { label: string; s: number }[] = [
    { label: "new word", s: 0 },
    { label: "first review", s: 1.2 },
    { label: "learning", s: 4 },
    { label: "known", s: 30 },
    { label: "known well", s: 200 },
  ];
  return (
    <div className="growth-strip" aria-label="Each word grows from a seed to a flower as you remember it">
      {stages.map((st, i) => (
        <figure key={st.label} style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
          <svg width="72" height="150" viewBox="-36 -170 72 182" aria-hidden="true" className="garden-mini">
            <path d="M-34 4 Q0 -3 34 4 V12 H-34Z" fill="var(--soil-1)" />
            {st.s === 0 ? (
              <ellipse className="seed" cx="0" cy="6" rx="4" ry="2.6" />
            ) : (
              <g className="sway" style={{ animationDelay: `${-i}s` }}>
                <PlantShape p={{ id: `demo${i + 2}`, lemma: ["", "casa", "mañana", "Blume", "perennial"][i], gloss: "", s: st.s, r: 1, listen: st.s > 100, write: st.s > 100, order: 0 }} scale={1.25} highlighted={false} />
              </g>
            )}
          </svg>
          <figcaption>{st.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Small per-word status glyph for lists. */
export function StageGlyph({ s, reps, suspended }: { s: number; reps: number; suspended?: boolean }) {
  const stage = suspended ? "suspended" : reps === 0 ? "seed" : s >= KNOWN_STABILITY ? "bloom" : s >= 3 ? "bud" : "sprout";
  return (
    <svg className="glyph" viewBox="0 0 24 24" role="img" aria-label={stage}>
      {stage === "seed" && (
        <>
          <path d="M5 19.5h14" stroke="var(--soil-2)" strokeWidth="2" strokeLinecap="round" />
          <ellipse cx="12" cy="16.5" rx="3.4" ry="2.4" fill="var(--sun)" opacity="0.85" />
        </>
      )}
      {stage === "suspended" && (
        <g stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round">
          <path d="M9.5 8v8M14.5 8v8" />
        </g>
      )}
      {(stage === "sprout" || stage === "bud" || stage === "bloom") && <path d="M12 21v-10" stroke="var(--stem)" strokeWidth="1.8" strokeLinecap="round" />}
      {stage === "sprout" && (
        <>
          <path d="M12 12c0-3 2.5-5 5.5-5 0 3-2.5 5-5.5 5z" fill="var(--leaf-2)" />
          <path d="M12 13c0-2.6-2-4.3-4.6-4.3 0 2.6 2 4.3 4.6 4.3z" fill="var(--leaf-2)" />
        </>
      )}
      {stage === "bud" && <ellipse cx="12" cy="8" rx="3.4" ry="4.6" fill="var(--petal-2)" />}
      {stage === "bloom" && (
        <g transform="translate(12 8)">
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse key={a} rx="2" ry="3.6" fill="var(--petal-1)" transform={`rotate(${a}) translate(0 -3.4)`} />
          ))}
          <circle r="2.2" fill="var(--sun)" />
        </g>
      )}
    </svg>
  );
}
