// The garden you can walk in. Every word you have started is a plant in a
// raised bed; walk the paths, read the names, click a plant to hear it.
// The three.js scene loads only when this screen opens.

import "@fontsource/pixelify-sans/500.css";
import "@fontsource/pixelify-sans/700.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { language } from "../content/languages";
import type { LoadedDeck } from "../data/deck";
import { useLearner, type Learner } from "../data/learner";
import { track } from "../observability";
import { groupOf, layout, THIRSTY, type GardenPlant, type Layout, type PlacedPlant } from "../garden/world";
import type { Detail, GardenScene, TimeOfDay } from "../garden/scene";
import { loadingLine, plantLine } from "../content/voice";
import { takeFocus } from "./gardenFocus";
import { stageFor, WordPlant } from "./plant";
import { speak } from "./speech";
import { SoundToggle, useSound } from "./Sound";
import { KNOWN_STABILITY, recall } from "./stats";
import { plural } from "./format";

export interface WalkSource {
  plants: GardenPlant[];
  seeds: number;
}

const growthOf = (s: number) => Math.min(1, Math.log1p(s) / Math.log1p(120));

/** The learner's own garden: every word with progress is a plant. */
export function walkPlants(l: Learner, now = Date.now()): WalkSource {
  const strong = (id: string, skill: string) => {
    const m = l.memory.get(`${id}:${skill}`);
    return !!m && m.reps > 0 && m.s >= KNOWN_STABILITY;
  };
  const plants: GardenPlant[] = [];
  for (const m of l.memories) {
    const w = l.words.get(m.lexemeId);
    if (m.skill !== "read" || m.reps === 0 || !w || w.status === "ignored") continue;
    const known = m.s >= KNOWN_STABILITY && m.reps >= 2;
    plants.push({ id: w.id, lemma: w.lemma, gloss: w.gloss, pos: w.pos ?? "", rank: w.rank, s: m.s, r: recall(m, now), stage: stageFor(m.s, known), growth: growthOf(m.s), listen: strong(w.id, "listen"), write: strong(w.id, "write") });
  }
  return { plants, seeds: l.fresh().length };
}

/** A believable garden for visitors: the deck's common words at a spread of stages. */
export function showcaseWalkPlants(deck: LoadedDeck, count = 160): WalkSource {
  const plants = deck.words.slice(0, count).map((w, i) => {
    let h = 0;
    for (const ch of w.id) h = (h * 31 + ch.charCodeAt(0)) % 1000;
    const x = h / 1000;
    const s = x < 0.15 ? 1 + x * 10 : x < 0.35 ? 3 + x * 8 : 8 + (1 - i / count) * 120 * x;
    return { id: w.id, lemma: w.lemma, gloss: w.gloss, pos: w.pos, rank: w.rank, s, r: 0.95, stage: stageFor(s, s >= KNOWN_STABILITY), growth: growthOf(s), listen: false, write: false };
  });
  return { plants, seeds: 0 };
}

/** The walk-in garden for the signed-in learner. */
export function LearnerGardenWalk({ lang, onExit, onWater }: { lang: string; onExit: () => void; onWater: () => void }) {
  useEffect(() => track("garden_opened"), []);
  const learner = useLearner(lang);
  const source = useMemo(() => (learner ? walkPlants(learner) : null), [learner]);
  const [focus] = useState(takeFocus);
  return <GardenWalk lang={lang} source={source} onExit={onExit} onWater={onWater} focus={focus} />;
}

function initialTime(): TimeOfDay {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? "day" : h >= 18 && h < 21 ? "dusk" : "night";
}

const DETAIL_LABEL: Record<Detail, string> = { normal: "Normal quality", low: "Low quality" };
const QUALITY_KEY = "garden-quality";

/** The quality the viewer chose, or null if they never chose (then we may pick for them). */
function savedDetail(): Detail | null {
  try {
    const d = localStorage.getItem(QUALITY_KEY);
    if (d === "normal" || d === "low") return d;
  } catch {
    // Storage can be blocked; the default is fine.
  }
  return null;
}

const TIME_LABEL: Record<TimeOfDay, string> = { day: "Day", dusk: "Evening", night: "Night" };
const NEXT_TIME: Record<TimeOfDay, TimeOfDay> = { day: "dusk", dusk: "night", night: "day" };

