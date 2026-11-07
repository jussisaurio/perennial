// Carry and put down in the walk (#358; garden/carry.ts says what happens):
// the pebbles by the pond, the stick by the shed, the rings a splash makes,
// and the orchard's well (#335 S6) once the door is open. It says what the
// action button can do with them where you stand, does it, and tells the scene
// where a thing went down, for whoever answers. A Part: the one place loose
// things move (a stick drifting to the pond's edge), all in one instanced
// sprite mesh.

import * as THREE from "three";
import { PEBBLES, pebbleHome, placeAt, reaction, restAt, stickHome, type Down, type Loose, type Place, type Reaction } from "./carry";
import { rayBox, type Ray } from "./scenery";
import type { Frame, Part } from "./scenePart";
import { sprites } from "./sceneSprites";
import * as T from "./textures";
import type { Layout } from "./world";

/** What you hold: one loose thing at a time. */
export type Held = Loose;

/** What the action button does with loose things: pick one up, put what you hold down in front of you, or drop a pebble in the well. */
export type CarryAct = `lift-${Loose}` | "put" | "well";

/** What a tap or the action button acts on: a loose thing, the well, a point on the water, or the ground in reach to put a thing down on. */
export type CarryTarget = { at: "thing"; i: number } | { at: "well" } | { at: "water"; x: number; z: number } | { at: "ground"; x: number; z: number };

/** What a carry did, for the page to count (#335); and once a thing is down, what a screen reader hears. */
export type CarryDone = { did: "lift" | "put" | "well" } | { did: "land"; said: string };

/** A thing went down: which one, where, the place and its row, and what a screen reader hears (the scene adds who answers). */
export interface Landing extends Down {
  i: number;
  thing: Loose;
  place: Place;
  reaction: Reaction;
  said: string;
}

/** What the scene gives: whether the door is open (the orchard is ground too), and where to send a landing. */
export interface CarryWorld {
  doorOpen: () => boolean;
  land: (l: Landing) => void;
}

/** Near enough (m) to a loose thing to pick it up, or to a point on the water or ground to put a thing there. */
const REACH = 1.1;
/** Near enough (m) to the well's middle to drop a pebble in: a step from its stones. */
const WELL_REACH = 1.8;
/** A walk to the well heads for this far (m) in front of its stones, on the door's side. */
const WELL_FRONT = 0.5;
/** A walk to a loose thing, or to where a thing goes, stops this short of it. */
export const CARRY_STAND = 0.6;
/** Metres per atlas cell, and each thing's size in cells. */
const SIZE = 0.5;
const SCALE: Record<Loose, number> = { pebble: 1.1, stick: 2 };
/** What the action button says it picks up, per thing: made once, so reachAt allocates nothing. */
const LIFT: { [K in Loose]: `lift-${K}` } = { pebble: "lift-pebble", stick: "lift-stick" };
/** The well's cell is 1.4 m: its stones as wide as its ring (orchard.ts WELL_R), its roof a little over the eye. */
const WELL_SCALE = 2.8;
/** The rings spread for this long (s), from this size to this much bigger (m). */
const RIPPLE = { s: 1.1, size: 1.2, grow: 0.8 };
/** A floating stick drifts to this far inside the pond's edge, at this speed (m/s). */
const FLOAT = { edge: 0.2, speed: 0.25, y: 0.03 };

/** Where a thing is. */
type State = "rest" | "held" | "floating";

interface Thing {
  kind: Loose;
  x: number;
  y: number;
  z: number;
  at: State;
  home: { x: number; z: number };
}

const near = (x: number, z: number, p: { x: number; z: number }, r: number) => Math.hypot(x - p.x, z - p.z) < r;
/** A thing's drawn size: none while you hold it. */
const shown = (t: Thing) => (t.at === "held" ? 0 : SCALE[t.kind]);

export class Carry implements Part {
  /** Their own materials: tinted with the time of day, never swaying in the wind (GardenScene.tint). */
  readonly mats = new Set<THREE.ShaderMaterial>();
  /** Everything this builds hangs under one group, which the scene adds once. */
  readonly root = new THREE.Group();
  /** What you hold, by its index in `things`. */
  held: number | null = null;
  private things: Thing[];
  /** The well stands once the door is open (showWell); its instance follows the things. */
  private well = { shown: false, i: 0 };
  private layout: Layout;
  private world: CarryWorld;
  private reducedMotion: boolean;
  private pos!: THREE.InstancedBufferAttribute;
  private params!: THREE.InstancedBufferAttribute;
  private ring!: { pos: THREE.InstancedBufferAttribute; uv: THREE.InstancedBufferAttribute; params: THREE.InstancedBufferAttribute; t: number };
  /** Every target reachAt can point at, and what it returns, made once: it allocates nothing. */
  private targets: { things: CarryTarget[]; well: CarryTarget };
  private reach: { a: CarryAct; target: CarryTarget | null } = { a: "put", target: null };

