// The word garden: every word you've started is a plant. Height follows
// memory stability, flowers open once a word is known, and plants droop as
// recall fades — until the next session waters them. Nothing ever dies.

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { freshLexemes } from "../content/builder";
import { db } from "../db/db";
import { Plant as WordPlantShape, stageFor } from "./plant";
import { KNOWN_STABILITY, recall } from "./stats";

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

const MAX_PLANTS = 280;
export type { Plant };
const H = 210;
const GROUND = H - 34;

function useGarden(courseId: string) {
  return useLiveQuery(async () => {
    const [memory, lexemes, fresh] = await Promise.all([
      db.memory.where("courseId").equals(courseId).toArray(),
      db.lexemes.where("courseId").equals(courseId).toArray(),
      freshLexemes(courseId),
    ]);
    const byLex = new Map(lexemes.map((l) => [l.id, l]));
    const now = Date.now();
    const plants: Plant[] = [];
    const skills = new Map<string, { listen: boolean; write: boolean }>();
    for (const m of memory) {
      if (m.skill === "read" || m.reps === 0 || m.s < KNOWN_STABILITY) continue;
      const cur = skills.get(m.lexemeId) ?? { listen: false, write: false };
      cur[m.skill] = true;
      skills.set(m.lexemeId, cur);
    }
    for (const m of memory) {
      const l = byLex.get(m.lexemeId);
      if (m.skill !== "read" || m.reps === 0 || !l || l.deleted || l.status === "ignored") continue;
      const sk = skills.get(l.id);
      plants.push({ id: l.id, lemma: l.lemma, gloss: l.gloss, s: m.s, r: recall(m, now), listen: !!sk?.listen, write: !!sk?.write, order: l.rank ?? 1e6 + l.addedAt / 1e9 });
    }
    plants.sort((a, b) => a.order - b.order);
    return { plants: plants.slice(0, MAX_PLANTS), total: plants.length, seeds: fresh.length };
  }, [courseId]);
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

export function Garden({ courseId, highlight, compact }: { courseId: string; highlight?: Set<string>; compact?: boolean }) {
  const data = useGarden(courseId);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<{ p: Plant; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    const plants = data?.plants ?? [];
    const n = plants.length;
    const pad = 18;
    // Small gardens cluster in the middle instead of scattering across the width.
    const spacing = n ? Math.min(34, (width - pad * 2) / n) : width;
    const offset = (width - spacing * n) / 2;
    // Dense gardens get a back row for depth.
    const twoRows = spacing < 14;
    const scale = Math.max(0.42, Math.min(1.05, (twoRows ? spacing * 2 : spacing) / 20));
    return plants.map((p, i) => {
      const back = twoRows && hash(p.id, 13) > 0.5;
      const jitter = (hash(p.id, 17) - 0.5) * spacing * 0.8;
      return { p, x: offset + spacing * (i + 0.5) + jitter, y: GROUND - (back ? 10 : 0) + hash(p.id, 19) * 4, scale: scale * (back ? 0.8 : 1), back };
    });
  }, [data, width]);

  const seeds = Math.min(data?.seeds ?? 0, 24);
  const blooming = data?.plants.filter((p) => p.s >= KNOWN_STABILITY).length ?? 0;
  const label = data ? `Word garden: ${blooming} known, ${data.total - blooming} learning, ${data.seeds} new.` : "Word garden";

  return (
    <div className={`garden ${compact ? "compact" : ""}`} ref={wrap}>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--soil-1)" />
            <stop offset="1" stopColor="var(--soil-2)" />
          </linearGradient>
        </defs>
        {Array.from({ length: 6 }, (_, i) => (
          <circle key={i} className="firefly" cx={(width / 6) * (i + 0.5)} cy={40 + (i % 3) * 30} r={1.8} style={{ animationDelay: `${i * 1.3}s` }} />
        ))}
        {[...layout].sort((a, b) => Number(b.back) - Number(a.back)).map(({ p, x, y, scale, back }) => (
          <g key={p.id} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} opacity={back ? 0.72 : 1} onPointerEnter={() => setHover({ p, x, y })} onClick={() => setHover({ p, x, y })}>
            <g className="sway" style={{ animationDelay: `${-hash(p.id, 23) * 6}s`, animationDuration: `${5 + hash(p.id, 29) * 4}s` }}>
              <PlantShape p={p} scale={scale} highlighted={!!highlight?.has(p.id)} />
              {/* generous invisible hit area */}
              <rect x={-8} y={-140 * scale} width={16} height={140 * scale} fill="transparent" />
            </g>
          </g>
        ))}
        <path d={`M0 ${GROUND + 4} Q ${width * 0.25} ${GROUND - 3} ${width * 0.5} ${GROUND + 3} T ${width} ${GROUND + 1} V ${H} H 0 Z`} fill="url(#soil)" />
        {Array.from({ length: Math.floor(width / 38) }, (_, i) => {
          const gx = (i + hash(String(i), 31)) * 38;
          return <path key={i} className="tuft" d={`M${gx} ${GROUND + 6} l -3 -7 M${gx} ${GROUND + 6} l 0 -9 M${gx} ${GROUND + 6} l 3 -6`} />;
        })}
        {Array.from({ length: seeds }, (_, i) => {
          const sx = 24 + hash(`seed${i}`, 37) * (width - 48);
          const sy = GROUND + 14 + hash(`seed${i}`, 41) * 12;
          return <ellipse key={i} className="seed" cx={sx} cy={sy} rx={2.6} ry={1.7} transform={`rotate(${hash(`seed${i}`, 43) * 180} ${sx} ${sy})`} />;
        })}
      </svg>
      {data && data.total === 0 && <p className="garden-empty">Your words will grow here.</p>}
      {hover && (
        <div className="plant-tip" style={{ left: Math.min(width - 170, Math.max(8, hover.x - 80)), top: 8 }} role="status">
          <strong>{hover.p.lemma}</strong>
          <span>{hover.p.gloss}</span>
          <em>
            {hover.p.s >= KNOWN_STABILITY ? "known" : "learning"} · {hover.p.r >= 0.85 ? "fresh in memory" : "ready for practice"}
            {hover.p.listen && " · listening ✓"}
            {hover.p.write && " · writing ✓"}
          </em>
        </div>
      )}
      {data && !compact && (
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
        </div>
      )}
    </div>
  );
}

/** Seed → sprout → bud → bloom, drawn with the real plant renderer. Explains the metaphor at a glance. */
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