function stageText(p: PlantView): string {
  if (p.stage === "bloom") return "In bloom: you know this word.";
  if (p.stage === "bud") return "Budding: you almost know this word.";
  return "A new sprout: you are learning this word.";
}

/** The plant's one line of personality (the same every time for this word). */
function personality(p: PlantView): string {
  if (p.r < THIRSTY) return plantLine(p.lemma, "thirsty");
  if (p.s >= 200) return plantLine(p.lemma, "old");
  return plantLine(p.lemma, p.stage === "bloom" ? "bloom" : p.stage === "bud" ? "bud" : "sprout");
}

type PlantView = PlacedPlant;

/** Without onWater it is view-only (the landing page): no watering, no sessions. */
export function GardenWalk({ lang, source, onExit, onWater, focus }: { lang: string; source: WalkSource | null; onExit: () => void; onWater?: () => void; focus?: string | null }) {
  const [data, setData] = useState<{ l: Layout; seeds: number } | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlantView | null>(null);
  const [labels, setLabels] = useState<{ id: string; text: string; x: number; y: number; near: number }[]>([]);
  const [time, setTime] = useState<TimeOfDay>(initialTime);
  const [hint, setHint] = useState(true);
  const [ready, setReady] = useState(false);
  const [detail, setDetail] = useState<Detail>(() => savedDetail() ?? "normal");
  const [notice, setNotice] = useState("");
  const [sound] = useSound();
  const chooseDetail = (d: Detail) => {
    setDetail(d);
    setNotice("");
    try {
      localStorage.setItem(QUALITY_KEY, d);
    } catch {
      // Not saved; it still applies now.
    }
  };
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<GardenScene | null>(null);
  const tag = language(lang).tag;

  // A snapshot of the garden when it opens: it does not change while you walk.
  useEffect(() => {
    if (source && !data) setData({ l: layout(source.plants), seeds: source.seeds });
  }, [source, data]);

  useEffect(() => {
    if (!data || !canvas.current || !wrap.current) return;
    let alive = true;
    let s: GardenScene | null = null;
    const el = wrap.current;
    const ro = new ResizeObserver(([e]) => s?.resize(e.contentRect.width, e.contentRect.height));
    void (async () => {
      const mod = await import("../garden/scene");
      if (!alive) return;
      if (!mod.webglAvailable()) return setFailed("Your browser cannot show 3D graphics.");
      try {
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        s = new mod.GardenScene(canvas.current!, data.l, { onSelect: setSelected, onLabels: setLabels, onProgress: (d, t) => setProgress([d, t]) }, reduced);
      } catch (e) {
        return setFailed(e instanceof Error ? e.message : String(e));
      }
      scene.current = s;
      s.setTime(time);
      s.setDetail(detail);
      const r = el.getBoundingClientRect();
      s.resize(r.width, r.height);
      ro.observe(el);
      s.start();
      setReady(true);
      // Opened from "View in garden": walk to that plant and show its card.
      const target = focus ? data.l.plants.find((p) => p.id === focus) : undefined;
      if (target) {
        s.select(target, true);
        setHint(false);
      }
      await s.loadPlants();
      if (alive) setProgress(null);
    })();
    return () => {
      alive = false;
      ro.disconnect();
      s?.dispose();
      scene.current = null;
      setReady(false);
    };
    // The scene is built once per snapshot; time changes go through setTime below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => scene.current?.setTime(time), [time]);
  useEffect(() => scene.current?.setDetail(detail), [detail]);

  // If the viewer never chose a quality and the garden runs slowly, switch to low quality once.
  useEffect(() => {
    if (!ready || detail !== "normal" || savedDetail()) return;
    let frames = 0;
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now + 1000; // let loading settle first
      else if (now > start) frames++;
      if (now < start + 3000) raf = requestAnimationFrame(tick);
      else if (frames / 3 < 40 && !document.hidden) {
        setDetail("low");
        setNotice("The garden was slow on this device, so it now uses low quality. You can change this at the top.");
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, detail]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  // Trackpad: two-finger swipe looks around, pinch walks forward and back.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".gw-card, .gw-top, .gw-bottom")) return;
      e.preventDefault();
      const s = scene.current;
      if (!s) return;
      const k = e.deltaMode === 1 ? 16 : 1; // lines to pixels
      if (e.ctrlKey) s.step(-e.deltaY * k * 0.02);
      else s.look(-e.deltaX * k, -e.deltaY * k);
      setHint(false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, [hint]);

  // Keyboard: W A S D or arrows walk (left and right arrows turn), Shift runs.
  useEffect(() => {
    const keys = new Set<string>();
    let turning = 0;
    const update = () => {
      const s = scene.current;
      if (!s) return;
      const k = (c: string) => keys.has(c);
      s.input.move.y = (k("KeyW") || k("ArrowUp") ? 1 : 0) - (k("KeyS") || k("ArrowDown") ? 1 : 0);
      s.input.move.x = (k("KeyD") ? 1 : 0) - (k("KeyA") ? 1 : 0);
      s.input.run = k("ShiftLeft") || k("ShiftRight");
      const turn = (k("ArrowLeft") || k("KeyQ") ? 1 : 0) - (k("ArrowRight") || k("KeyE") ? 1 : 0);
      cancelAnimationFrame(turning);
      if (turn) {
        const step = () => {
          scene.current?.turn(turn * 0.035);
          turning = requestAnimationFrame(step);
        };
        step();
      }
    };
    const WALK_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"];
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Escape") {
        if (scene.current && selectedRef.current) scene.current.select(null);
        else onExit();
        return;
      }
      if (!WALK_KEYS.includes(e.code)) return;
      e.preventDefault();
      keys.add(e.code);
      setHint(false);
      update();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.code);
      update();
    };
    const blur = () => {
      keys.clear();
      update();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      cancelAnimationFrame(turning);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [onExit]);

  const selectedRef = useRef<PlantView | null>(null);
  selectedRef.current = selected;

  // Drag to look; a click or tap without dragging picks a plant.
  const drag = useRef<{ x: number; y: number; moved: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.moved > 4) {
      scene.current?.look(dx, dy);
      setHint(false);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved > 6 || !scene.current || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    scene.current.select(scene.current.pick(e.clientX - r.left, e.clientY - r.top, r.width, r.height));
  };

  const stats = useMemo(() => {
    const ps = data?.l.plants ?? [];
    return { total: ps.length, bloom: ps.filter((p) => p.stage === "bloom").length, thirsty: ps.filter((p) => p.r < THIRSTY).length };
  }, [data]);

  const step = (dir: 1 | -1) => {
    const ps = data?.l.plants;
    if (!ps?.length || !scene.current) return;
    const i = selected ? ps.indexOf(selected) : dir === 1 ? -1 : 0;
    scene.current.select(ps[(i + dir + ps.length) % ps.length], true);
    setHint(false);
  };

  if (failed)
    return (
      <div className="gw-fallback page">
        <h1>Your garden</h1>
        <p>{failed}</p>
        <p className="muted">You can still see all your words in the Words list, and the small garden on the Today screen.</p>
        <div className="row">
          <button className="primary" onClick={onExit}>
            Back
          </button>
        </div>
      </div>
    );

  return (
    <div className={`gw gw-${time}`} ref={wrap}>
      <canvas
        ref={canvas}
        className="gw-canvas"
        aria-label="Your word garden in 3D. Use W, A, S and D or the arrow keys to walk. Drag to look around. Use the Next plant button to go from plant to plant."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      />
      <div className="gw-labels" aria-hidden="true">
        {labels.map((l) => (
          <span key={l.id} className={selected?.id === l.id ? "gw-label on" : "gw-label"} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, opacity: 0.35 + l.near * 0.65 }}>
            {l.text}
          </span>
        ))}
      </div>

      <div className="gw-top">
        <button className="gw-btn" onClick={onExit} aria-label="Back">
          ← <span className="gw-tool-label">Back</span>
        </button>
        <div className="gw-stats" aria-live="polite">
          {data && (stats.total ? `${plural(stats.total, "plant")} · ${stats.bloom} in bloom` : "No plants yet")}
          {data && data.seeds > 0 && <span className="gw-seeds"> · {plural(data.seeds, "seed")} ready</span>}
        </div>
        <div className="gw-tools">
          <SoundToggle className="gw-btn gw-icon" size={21} />
          <button
            className="gw-btn"
            onClick={() => chooseDetail(detail === "normal" ? "low" : "normal")}
            title={detail === "normal" ? "Use low quality: bigger pixels, faster on older devices" : "Use normal quality"}
            aria-label={`Quality: ${DETAIL_LABEL[detail]}`}
          >
            <span className={`gw-px gw-px-${detail}`} aria-hidden="true" />
            <span className="gw-tool-label">{DETAIL_LABEL[detail]}</span>
          </button>
          <button className="gw-btn" onClick={() => setTime(NEXT_TIME[time])} title="Change the time of day" aria-label={`Time of day: ${TIME_LABEL[time]}`}>
            <span aria-hidden="true">{time === "night" ? "☾" : time === "dusk" ? "◐" : "☀"}</span> <span className="gw-tool-label">{TIME_LABEL[time]}</span>
          </button>
        </div>
      </div>

      {progress && progress[1] > 0 && (
        <div className="gw-loading" role="status">
          {loadingLine()}… {Math.round((progress[0] / progress[1]) * 100)}%
        </div>
      )}

      {data && stats.total === 0 && onWater && (
        <div className="gw-card gw-empty">
          <strong>Your garden is empty</strong>
          <p className="small">Each word you learn grows into a plant here.</p>
          <button className="primary" onClick={onWater}>
            Learn my first words
          </button>
        </div>
      )}

      {notice && (
        <div className="gw-hint" role="status">
          {notice}
        </div>
      )}

      {!notice && hint && stats.total > 0 && !selected && (
        <div className="gw-hint">
          <span className="gw-hint-fine">Walk: W A S D or arrow keys · Look: drag or swipe with two fingers · Click a plant to see its word</span>
          <span className="gw-hint-coarse">Walk: use the circle · Look: drag · Tap a plant</span>
        </div>
      )}

      {selected && (
        <div className="gw-card" role="dialog" aria-label={`The plant for ${selected.lemma}`}>
          <button className="gw-close" onClick={() => scene.current?.select(null)} aria-label="Close">
            ×
          </button>
          <div className="gw-card-body">
            <WordPlant word={selected.lemma} s={selected.s} known={selected.stage === "bloom"} size={72} />
            <div>
              <strong className="gw-word" lang={lang}>
                {selected.lemma}
              </strong>
              <span className="gw-gloss">{selected.gloss}</span>
              <span className="muted small">
                {stageText(selected)} {selected.r < THIRSTY ? "It is a little thirsty: practise it soon." : `You remember it ${Math.round(selected.r * 100)}% of the time.`}
              </span>
              <span className="muted small gw-bed">In the bed for {groupOf(selected.pos).toLowerCase()}.</span>
              <span className="small gw-flavour">{personality(selected)}</span>
            </div>
          </div>
          <div className="row">
            {sound && (
              <button className="gw-btn gw-listen" onClick={() => void speak(selected.lemma, tag)}>
                🔊 Listen
              </button>
            )}
            <span className="gw-spacer" />
            <button className="gw-btn" onClick={() => step(-1)} aria-label="Previous plant">
              ←
            </button>
            <button className="gw-btn" onClick={() => step(1)}>
              Next plant →
            </button>
          </div>
        </div>
      )}

      <div className="gw-bottom">
        {ready && !selected && stats.total > 0 && (
          <button className="gw-btn" onClick={() => step(1)}>
            Next plant →
          </button>
        )}
        {onWater && stats.thirsty > 0 && !selected && (
          <button className="gw-btn gw-water" onClick={onWater}>
            💧 Water {plural(stats.thirsty, "thirsty plant")}
          </button>
        )}
      </div>

      <Joystick onMove={(x, y) => scene.current && ((scene.current.input.move.x = x), (scene.current.input.move.y = y), setHint(false))} />
    </div>
  );
}

/** A thumb stick for touch screens. Hidden where there is a mouse. */
function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const active = useRef<number | null>(null);
  const R = 44;
  const move = (e: React.PointerEvent) => {
    if (active.current !== e.pointerId || !base.current) return;
    const r = base.current.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) [dx, dy] = [(dx / d) * R, (dy / d) * R];
    setKnob([dx, dy]);
    onMove(dx / R, -dy / R);
  };
  const end = () => {
    active.current = null;
    setKnob([0, 0]);
    onMove(0, 0);
  };
  return (
    <div
      ref={base}
      className="gw-stick"
      aria-hidden="true"
      onPointerDown={(e) => {
        active.current = e.pointerId;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="gw-knob" style={{ transform: `translate(${knob[0]}px, ${knob[1]}px)` }} />
    </div>
  );
}