  constructor(layout: Layout, reducedMotion: boolean, world: CarryWorld) {
    this.layout = layout;
    this.world = world;
    this.reducedMotion = reducedMotion;
    const pebbles = Array.from({ length: PEBBLES }, (_, i): Thing => ({ kind: "pebble", ...pebbleHome(layout, i), y: 0.01, at: "rest", home: pebbleHome(layout, i) }));
    const stick: Thing = { kind: "stick", ...stickHome(layout), y: 0.01, at: "rest", home: stickHome(layout) };
    this.things = [...pebbles, stick];
    this.targets = { things: this.things.map((_, i) => ({ at: "thing", i })), well: { at: "well" } };
  }

  /** The loose thing you hold, if any. */
  get thing(): Loose | null {
    return this.held === null ? null : this.things[this.held].kind;
  }

  /** The loose things and the well (unseen until showWell), in one instanced mesh; the rings, lying on the water. Draws no random numbers. */
  build() {
    const tex = T.pixelTexture(T.carryAtlas());
    const cell = (c: number) => c / T.CARRY_CELLS;
    const items = this.things.map((t) => ({ x: t.x, y: t.y, z: t.z, u: cell(T.CARRY_CELL[t.kind]), v: 0, uw: 1 / T.CARRY_CELLS, vh: 1, phase: 0, droop: 0, scale: shown(t), index: -8 }));
    const w = this.layout.well;
    this.well.i = items.length;
    items.push({ x: w.x, y: 0, z: w.z, u: cell(T.CARRY_CELL.well), v: 0, uw: 1 / T.CARRY_CELLS, vh: 1, phase: 0, droop: 0, scale: 0, index: -8 });
    const mesh = sprites(tex, items, SIZE, SIZE);
    const rings = sprites(tex, [{ x: 0, y: 0.05, z: 0, u: cell(T.CARRY_CELL.ring(0)), v: 0, uw: 1 / T.CARRY_CELLS, vh: 1, phase: 0, droop: 0, scale: 0, index: -8 }], RIPPLE.size, RIPPLE.size, true);
    for (const m of [mesh, rings]) {
      m.material.uniforms.uSway.value = 0;
      this.mats.add(m.material);
      this.root.add(m);
    }
    this.pos = mesh.geometry.getAttribute("iPos") as THREE.InstancedBufferAttribute;
    this.params = mesh.geometry.getAttribute("iParams") as THREE.InstancedBufferAttribute;
    const g = rings.geometry;
    this.ring = { pos: g.getAttribute("iPos") as THREE.InstancedBufferAttribute, uv: g.getAttribute("iUv") as THREE.InstancedBufferAttribute, params: g.getAttribute("iParams") as THREE.InstancedBufferAttribute, t: Infinity };
  }

  /** The door is open: the well stands in the orchard. */
  showWell() {
    this.well.shown = true;
    this.params.setZ(this.well.i, WELL_SCALE);
    this.params.needsUpdate = true;
  }

  /** Draw a thing where it is now; hidden while you hold it. */
  private draw(i: number) {
    const t = this.things[i];
    this.pos.setXYZ(i, t.x, t.y, t.z);
    this.params.setZ(i, shown(t));
    this.pos.needsUpdate = this.params.needsUpdate = true;
  }

