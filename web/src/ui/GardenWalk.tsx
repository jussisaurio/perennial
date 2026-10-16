// The garden you can walk in. Every word you have started is a plant in a
// raised bed; walk the paths, read the names, click a plant to hear it.
// The three.js scene loads only when this screen opens. The plants come from
// garden/plants.ts, shared with the 2D garden, so a word looks the same in both.

import "@fontsource/pixelify-sans/500.css";
import "@fontsource/pixelify-sans/700.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { language } from "../content/languages";
import type { LoadedDeck } from "../data/deck";
import { openDoor, useLearner, useStore } from "../data/learner";
import { chunkLabel, nextChunk } from "../data/practice";
import { track } from "../observability";
import { DOOR_LINES, groupOf, keyHelp, keySpot, type KeySpot, type PlacedPlant } from "../garden/world";
import { plantMood, plantsFromLearner, showcasePlants, stageSentence, THIRSTY, type PlantSource } from "../garden/plants";
import type { Detail, DoorState, Reach, TimeOfDay } from "../garden/scene";
import type { TapHit } from "../garden/scenePart";
import { EMPTY_WALK, loadingLine, plantLine } from "../content/voice";
import { snoreLine } from "../garden/whimsy";
import { takeFocus } from "./gardenFocus";
import { WordPlant } from "./plant";
import { speak } from "./speech";
import { SoundToggle, useSound } from "./Sound";
import { plural } from "./format";
import { useNow } from "./useNow";
import { useGardenScene, useWalkInput } from "./useGardenScene";
import { gardenBroughtAt, learnerVisitors, type LearnerVisitors } from "./visitors";
import { frogCroak } from "../garden/visitors";

/** The door's line as a screen reader hears it: the locked line also says where this learner's key lies, once there is one. */
function spokenLine(line: string | undefined, state: DoorState): string | undefined {
  return line === DOOR_LINES.locked && typeof state === "object" ? `${line} ${KEY_PLACE[state.key]}` : line;
}

/** What the learner did in the walk, for counting (#335): what a tap met (TapHit kinds), or what the action button did (#334). */
type GardenVerb = TapHit["kind"] | Reach;

/** The landing page's walk: the same words, at the same stages, as its strip, without seeds to water (it is view-only). */
export function showcaseWalkPlants(deck: LoadedDeck, count = 160): PlantSource {
  return { ...showcasePlants(deck, count), seeds: 0 };
}

/** The walk-in garden for the signed-in learner. */
export function LearnerGardenWalk({ lang, onExit, onWater }: { lang: string; onExit: () => void; onWater: (minutes: number) => void }) {
  useEffect(() => track("garden_opened"), []);
  // What the learner does in the walk (#335): how many taps of each kind (walk, plant, door...) and presses of the
  // action button by what it did (sit, key...), one event per kind,
  // sent when the walk closes, or when the page is hidden: on a phone the walk is often left by locking it, not closed.
  // Kinds and counts only: no places, no words.
  const taps = useRef(new Map<GardenVerb, number>());
  useEffect(() => {
    const send = () => {
      for (const [verb, count] of taps.current) track("garden_action", { verb, count });
      taps.current.clear();
    };
    const hidden = () => document.visibilityState === "hidden" && send();
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      send();
    };
  }, []);
  // `?? 0`: the first tap of its kind this visit.
  const onTap = (verb: GardenVerb) => taps.current.set(verb, (taps.current.get(verb) ?? 0) + 1);
  const learner = useLearner(lang);
  // The learner's own garden: the same plants as the 2D garden.
  const source = useMemo(() => (learner ? plantsFromLearner(learner) : null), [learner]);
  const visitors = useMemo(() => (learner ? learnerVisitors(learner) : null), [learner]);
  const store = useStore();
  const now = useNow();
  // The door in the hedge (#315): open for good once opened; until then the key hides in the garden once "key" brought it,
  // always in the same place for this learner and course, and the world helps once it has waited a few days (#334).
  // Until the learner loads there is no garden to walk (`source` is null), so "locked" is never shown then.
  // door_open is missing from course rows Electric streams before its first course change after the migration: closed, as it was.
  // The help is for today (`now`); the walk takes its snapshot as it opens.
  const door = useMemo(() => {
    const since = learner ? gardenBroughtAt(learner, "key") : null;
    const state: DoorState = !learner
      ? "locked"
      : learner.course.door_open
        ? "open"
        : since !== null
          ? { key: keySpot(`${learner.course.user_id}:${lang}`), help: keyHelp(since, now) }
          : "locked";
    // A write the server refuses is told by the refused-writes notice (#253); this walk keeps its door open.
    return { state, open: () => void openDoor(store, lang).catch((e) => console.error("door not saved", e)) };
  }, [learner, store, lang, now]);
  const [focus] = useState(takeFocus);
  // Watering is today's practice: the rest of today's 5 minutes, or 5 more once they are done,
  // named as Today names it, and worked out with the clock, so a walk open past midnight starts the new day.
  // Until the learner loads there are no plants (`source` is null), so nothing to water either.
  const chunk = learner ? nextChunk(learner, now) : null;
  const water = learner && chunk ? { label: chunk.state === "finish" ? `${chunkLabel(chunk)} · ${chunk.minutes} min` : chunkLabel(chunk), start: () => onWater(nextChunk(learner).minutes) } : undefined;
  const [hint] = useState(() => ({ show: !hintSeen(), moved: markHintSeen }));
  return <GardenWalk lang={lang} source={source} visitors={visitors} door={door} onExit={onExit} water={water} focus={focus} onTap={onTap} hint={hint} />;
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

