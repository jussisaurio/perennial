// The walk-in garden's hooks: building the three.js scene from a snapshot of
// the garden (useGardenScene), and walking and looking around in it with keys,
// trackpad and drags (useWalkInput). GardenWalk.tsx draws everything around it.

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { language } from "../content/languages";
import { reportStalledWalk } from "../observability";
import { reservedStake } from "../content/voice";
import type { PlantSource } from "../garden/plants";
import type { Detail, DoorAction, DoorState, GardenScene, Label, TimeOfDay, WalkVisitors } from "../garden/scene";
import { sceneryViews } from "../garden/scenery";
import { keepsakeLabel, sleeperId } from "../garden/whimsy";
import { layout, type Layout, type PlacedPlant } from "../garden/world";
import type { LearnerVisitors } from "./visitors";

interface WalkData {
  l: Layout;
  seeds: number;
  visitors: WalkVisitors;
}

/**
 * The scene for this garden. A snapshot is taken when the garden opens (it does
 * not change while you walk) and the scene is built once from it; time of day
 * and quality changes go to the running scene. `onFocused`: the scene walked to
 * `focus` and opened its card. `door`: the door in the hedge (#315), and how to
 * save it once it is opened.
 */
export function useGardenScene({
  lang,
  source,
  visitors,
  door,
  focus,
  time,
  detail,
  wrap,
  canvas,
  onFocused,
}: {
  lang: string;
  source: PlantSource | null;
  visitors?: LearnerVisitors | null;
  door: { state: DoorState; open: () => void };
  focus?: string | null;
  time: TimeOfDay;
  detail: Detail;
  wrap: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  onFocused: () => void;
}) {
  const [data, setData] = useState<WalkData | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  // `retry`: loading again can help (its code did not load), so the page offers it; an installed app has no reload button.
  const [failed, setFailed] = useState<{ text: string; retry?: true } | null>(null);
  const [selected, setSelected] = useState<PlacedPlant | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [ready, setReady] = useState(false);
  const [doorNear, setDoorNear] = useState<DoorAction | null>(null);
  const scene = useRef<GardenScene | null>(null);
  // The scene is built once; it saves the door through whatever the page passes now.
  const openDoor = useRef(door.open);
  openDoor.current = door.open;

  // A snapshot of the garden when it opens: it does not change while you walk.
  useEffect(() => {
    if (!source || data) return;
    const l = layout(source.plants);
    const first = source.first && l.plants.some((p) => p.id === source.first!.id) ? { id: source.first.id, text: keepsakeLabel(source.first.lemma, source.first.at) } : null;
    setData({
      l,
      seeds: source.seeds,
      visitors: {
        list: visitors?.views ?? [],
        keepsake: first,
        reserved: l.plants.length ? null : reservedStake(language(lang).name, lang).line,
        sleeper: sleeperId(l.plants.filter((p) => p.stage === "bloom").map((p) => p.id)),
        scenery: visitors?.scenery ?? sceneryViews(lang),
        door: door.state,
        orchard: { trees: source.orchard, firstPlanted: source.first ? source.first.at : null },
      },
    });
  }, [source, data, visitors, door.state, lang]);

  useEffect(() => {
    if (!data || !canvas.current || !wrap.current) return;
    let alive = true;
    let s: GardenScene | null = null;
    const el = wrap.current;
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
      if (!mod.webglAvailable()) return setFailed({ text: "Your browser cannot show 3D graphics." });
      try {
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        s = new mod.GardenScene(
          canvas.current!,
          data.l,
          { onSelect: setSelected, onLabels: setLabels, onProgress: (d, t) => setProgress([d, t]), onDoor: setDoorNear, onDoorOpen: () => openDoor.current(), onStall: () => reportStalledWalk(data.l.plants.length) },
          reduced,
          lang,
          data.visitors,
        );
      } catch (e) {
        return setFailed({ text: e instanceof Error ? e.message : String(e) });
      }
      scene.current = s;
      // Dev builds only: the scene, for screenshot scripts.
      if (import.meta.env.DEV) (window as unknown as { __garden: unknown }).__garden = s;
      // The current choices, not the ones from when loading began: the scene
      // module loads asynchronously, and the viewer may have changed them since.
      s.setTime(timeNow.current);
      s.setDetail(detailNow.current);
      const r = el.getBoundingClientRect();
      s.resize(r.width, r.height);
      ro.observe(el);
      s.start();
      setReady(true);
      // Opened from "View in garden": walk to that plant and show its card.
      const target = focus ? data.l.plants.find((p) => p.id === focus) : undefined;
      if (target) {
        s.select(target, true);
        onFocused();
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

  const timeNow = useRef(time);
  const detailNow = useRef(detail);
  useEffect(() => {
    timeNow.current = time;
    scene.current?.setTime(time);
  }, [time]);
  useEffect(() => {
    detailNow.current = detail;
    scene.current?.setDetail(detail);
  }, [detail]);

  return { data, scene, ready, failed, progress, labels, selected, doorNear };
}

/**
 * Walking and looking: W A S D or arrows walk (left and right arrows turn),
 * Shift runs, Escape closes the card or leaves; a trackpad's two-finger swipe
 * looks around and pinch walks; dragging looks; the thumb stick walks.
 * `onMove`: the viewer moved or looked (the hint can go). The pointer handlers
 * go on the canvas; `endDrag` says whether a pointer-up was a click or tap
 * rather than the end of a drag.
 */
export function useWalkInput({
  scene,
  wrap,
  selected,
  onExit,
  onMove,
}: {
  scene: RefObject<GardenScene | null>;
  wrap: RefObject<HTMLDivElement | null>;
  selected: PlacedPlant | null;
  onExit: () => void;
  onMove: () => void;
}) {
  const moved = useRef(onMove);
  moved.current = onMove;
  const selectedRef = useRef<PlacedPlant | null>(null);
  selectedRef.current = selected;

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
      const s = scene.current;
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
      moved.current();
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
    // The refs live as long as the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExit]);

  // Drag to look; a click or tap without dragging picks something.
  const drag = useRef<{ x: number; y: number; moved: number; id: number } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
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
      scene.current?.look(dx, dy);
      moved.current();
    }
  };
  const onPointerCancel = () => (drag.current = null);
  const endDrag = (): boolean => {
    const d = drag.current;
    drag.current = null;
    return !!d && d.moved <= 6;
  };

  /** The touch-screen thumb stick: walk at this speed, -1..1 sideways and forward. */
  const stick = (x: number, y: number) => {
    const s = scene.current;
    if (!s) return;
    s.input.move.x = x;
    s.input.move.y = y;
    moved.current();
  };

  return { onPointerDown, onPointerMove, onPointerCancel, endDrag, stick };
}