  /**
   * What the action button can do with loose things from (x, z): holding a
   * pebble by the well, drop it in; holding anything else, put it down in
   * front of you; empty-handed, pick up the nearest thing in reach.
   */
  reachAt(x: number, z: number): { a: CarryAct; target: CarryTarget | null } | null {
    const r = this.reach;
    if (this.held !== null) {
      const pebble = this.things[this.held].kind === "pebble";
      if (pebble && this.well.shown && near(x, z, this.layout.well, WELL_REACH)) [r.a, r.target] = ["well", this.targets.well];
      else [r.a, r.target] = ["put", null];
      return r;
    }
    let best = -1;
    let bestD = REACH;
    for (let i = 0; i < this.things.length; i++) {
      const t = this.things[i];
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < bestD && t.at !== "held") [best, bestD] = [i, d];
    }
    if (best < 0) return null;
    r.a = LIFT[this.things[best].kind];
    r.target = this.targets.things[best];
    return r;
  }

  /** Where the glint shows for a target in reach. */
  cueAt(t: CarryTarget): [number, number, number] {
    if (t.at === "thing") {
      const th = this.things[t.i];
      return [th.x, th.y + 0.12 * SCALE[th.kind], th.z];
    }
    // Over the dark of the well's mouth.
    if (t.at === "well") return [this.layout.well.x, 0.75, this.layout.well.z];
    return [t.x, 0.1, t.z];
  }

  /** Where to walk to act on a target from afar, and whether you are near enough already. */
  standFor(t: CarryTarget, x: number, z: number): { x: number; z: number; near: boolean } {
    const w = this.layout.well;
    // In front of its stones: a walker may not stand on the well's middle.
    if (t.at === "well") return { x: w.x, z: w.z - w.r - WELL_FRONT, near: near(x, z, w, WELL_REACH) };
    const at = t.at === "thing" ? this.things[t.i] : t;
    return { x: at.x, z: at.z, near: near(x, z, at, REACH) };
  }

  /** The loose thing a ray meets, and how far along it: only what lies free. */
  pick(r: Ray): { target: CarryTarget; t: number } | null {
    let best: { target: CarryTarget; t: number } | null = null;
    this.things.forEach((th, i) => {
      if (th.at === "held") return;
      // Generous: a pebble is a few pixels wide, and a finger is not.
      const half = 0.12 * SCALE[th.kind];
      const t = rayBox(r, [th.x - half, th.y, th.z - half], [th.x + half, th.y + 0.18, th.z + half]);
      if (t < (best?.t ?? Infinity)) best = { target: this.targets.things[i], t };
    });
    return best;
  }

  /** How far along the ray the well is, while you hold a pebble and the door is open; Infinity otherwise. */
  pickWell(r: Ray): number {
    if (this.thing !== "pebble" || !this.well.shown) return Infinity;
    const w = this.layout.well;
    return rayBox(r, [w.x - w.r, 0, w.z - w.r], [w.x + w.r, 1.2, w.z + w.r]);
  }

  /** Pick a thing up. */
  lift(i: number): boolean {
    if (this.held !== null || this.things[i].at === "held") return false;
    this.things[i].at = "held";
    this.held = i;
    this.draw(i);
    return true;
  }

  /** Put what you hold down at (x, z). What happens there is its row (carry.ts ROWS). */
  putDown(x: number, z: number): boolean {
    const i = this.held;
    if (i === null) return false;
    const th = this.things[i];
    const place = placeAt(this.layout, x, z);
    const rx = reaction(th.kind, place);
    this.held = null;
    if (rx.ripple) this.ripple(x, z);
    if (rx.then === "sink") {
      // Another waits by the pond: pebbles never run out.
      [th.x, th.y, th.z, th.at] = [th.home.x, 0.01, th.home.z, "rest"];
    } else {
      const rest = restAt(this.layout, x, z, place, this.world.doorOpen());
      [th.x, th.y, th.z, th.at] = [rest.x, rx.then === "float" ? FLOAT.y : 0.01, rest.z, rx.then === "float" ? "floating" : "rest"];
    }
    this.draw(i);
    this.world.land({ i, thing: th.kind, place, x, z, reaction: rx, said: rx.said });
    return true;
  }

  private ripple(x: number, z: number) {
    this.ring.t = 0;
    this.ring.pos.setXYZ(0, x, 0.05, z);
    this.ring.pos.needsUpdate = true;
  }

  /** The rings, and a floating stick's drift. Allocates nothing. */
  tick(f: Frame) {
    const ring = this.ring;
    if (ring.t < RIPPLE.s) {
      ring.t += f.dt;
      const k = Math.min(1, ring.t / RIPPLE.s);
      // Gone once spread; with reduced motion one still ring shows for as long.
      const cell = T.CARRY_CELL.ring(this.reducedMotion ? 1 : Math.min(T.RINGS - 1, Math.floor(k * T.RINGS)));
      ring.uv.setX(0, cell / T.CARRY_CELLS);
      ring.params.setZ(0, k >= 1 ? 0 : this.reducedMotion ? 1 : 0.5 + k * RIPPLE.grow);
      ring.uv.needsUpdate = ring.params.needsUpdate = true;
    }
    const p = this.layout.pond;
    for (let i = 0; i < this.things.length; i++) {
      const th = this.things[i];
      if (th.at !== "floating") continue;
      const d = Math.hypot(th.x - p.x, th.z - p.z);
      const to = p.r - FLOAT.edge;
      if (d >= to) continue;
      // Out to the edge, where a hand reaches it from the bank.
      const step = this.reducedMotion ? to - d : Math.min(to - d, FLOAT.speed * f.dt);
      // From the middle exactly, any way out will do.
      if (d < 1e-3) th.x += step;
      else {
        th.x += ((th.x - p.x) / d) * step;
        th.z += ((th.z - p.z) / d) * step;
      }
      this.draw(i);
    }
  }
}