/**
 * The action button (#334) shows only an icon, which changes shape with what it
 * does: you find out by pressing it. A screen reader hears what it does, said
 * plainly: mystery must not lock anyone out.
 */
const REACH_NAME: Record<Reach, string> = { try: "Try the door", key: "Pick up the key", open: "Open the door with the key", sit: "Sit on the bench", stand: "Stand up" };
/** An open hand, in pixels: try the door, pick up the key. */
const HAND = ["....#.....", "..#.#.#...", "..#.#.#...", "..#.#.#.#.", "..#.#.#.#.", "#.#######.", "##########", ".#########", "..#######.", "...#####..", "...#####.."];
const REACH_ICON: Record<Reach, readonly string[]> = {
  try: HAND,
  key: HAND,
  open: ["..###.......", ".#...#......", ".#...#######", ".#...#..#.#.", "..###...#.#."],
  sit: ["#.......", "#.......", "#.......", "########", "#......#", "#......#"],
  stand: ["...#...", "..###..", ".#####.", "#######", "..###..", "..###..", "..###.."],
};

/**
 * Where the key lies, said only to screen readers (#315, #334): what a seeing
 * learner might spot cannot be heard, and a blind search would keep them out
 * of the orchard. Said as a thing in the world, not as an instruction.
 */
const KEY_PLACE: Record<KeySpot, string> = {
  bench: "Something small glints under the bench.",
  pond: "Something small glints among the stones by the pond.",
  lantern: "Something small glints by the lantern farthest from the door.",
  bed: "Something small glints by the bed farthest from the door.",
  sunflower: "Something small glints by the sunflower.",
};

/**
 * The controls hint (#334) shows in the learner's own walk until they first
 * move: it teaches the controls, and they stay the same. The landing page's
 * walk shows it each time and never uses it up.
 */
const HINT_SEEN_KEY = "garden-hint-seen";

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_SEEN_KEY) === "1";
  } catch {
    // Storage can be blocked: then the hint shows each time, as it did before.
    return false;
  }
}

function markHintSeen() {
  try {
    localStorage.setItem(HINT_SEEN_KEY, "1");
  } catch {
    // Not saved: it shows again next time.
  }
}

/** The landing page's walk: the hint shows each time, and nothing is saved. */
const SHOWCASE_HINT = { show: true, moved: () => {} };

/** The landing page's walk: the door stays locked, and there is nothing to save. */
const SHOWCASE_DOOR = { state: "locked" as const, open: () => {} };

/** The plant's one line of personality (the same every time for this word, and the same as in the 2D garden). */
function personality(p: PlacedPlant): string {
  return plantLine(p.lemma, plantMood(p));
}

