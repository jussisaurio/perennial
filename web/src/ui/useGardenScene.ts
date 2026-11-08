// The walk-in garden's hooks: building the three.js scene from a snapshot of
// the garden (useGardenScene), and walking and looking around in it with keys,
// trackpad and drags (useWalkInput). GardenWalk.tsx draws everything around it.

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { isDeckLang } from "../deck/langs";
import { reportSlowWalk, reportStalledWalk } from "../observability";
import type { PlantSource } from "../garden/plants";
import { DETAIL, type Detail } from "../garden/detail";
import type { DoorState, GardenScene, Label, Reach, TimeOfDay, WalkIntoEvent, WalkVisitors } from "../garden/scene";
import type { CarryDone } from "../garden/sceneCarry";
import type { Companion } from "../garden/bench";
import type { ToyDone } from "../garden/sceneToys";
import type { ToysWalk } from "../garden/toys";
import { sceneryViews } from "../garden/scenery";
import { moonPhase } from "../garden/moon";
import { sleeperId } from "../garden/whimsy";
import { isAutumn } from "../core/day";
import { wakeAudio } from "./chime";
import { layout, type Layout, type PlacedPlant } from "../garden/world";
import type { Focus } from "./gardenFocus";
import type { LearnerVisitors } from "./visitors";

/** A press held this long (ms) without moving is a long press (#357). */
const HOLD_MS = 500;

/**
 * Dev and perf builds only: a detail the tests fix with `window.__gardenDetail`
 * (e2e/helpers.ts pinDetail), so the frames of a slow test machine do not
 * change what a test sees, or what the perf run measures.
 */
function pinnedDetail(): Detail | null {
  if (!import.meta.env.DEV && import.meta.env.VITE_DEV_TOOLS !== "1") return null;
  const d = (window as unknown as { __gardenDetail?: unknown }).__gardenDetail;
  if (d === undefined) return null;
  if (typeof d === "string" && d in DETAIL) return d as Detail;
  throw new Error(`__gardenDetail is "${String(d)}": use one of ${Object.keys(DETAIL).join(", ")}`);
}

interface WalkData {
  l: Layout;
  seeds: number;
  visitors: WalkVisitors;
}

/**
 * The scene for this garden. A snapshot is taken when the garden opens (it does
 * not change while you walk) and the scene is built once from it; time of day
 * changes go to the running scene, which picks its own detail (#677).
 * `onFocused`: the scene walked to `focus` and opened its card. `door`: the door in the hedge (#315), and how to
 * save it once it is opened. `toys`: the dandelion clocks (#360), and what to
 * do when one is blown. `onShake`: a plant was shaken (#357), and the forms
 * that fell from it. `onCarry`: a loose thing was picked up or put down, or it
 * landed (#358).
 * `notes`: the gardener's notes on the shed's nails (#654), by id and whether
 * each is unread, those under the stile's step (#714, null: no stile yet), the
 * diary's pages on the hill (#858, null: no diary yet), and what to do when one
 * is opened.
 */
/** The kinds of label whose words GardenWalk's screen-reader status says. */
const SPOKEN = new Set<Label["kind"]>(["fruit", "echo", "line", "far", "scenery"]);

/** A value the scene changes often (the labels each frame, the load's percent), for useSyncExternalStore: only the part that reads it renders then (#713). */
export interface Store<T> {
  get: () => T;
  set: (value: T) => void;
  subscribe: (onChange: () => void) => () => void;
}

