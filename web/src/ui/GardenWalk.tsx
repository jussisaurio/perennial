// The garden you can walk in. Every word you have started is a plant in a
// raised bed; walk the paths, read the names, click a plant to hear it.
// The three.js scene loads only when this screen opens. The plants come from
// garden/plants.ts, shared with the 2D garden, so a word looks the same in both.

import "@fontsource/pixelify-sans/500.css";
import "@fontsource/pixelify-sans/700.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { language } from "../content/languages";
import type { LoadedDeck } from "../data/deck";
import { useLearner } from "../data/learner";
import { nextChunk } from "../data/practice";
import { track } from "../observability";
import { groupOf, type PlacedPlant } from "../garden/world";
import { plantMood, plantsFromLearner, showcasePlants, stageSentence, THIRSTY, type PlantSource } from "../garden/plants";
import type { Detail, TimeOfDay } from "../garden/scene";
import { EMPTY_WALK, loadingLine, plantLine, SLOW_DEVICE_NOTICE } from "../content/voice";
import { snoreLine } from "../garden/whimsy";
import { takeFocus } from "./gardenFocus";
import { WordPlant } from "./plant";
import { speak } from "./speech";
import { SoundToggle, useSound } from "./Sound";
import { plural } from "./format";
import { useGardenScene, useWalkInput } from "./useGardenScene";
import { learnerVisitors, type LearnerVisitors } from "./visitors";
import { frogCroak } from "../garden/visitors";

/** The landing page's walk: the same words, at the same stages, as its strip, without seeds to water (it is view-only). */
export function showcaseWalkPlants(deck: LoadedDeck, count = 160): PlantSource {
  return { ...showcasePlants(deck, count), seeds: 0 };
}