/** Without `water` it is view-only (the landing page): no watering, no sessions. */
export function GardenWalk({
  lang,
  source,
  visitors,
  door = SHOWCASE_DOOR,
  onExit,
  water,
  focus,
  onTap,
  hint: hintFirst = SHOWCASE_HINT,
}: {
  lang: string;
  source: PlantSource | null;
  /** Today's visitors (snail, cat, ...): a snapshot is taken when the garden opens. */
  visitors?: LearnerVisitors | null;
  /** The door in the hedge (#315), and how to save it once opened. Without it (the landing page) the door stays locked. */
  door?: { state: DoorState; open: () => void };
  onExit: () => void;
  /** Starts practice; `label` says what it starts. */
  water?: { label: string; start: () => void };
  focus?: string | null;
  /** A tap met something in the walk (or open ground to walk to), or the action button did something: what, for counting (#335). */
  onTap?: (verb: GardenVerb) => void;
  /** Whether the controls hint shows, and what to do once the viewer first moves while it shows. */
  hint?: { show: boolean; moved: () => void };
}) {
  const [time, setTime] = useState<TimeOfDay>(initialTime);
  const [hint, setHint] = useState(hintFirst.show);
  const [detail, setDetail] = useState<Detail>(() => savedDetail() ?? "normal");
  const [sound] = useSound();
  const chooseDetail = (d: Detail) => {
    setDetail(d);
    try {
      localStorage.setItem(QUALITY_KEY, d);
    } catch {
      // Not saved; it still applies now.
    }
  };
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tag = language(lang).tag;
  const { data, scene, ready, failed, progress, labels, selected, reach } = useGardenScene({ lang, source, visitors, door, focus, time, detail, wrap, canvas, onFocused: () => setHint(false) });
  // A plant chosen from outside its card (the summary's "See it in the garden", a click in
  // the scene) takes focus to the card, so a screen reader reads it (#266). From the
  // card's own Next plant, focus stays on that button and the live card body is read.
  const dialog = useRef<HTMLDivElement>(null);
  const selectedId = selected?.id;
  useEffect(() => {
    if (selectedId && !dialog.current!.contains(document.activeElement)) dialog.current!.focus({ preventScroll: true });
  }, [selectedId]);
  const { onPointerDown, onPointerMove, onPointerCancel, endDrag, stick } = useWalkInput({ scene, wrap, selected, onExit, onMove: () => moved() });

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, [hint]);

  const croaks = useRef(0);
  // A click or tap (not a drag) picks a visitor, a plant, an orchard tree, the
  // door or key, open ground to walk to, or the garden itself, in that order
  // (one dispatcher, #323): whichever it meets first wins. Tapping anything but
  // a visitor or a plant (or nothing) closes a plant's card; a plant opens its
  // own, once you are near it (#336).
  const onPointerUp = (e: React.PointerEvent) => {
    if (!endDrag() || !scene.current || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    const hit = scene.current.pickAny(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (hit?.kind !== "visitor" && hit?.kind !== "plant") scene.current.select(null);
    if (hit) onTap?.(hit.kind);
    switch (hit?.kind) {
      case "visitor":
        // An awake frog croaks one of your known words instead (never its own name), in a bubble and, with sound on, aloud.
        // Asleep (by day), it is tapped like any visitor: its tag and its word. No card.
        if (hit.v.id === "frog" && hit.v.word && scene.current.frogAwake()) {
          const croak = frogCroak(visitors?.known ?? [], lang, croaks.current++);
          scene.current.say("frog", croak);
          if (sound) void speak(croak, tag);
          return;
        }
        scene.current.tapVisitor(hit.v.id);
        if (sound && hit.v.word) void speak(hit.v.word, tag);
        return;
      case "plant":
        // Its card opens here when it is near, or once you have walked up to it.
        scene.current.tapPlant(hit.p);
        return;
      case "tree":
        // An orchard tree (#315): its word and meaning over it for a moment and, with sound on, its word.
        scene.current.tapTree(hit.t);
        setHint(false);
        if (sound) void speak(hit.t.lemma, tag);
        return;
      case "door":
        // The key, or the shut door (#315): its quiet line, or it opens; from afar, once you have walked up to it.
        scene.current.tapDoor(hit.a);
        setHint(false);
        return;
      case "walk":
        scene.current.walkTo(hit.x, hit.z);
        moved();
        return;
      case "scenery":
        // The garden itself (#74). Its tag shows for a moment and, with sound on, it says its word.
        scene.current.tapScenery(hit.s);
        setHint(false);
        if (sound) void speak(hit.s.view.word, tag);
        return;
      default:
        return; // nothing there: already deselected above
    }
  };

  const stats = useMemo(() => {
    const ps = data?.l.plants ?? [];
    return { total: ps.length, bloom: ps.filter((p) => p.stage === "bloom").length };
  }, [data]);

  const hintShown = hint && stats.total > 0 && !selected;
  /** The viewer walked or looked: the hint goes and, if they saw it, it has done its job. */
  const moved = () => {
    if (hintShown) hintFirst.moved();
    setHint(false);
  };

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
        <p>{failed.text}</p>
        <p className="muted">You can still see all your words in the Words list, and the small garden on the Today screen.</p>
        <div className="row">
          {failed.retry && (
            <button className="primary" onClick={() => location.reload()}>
              Try again
            </button>
          )}
          <button className={failed.retry ? "ghost" : "primary"} onClick={onExit}>
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
        tabIndex={-1}
        aria-label="Your word garden in 3D. Use W, A, S and D or the arrow keys to walk. Drag to look around. Use the Next plant button to go from plant to plant."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
      {/* The door's quiet line, for screen readers: the drawn labels are hidden from them. They also hear where the key lies, and when it is at their feet. */}
      <div className="sr-only" role="status">
        {reach === "key" ? "The key is here." : spokenLine(labels.find((l) => l.kind === "line")?.text, door.state)}
      </div>
      <div className="gw-labels" aria-hidden="true">
        {labels.map((l) =>
          l.kind === "say" || l.kind === "line" ? (
            <span key={l.id} className="gw-say" lang={l.kind === "line" ? "en" : lang} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%` }}>
              {l.text}
            </span>
          ) : l.kind === "tree" || ((l.kind === "visitor" || l.kind === "scenery") && !l.known) ? (
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
            className="gw-btn gw-quality"
            onClick={() => chooseDetail(detail === "normal" ? "low" : "normal")}
            title={detail === "normal" ? "Use low quality: bigger pixels, faster on older devices" : "Use normal quality"}
            aria-label={`Quality: ${DETAIL_LABEL[detail]}`}
          >
            <span className={`gw-px gw-px-${detail}`} aria-hidden="true" />
            <span className="gw-tool-label">{DETAIL_LABEL[detail]}</span>
          </button>
          <button className="gw-btn gw-time" onClick={() => setTime(NEXT_TIME[time])} title="Change the time of day" aria-label={`Time of day: ${TIME_LABEL[time]}`}>
            <span className="gw-glyph" aria-hidden="true">{time === "night" ? "☾" : time === "dusk" ? "◐" : "☀"}</span> <span className="gw-tool-label">{TIME_LABEL[time]}</span>
          </button>
        </div>
      </div>

      {progress && progress[1] > 0 && (
        <div className="gw-loading" role="status">
          {loadingLine()}… {Math.round((progress[0] / progress[1]) * 100)}%
        </div>
      )}

      {data && stats.total === 0 && water && (
        <div className="gw-card gw-empty">
          <strong>{EMPTY_WALK.title}</strong>
          <p className="small">{EMPTY_WALK.body}</p>
          <button className="primary" onClick={water.start}>
            {EMPTY_WALK.cta}
          </button>
        </div>
      )}

      {hintShown && (
        <div className="gw-hint">
          <span className="gw-hint-fine">Walk: W A S D, arrow keys or click the ground · Look: drag or swipe with two fingers · Click a plant to see its word</span>
          <span className="gw-hint-coarse">Walk: tap the ground or use the circle · Look: drag · Tap a plant</span>
        </div>
      )}

      {selected && (
        <div className="gw-card" role="dialog" aria-label={`The plant for ${selected.lemma}`} ref={dialog} tabIndex={-1}>
          <button className="gw-close" onClick={() => scene.current?.select(null)} aria-label="Close">
            ×
          </button>
          <div className="gw-card-body" aria-live="polite">
            <WordPlant word={selected.lemma} s={selected.s} stage={selected.stage} size={72} />
            <div>
              <strong className="gw-word" lang={lang}>
                {selected.lemma}
              </strong>
              <span className="gw-gloss">{selected.gloss}</span>
              <span className="muted small">
                {/* No recall number: right after an answer it reads 100%, which looks made up (#261). */}
                {stageSentence(selected.stage)} {selected.r < THIRSTY && "It is a little thirsty."}
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
              Next plant <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}

      <div className="gw-bottom">
        {reach && !selected && (
          <button
            className="gw-btn gw-icon gw-act"
            aria-label={REACH_NAME[reach]}
            onClick={() => {
              scene.current?.act(reach);
              onTap?.(reach);
              // After the door opens or the key is picked up there may be nothing in reach: keep keyboard focus in the walk, not lost to the page.
              if (reach === "open" || reach === "key") canvas.current?.focus({ preventScroll: true });
            }}
          >
            <PixelIcon rows={REACH_ICON[reach]} />
          </button>
        )}
        {ready && !selected && stats.total > 0 && (
          <button className="gw-btn" onClick={() => step(1)}>
            Next plant <span aria-hidden="true">→</span>
          </button>
        )}
        {/* Named for what it starts, with no count of thirsty plants: Today keeps missed days from piling up, and so does the walk (#263). */}
        {water && stats.total > 0 && !selected && (
          <button className="gw-btn gw-water" onClick={water.start}>
            💧 {water.label}
          </button>
        )}
      </div>

      <Joystick onMove={stick} />
    </div>
  );
}

/** A small pixel-art icon from rows of "#" (drawn) and "." (empty), in the button's colour. */
function PixelIcon({ rows }: { rows: readonly string[] }) {
  const w = Math.max(...rows.map((r) => r.length));
  const d = rows.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === "#" ? [`M${x} ${y}h1v1h-1z`] : []))).join("");
  return (
    <svg viewBox={`-1 -1 ${w + 2} ${rows.length + 2}`} width="32" height="32" aria-hidden="true" shapeRendering="crispEdges">
      <path d={d} fill="currentColor" />
    </svg>
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