function store<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      value = v;
      for (const f of subs) f();
    },
    subscribe: (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

export function useGardenScene({
  lang,
  source,
  visitors,
  door,
  walkInto,
  toys,
  focus,
  time,
  wrap,
  canvas,
  onFocused,
  onSelect,
  onShake,
  onCarry,
  notes,
}: {
  lang: string;
  source: PlantSource | null;
  visitors?: LearnerVisitors | null;
  door: { state: DoorState; open: () => void };
  /** The walker brushed a plant, bumped a tree or burst a leaf pile (#359). */
  walkInto: (e: WalkIntoEvent) => void;
  toys: { walk: ToysWalk; done: (d: ToyDone) => void };
  focus?: Focus | null;
  time: TimeOfDay;
  wrap: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  onFocused: () => void;
  /** The scene opened a plant's card, or closed it (null). */
  onSelect: (p: PlacedPlant | null) => void;
  onShake: (p: PlacedPlant, forms: string[]) => void;
  onCarry: (d: CarryDone) => void;
  notes: { nails: readonly { id: string; unread: boolean }[]; stile: readonly string[] | null; diary: readonly { id: string; unread: boolean }[] | null; open: (id: string) => void };
}) {
  const [data, setData] = useState<WalkData | null>(null);
  // How much of the garden has loaded, as a percent (null: not loading). It changes on each load chunk, so only the loading line reads it (#727).
  const [progress] = useState(() => store<number | null>(null));
  // `retry`: loading again can help (its code did not load), so the page offers it; an installed app has no reload button.
  const [failed, setFailed] = useState<{ text: string; retry?: true } | null>(null);
  // The labels move on every walking frame: they go to a store that only the label layer reads, so only it renders then (#713).
  const [labels] = useState(() => store<Label[]>([]));
  // The tags a screen reader hears of (a fallen fruit, the echo, the door's line) change rarely: state, set only when one comes, goes or changes its words.
  const [spoken, setSpoken] = useState<Label[]>([]);
  const spokenKey = useRef("");
  const [ready, setReady] = useState(false);
  const [reach, setReach] = useState<Reach | null>(null);
  const [holding, setHolding] = useState(false);
  const [company, setCompany] = useState<Companion | null>(null);
  const [stars, setStars] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const scene = useRef<GardenScene | null>(null);
  // The scene is built once; it saves the door through whatever the page passes now.
  const openDoor = useRef(door.open);
  const shakeNow = useRef(onShake);
  const walkIntoNow = useRef(walkInto);
  const carryNow = useRef(onCarry);
  const toysNow = useRef(toys);
  const noteNow = useRef(notes.open);
  const selectNow = useRef(onSelect);
  // Before the browser paints, so the scene never calls the ones from before.
  useLayoutEffect(() => {
    openDoor.current = door.open;
    shakeNow.current = onShake;
    walkIntoNow.current = walkInto;
    carryNow.current = onCarry;
    toysNow.current = toys;
    noteNow.current = notes.open;
    selectNow.current = onSelect;
  });
  const timeNow = useRef(time);

  // A snapshot of the garden when it opens: it does not change while you walk.
  const [openedAt] = useState(() => Date.now());
  if (source && !data) {
    const l = layout(source.plants, source.aside);
    const first = source.first && l.plants.some((p) => p.id === source.first!.id) ? source.first : null;
    setData({
      l,
      seeds: source.seeds,
      visitors: {
        list: visitors?.views ?? [],
        keepsake: first,
        sleeper: sleeperId(l.plants.filter((p) => p.stage === "bloom").map((p) => p.id)),
        scenery: visitors?.scenery ?? sceneryViews(lang),
        door: door.state,
        orchard: { trees: source.orchard, firstPlanted: source.first ? source.first.at : null },
        autumn: isAutumn(new Date(openedAt)),
        toys: toys.walk,
        // Tonight's real moon (#361), as the walk opens: the same as outside the window.
        moon: moonPhase(openedAt),
        met: source.met,
        // The landing page's walk has no learner, and no visitors to hide.
        firstReview: visitors ? visitors.facts.firstReview : null,
        notes: notes.nails,
        stile: notes.stile,
        diary: notes.diary,
      },
    });
  }

  useEffect(() => {
    if (!data || !canvas.current || !wrap.current) return;
    let alive = true;
    let s: GardenScene | null = null;
    const el = wrap.current;
    const cv = canvas.current;
    const ro = new ResizeObserver(([e]) => s?.resize(e.contentRect.width, e.contentRect.height));
    void (async () => {
      const mod = await import("../garden/scene").catch((e: unknown) => {
        // main.tsx did not reload (it reloads at most once a minute): say so, not a garden stuck loading.
        console.error("[garden] the 3D garden's code did not load", e);
        return "failed" as const;
      });
      // undefined: this tab runs a release whose chunk is gone after a deploy; main.tsx is reloading the page.
      if (!alive || !mod) return;
      if (mod === "failed") return setFailed({ text: "The garden could not load.", retry: true });
      try {
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        // Every course has a deck (synced courses pass `teachable`, the landing page's draft isDeckLang), and the world is written in its language (#650).
        if (!isDeckLang(lang)) throw new Error(`No garden for the course "${lang}"`);
        s = new mod.GardenScene(
          cv,
          data.l,
          {
            onSelect: (p) => selectNow.current(p),
            onLabels: (all) => {
              labels.set(all);
              const said = all.filter((l) => SPOKEN.has(l.kind));
              const key = said.map((l) => `${l.id}\n${l.text}\n${l.gloss}`).join("\n");
              if (key === spokenKey.current) return;
              spokenKey.current = key;
              setSpoken(said);
            },
            onProgress: (d, t) => {
              // The same percent again changes nothing on screen.
              const pct = t > 0 ? Math.round((d / t) * 100) : null;
              if (pct !== progress.get()) progress.set(pct);
            },
            onReach: setReach,
            onDoorOpen: () => openDoor.current(),
            onStall: () => reportStalledWalk(data.l.plants.length),
            onTooSlow: reportSlowWalk,
            onHand: setHolding,
            onCompany: setCompany,
            onVisitorStatus: setHeard,
            onShake: (p, forms) => shakeNow.current(p, forms),
            onWalkInto: (e) => walkIntoNow.current(e),
            onCarry: (d) => carryNow.current(d),
            onToy: (d) => toysNow.current.done(d),
            onStars: setStars,
            onNote: (id) => noteNow.current(id),
          },
          reduced,
          lang,
          data.visitors,
        );
        await s.build();
      } catch (e) {
        // No test context first: a second WebGL context costs ~30 ms at CPU 10× (#459). The renderer makes the only one, so
        // a canvas with no context afterwards means the browser has no WebGL; asking again only costs in that failure.
        if (!cv.getContext("webgl2")) return setFailed({ text: "Your browser cannot show 3D graphics." });
        return setFailed({ text: e instanceof Error ? e.message : String(e) });
      }
      // Left while the scene was built: the cleanup below disposed of it.
      if (!alive) return;
      scene.current = s;
      // Dev builds only: the scene, for screenshot scripts.
      if (import.meta.env.DEV) (window as unknown as { __garden: unknown }).__garden = s;
      // The current choices, not the ones from when loading began: the scene
      // module loads asynchronously, and the viewer may have changed them since.
      s.setTime(timeNow.current);
      // The size before the detail: setDetail resizes too, and each new size is a new drawing buffer.
      const r = el.getBoundingClientRect();
      s.resize(r.width, r.height);
      const pinned = pinnedDetail();
      if (pinned) s.setDetail(pinned);
      ro.observe(el);
      s.start();
      setReady(true);
      // Opened from "View in garden": walk to that plant and show its card.
      const target = focus?.at === "plant" ? data.l.plants.find((p) => p.id === focus.id) : undefined;
      if (target) {
        s.select(target, true);
        onFocused();
      }
      await s.loadPlants();
      if (!alive) return;
      progress.set(null);
      if (!pinned) s.autoDetail();
    })();
    return () => {
      alive = false;
      ro.disconnect();
      s?.dispose();
      // The handle goes with its scene, so a script waiting for the next walk's scene does not read this one.
      const w = window as unknown as { __garden?: unknown };
      if (import.meta.env.DEV && w.__garden === s) delete w.__garden;
      scene.current = null;
      setReady(false);
    };
    // The scene is built once per snapshot; time changes go through setTime below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    timeNow.current = time;
    scene.current?.setTime(time);
  }, [time]);

  return { data, scene, ready, failed, progress, labels, spoken, reach, holding, company, stars, heard };
}

/**
 * Walking and looking: W A S D or arrows walk (left and right arrows turn),
 * Shift runs, Escape closes the card or leaves; a trackpad's two-finger swipe
 * looks around and pinch walks; dragging looks; the thumb stick walks.
 * `onMove`: the viewer moved or looked (the hint can go). The pointer handlers
 * go on the canvas; `endDrag` says whether a pointer-up was a click or tap
 * rather than the end of a drag or a long press. `onHold`: a press held still
 * for a moment (#357), at that point (client pixels).
 */
export function useWalkInput({
  // A name that ends in "Ref" tells React Compiler this is a ref, which handlers may change.
  scene: sceneRef,
  wrap,
  open,
  onClose,
  onExit,
  onMove,
  onHold,
}: {
  scene: RefObject<GardenScene | null>;
  wrap: RefObject<HTMLDivElement | null>;
  /** Whether a card (a plant's, or a note) is open: Escape closes it with `onClose` before it would leave. */
  open: boolean;
  onClose: () => void;
  onExit: () => void;
  onMove: () => void;
  onHold: (clientX: number, clientY: number) => void;
}) {
  const moved = useRef(onMove);
  const held = useRef(onHold);
  const openRef = useRef(open);
  const closeRef = useRef(onClose);
  // Before the browser paints, so no key or pointer sees the ones from before.
  useLayoutEffect(() => {
    moved.current = onMove;
    held.current = onHold;
    openRef.current = open;
    closeRef.current = onClose;
  });

  // Trackpad: two-finger swipe looks around, pinch walks forward and back.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Nothing in the walk scrolls, so every wheel is ours. This also stops the
      // trackpad's swipe-back gesture, over the panels too: Safari ignores
      // overscroll-behavior for it (WebKit bug 240183).
      e.preventDefault();
      if ((e.target as HTMLElement).closest(".gw-card, .gw-top, .gw-bottom")) return;
      const s = sceneRef.current;
      if (!s) return;
      const k = e.deltaMode === 1 ? 16 : 1; // lines to pixels
      if (e.ctrlKey) s.step(-e.deltaY * k * 0.02);
      else s.look(-e.deltaX * k, -e.deltaY * k);
      moved.current();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // The wrapper and the scene ref live as long as the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard: W A S D or arrows walk (left and right arrows turn), Shift runs.
  useEffect(() => {
    const keys = new Set<string>();
    let turning = 0;
    const update = () => {
      const s = sceneRef.current;
      if (!s) return;
      const k = (c: string) => keys.has(c);
      s.input.move.y = (k("KeyW") || k("ArrowUp") ? 1 : 0) - (k("KeyS") || k("ArrowDown") ? 1 : 0);
      s.input.move.x = (k("KeyD") ? 1 : 0) - (k("KeyA") ? 1 : 0);
      s.input.run = k("ShiftLeft") || k("ShiftRight");
      const turn = (k("ArrowLeft") || k("KeyQ") ? 1 : 0) - (k("ArrowRight") || k("KeyE") ? 1 : 0);
      cancelAnimationFrame(turning);
      if (turn) {
        const step = () => {
          sceneRef.current?.turn(turn * 0.035);
          turning = requestAnimationFrame(step);
        };
        step();
      }
    };
    const WALK_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"];
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Escape") {
        if (openRef.current) closeRef.current();
        else onExit();
        return;
      }
      if (!WALK_KEYS.includes(e.code)) return;
      e.preventDefault();
      // Walking brushes plants that play their notes (#359): audio may start only inside a key press or tap.
      wakeAudio();
      keys.add(e.code);
      moved.current();
      update();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.code);
      update();
    };
    // A right-click menu takes the keys without blurring the window, so their
    // key ups never come: let go of everything, or the walker turns forever.
    const release = () => {
      keys.clear();
      update();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    window.addEventListener("contextmenu", release);
    return () => {
      cancelAnimationFrame(turning);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      window.removeEventListener("contextmenu", release);
    };
    // The refs live as long as the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExit]);

  // Drag to look; a click or tap without dragging picks something; a press held still is a long press.
  const drag = useRef<{ x: number; y: number; moved: number; id: number; hold: number; held: boolean } | null>(null);
  useEffect(() => () => clearTimeout(drag.current?.hold), []);
  const onPointerDown = (e: PointerEvent) => {
    // Only the main button picks or looks. A right-click opens the browser's menu; it must not also walk you to that spot.
    if (e.button !== 0) return;
    clearTimeout(drag.current?.hold);
    const d = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId, hold: 0, held: false };
    d.hold = window.setTimeout(() => {
      d.held = true;
      held.current(d.x, d.y);
    }, HOLD_MS);
    drag.current = d;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.moved > 4) {
      clearTimeout(d.hold);
      sceneRef.current?.look(dx, dy);
      moved.current();
    }
  };
  const onPointerCancel = () => {
    clearTimeout(drag.current?.hold);
    drag.current = null;
  };
  const endDrag = (): boolean => {
    const d = drag.current;
    drag.current = null;
    clearTimeout(d?.hold);
    return !!d && d.moved <= 6 && !d.held;
  };

  /** The touch-screen thumb stick: walk at this speed, -1..1 sideways and forward. */
  const stick = (x: number, y: number) => {
    const s = sceneRef.current;
    if (!s) return;
    s.input.move.x = x;
    s.input.move.y = y;
    moved.current();
  };

  return { onPointerDown, onPointerMove, onPointerCancel, endDrag, stick };
}