/** The walk-in garden for the signed-in learner. */
export function LearnerGardenWalk({ lang, onExit, onWater }: { lang: string; onExit: () => void; onWater: (minutes: number) => void }) {
  useEffect(() => track("garden_opened"), []);
  const learner = useLearner(lang);
  // The learner's own garden: the same plants as the 2D garden.
  const source = useMemo(() => (learner ? plantsFromLearner(learner) : null), [learner]);
  const visitors = useMemo(() => (learner ? learnerVisitors(learner) : null), [learner]);
  const [focus] = useState(takeFocus);
  // Watering is today's practice: the rest of today's 5 minutes, or 5 more once they are done.
  // Until the learner loads there are no plants (`source` is null), so nothing to water either.
  const water = learner ? () => onWater(nextChunk(learner).minutes) : undefined;
  return <GardenWalk lang={lang} source={source} visitors={visitors} onExit={onExit} onWater={water} focus={focus} />;
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

/** The plant's one line of personality (the same every time for this word, and the same as in the 2D garden). */
function personality(p: PlacedPlant): string {
  return plantLine(p.lemma, plantMood(p));
}

/** Without onWater it is view-only (the landing page): no watering, no sessions. */
export function GardenWalk({
  lang,
  source,
  visitors,
  onExit,
  onWater,
  focus,
}: {
  lang: string;
  source: PlantSource | null;
  /** Today's visitors (snail, cat, ...): a snapshot is taken when the garden opens. */
  visitors?: LearnerVisitors | null;
  onExit: () => void;
  onWater?: () => void;
  focus?: string | null;
}) {
  const [time, setTime] = useState<TimeOfDay>(initialTime);
  const [hint, setHint] = useState(true);
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
  const tag = language(lang).tag;
  const { data, scene, ready, failed, progress, labels, selected } = useGardenScene({ lang, source, visitors, focus, time, detail, wrap, canvas, onFocused: () => setHint(false) });
  const { onPointerDown, onPointerMove, onPointerCancel, endDrag, stick } = useWalkInput({ scene, wrap, selected, onExit, onMove: () => setHint(false) });

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
        setNotice(SLOW_DEVICE_NOTICE);
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

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, [hint]);

  const croaks = useRef(0);
  // A click or tap (not a drag) picks a visitor, a plant or the garden itself.
  const onPointerUp = (e: React.PointerEvent) => {
    if (!endDrag() || !scene.current || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    // A visitor first: its tag shows for a moment and, with sound on, it says its word. No card.
    const v = scene.current.pickVisitor(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (v) {
      // The frog croaks one of your known words instead (never its own name), in a bubble and, with sound on, aloud.
      if (v.id === "frog" && v.word) {
        const croak = frogCroak(visitors?.known ?? [], lang, croaks.current++);
        scene.current.say("frog", croak);
        if (sound) void speak(croak, tag);
        return;
      }
      scene.current.tapVisitor(v.id);
      if (sound && v.word) void speak(v.word, tag);
      return;
    }
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const p = scene.current.pick(x, y, r.width, r.height);
    scene.current.select(p);
    if (p) return;
    // Nothing else there: the garden itself (#74). Its tag shows for a moment and, with sound on, it says its word.
    const s = scene.current.pickScenery(x, y, r.width, r.height);
    if (!s) return;
    scene.current.tapScenery(s);
    setHint(false);
    if (sound) void speak(s.view.word, tag);
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
        onPointerCancel={onPointerCancel}
      />
      <div className="gw-labels" aria-hidden="true">
        {labels.map((l) =>
          l.kind === "say" ? (
            <span key={l.id} className="gw-say" lang={lang} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%` }}>
              {l.text}
            </span>
          ) : (l.kind === "visitor" || l.kind === "scenery") && !l.known ? (
            <span key={l.id} className="gw-tag" lang={lang} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, opacity: l.near }}>
              <i>{l.text}</i>
              <small lang="en"> · {l.gloss}</small>
            </span>
          ) : (
            <span key={l.id} className={selected?.id === l.id ? "gw-label on" : "gw-label"} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, opacity: l.kind === "visitor" || l.kind === "scenery" ? l.near : 0.35 + l.near * 0.65 }}>
              {l.known && <LeafMark />}
              {l.text}
            </span>
          ),
        )}
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
          <strong>{EMPTY_WALK.title}</strong>
          <p className="small">{EMPTY_WALK.body}</p>
          <button className="primary" onClick={onWater}>
            {EMPTY_WALK.cta}
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
            <WordPlant word={selected.lemma} s={selected.s} stage={selected.stage} size={72} />
            <div>
              <strong className="gw-word" lang={lang}>
                {selected.lemma}
              </strong>
              <span className="gw-gloss">{selected.gloss}</span>
              <span className="muted small">
                {stageSentence(selected.stage)} {selected.r < THIRSTY ? "It is a little thirsty: practise it soon." : `You remember it ${Math.round(selected.r * 100)}% of the time.`}
              </span>
              <span className="muted small gw-bed">In the bed for {groupOf(selected.pos).toLowerCase()}.</span>
              <span className="small gw-flavour">{personality(selected)}</span>
              {time === "night" && selected.id === data?.visitors.sleeper && (
                <span className="small gw-flavour gw-snore">
                  {snoreLine(lang)}
                </span>
              )}
            </div>
          </div>
          <div className="row">
            {sound && (
              <button
                className="gw-btn gw-listen"
                onClick={() => {
                  // The plant hears its name and perks up for a moment (#60).
                  scene.current?.nod(selected);
                  void speak(selected.lemma, tag);
                }}
              >
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

      <Joystick onMove={stick} />
    </div>
  );
}

/** A tiny pixel leaf: this visitor is also one of your words. */
function LeafMark() {
  return (
    <svg className="gw-leaf" viewBox="0 0 5 5" width="10" height="10" aria-hidden="true" shapeRendering="crispEdges">
      <path d="M3 0h2v2h-1v1h-1v1h-2v1h-1v-2h1v-1h1v-1h1z" fill="#8ccc6a" />
    </svg>
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
