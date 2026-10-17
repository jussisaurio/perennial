// Carry, put down, throw in the walk (#358; garden/carry.ts says what happens):
// the pebbles by the pond, the stick by the shed, the cairn's flat stone, and
// the rings a splash makes. It says what the action button can do with them
// where you stand, does it, flies a thrown thing in a small arc, and tells the
// scene where it landed, for whoever answers. A Part: the one place loose
// things move (a flight, the cairn's wobble, a stick drifting to the pond's
// edge), all in one instanced sprite mesh.

import * as THREE from "three";
import { cairnAt, cairnHolds, CAIRN_FALLS, PEBBLES, pebbleHome, placeAt, reaction, restAt, stickHome, type Loose, type Place, type Reaction } from "./carry";
import { rayBox, type Ray } from "./scenery";
import type { Frame, Part } from "./scenePart";
import type { Hand } from "./sceneLeave";
import { sprites } from "./sceneSprites";
import * as T from "./textures";
import type { Layout } from "./world";

/** What you hold: leave it out's thing (#351), or a loose thing. One thing at a time. */
export type Held = Hand | { from: "ground"; thing: Loose };

/** What the action button does with loose things: pick one up, throw what you hold where you face, or put a pebble on the cairn. */
export type CarryAct = `lift-${Loose}` | "throw" | "stack";

/** What a tap or the action button acts on: a loose thing, the cairn, a point on the water to throw at, or the ground in reach to put a thing down on. */
export type CarryTarget = { at: "thing"; i: number } | { at: "cairn" } | { at: "water"; x: number; z: number } | { at: "ground"; x: number; z: number };

/** What a carry did, for the page to count (#335); and, once a thing lands, what a screen reader hears. */
export type CarryDone = { did: "lift" | "throw" | "put" | "stack" } | { did: "land"; said: string };

/** A thing came down: where it was aimed, the place and its row, and what a screen reader hears (the scene adds who answers). */
export interface Landing {
  thing: Loose;
  place: Place;
  x: number;
  z: number;
  reaction: Reaction;
  said: string;
}

/** What the scene gives: where the dog is today, whether the door is open (the orchard is ground too), and where to send a landing. */
export interface CarryWorld {
  dog: () => { x: number; z: number } | null;
  doorOpen: () => boolean;
  land: (l: Landing) => void;
}

/** Near enough (m) to a loose thing or the cairn to use it. */
const REACH = 1.1;
/** A walk to a loose thing or the cairn stops this short of it. */
export const CARRY_STAND = 0.6;
/** Metres per atlas cell, and each thing's size in cells. */
const SIZE = 0.5;
const SCALE: Record<Loose, number> = { pebble: 1.1, stick: 2 };
const STONE_SCALE = 1.6;
/** The first pebble on the cairn sits on its flat stone (5 px of a 0.8 m cell high), and each one after a pebble higher. */
const STACK = { base: 0.12, step: 0.08 };
/** A throw: it starts this far in front of you at this height, peaks this much above the line (plus some per metre), and flies this long (plus some per metre). */
const FLIGHT = { ahead: 0.3, from: 0.8, peak: 0.15, peakPerM: 0.05, s: 0.3, sPerM: 0.06 };
/** The rings spread for this long (s), from this size to this much bigger (m). */
const RIPPLE = { s: 1.1, size: 1.2, grow: 0.8 };
/** The cairn wobbles for this long (s) after a pebble goes on. */
const WOBBLE_S = 0.6;
/** A floating stick drifts to this far inside the pond's edge, at this speed (m/s). */
const FLOAT = { edge: 0.2, speed: 0.25, y: 0.03 };

type State = "rest" | "held" | "flying" | "stacked" | "floating";

interface Thing {
  kind: Loose;
  x: number;
  y: number;
  z: number;
  at: State;
  home: { x: number; z: number };
}

const near = (x: number, z: number, p: { x: number; z: number }, r: number) => Math.hypot(x - p.x, z - p.z) < r;

export class Carry implements Part {
  /** Their own materials: tinted with the time of day, never swaying in the wind (GardenScene.tint). */
  readonly mats = new Set<THREE.ShaderMaterial>();
  /** Everything this builds hangs under one group, which the scene adds once. */
  readonly root = new THREE.Group();
  /** What you hold, by its index in `things`. */
  held: number | null = null;
  private things: Thing[];
  /** The cairn's pebbles, bottom first. */
  private stack: number[] = [];
  /** How many pebbles the cairn holds today before the next makes it fall. */
  private holds: number;
  private cairn: { x: number; z: number };
  private layout: Layout;
  private world: CarryWorld;
  private reducedMotion: boolean;
  private pos!: THREE.InstancedBufferAttribute;
  private params!: THREE.InstancedBufferAttribute;
  private ring!: { pos: THREE.InstancedBufferAttribute; uv: THREE.InstancedBufferAttribute; params: THREE.InstancedBufferAttribute; t: number };
  private flight: { i: number; from: [number, number, number]; to: [number, number, number]; peak: number; t: number; s: number; landing: Landing } | null = null;
  /** When the cairn last got a pebble (elapsed s), for its wobble. */
  private wobble = -Infinity;
  private elapsed = 0;
  /** Every target reachAt can point at, and what it returns, made once: it allocates nothing. */
  private targets: { things: CarryTarget[]; cairn: CarryTarget };
  private reach: { a: CarryAct; target: CarryTarget | null } = { a: "throw", target: null };

  constructor(layout: Layout, day: number, reducedMotion: boolean, world: CarryWorld) {
    this.layout = layout;
    this.world = world;
    this.reducedMotion = reducedMotion;
    this.holds = cairnHolds(day);
    this.cairn = cairnAt(layout);
    const pebbles = Array.from({ length: PEBBLES }, (_, i): Thing => ({ kind: "pebble", ...pebbleHome(layout, i), y: 0.01, at: "rest", home: pebbleHome(layout, i) }));
    const stick: Thing = { kind: "stick", ...stickHome(layout), y: 0.01, at: "rest", home: stickHome(layout) };
    this.things = [...pebbles, stick];
    this.targets = { things: this.things.map((_, i) => ({ at: "thing", i })), cairn: { at: "cairn" } };
  }

  /** The loose thing you hold, if any. */
  get thing(): Loose | null {
    return this.held === null ? null : this.things[this.held].kind;
  }

  /** The loose things and the cairn's flat stone, in one instanced mesh; the rings, lying on the water. Draws no random numbers. */
  build() {
    const tex = T.pixelTexture(T.carryAtlas());
    const cell = (c: number) => c / T.CARRY_CELLS;
    const items = this.things.map((t) => ({ x: t.x, y: t.y, z: t.z, u: cell(T.CARRY_CELL[t.kind]), v: 0, uw: 1 / T.CARRY_CELLS, vh: 1, phase: 0, droop: 0, scale: SCALE[t.kind], index: -8 }));
    items.push({ x: this.cairn.x, y: 0.005, z: this.cairn.z, u: cell(T.CARRY_CELL.flatStone), v: 0, uw: 1 / T.CARRY_CELLS, vh: 1, phase: 0, droop: 0, scale: STONE_SCALE, index: -8 });
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

  /** Draw a thing where it is now; hidden while you hold it. */
  private draw(i: number) {
    const t = this.things[i];
    this.pos.setXYZ(i, t.x, t.y, t.z);
    this.params.setZ(i, t.at === "held" ? 0 : SCALE[t.kind]);
    this.pos.needsUpdate = this.params.needsUpdate = true;
  }

  /** Can this thing be picked up now: lying, floating, or on top of the cairn. */
  private liftable(i: number): boolean {
    const at = this.things[i].at;
    return at === "rest" || at === "floating" || (at === "stacked" && this.stack[this.stack.length - 1] === i);
  }

  /**
   * What the action button can do with loose things from (x, z): holding one,
   * put a pebble on the cairn in reach, or else throw it; empty-handed, pick up
   * the nearest thing in reach (`full`: you hold leave it out's thing, so not).
   */
  reachAt(x: number, z: number, full: boolean): { a: CarryAct; target: CarryTarget | null } | null {
    const r = this.reach;
    if (this.held !== null) {
      const onCairn = this.things[this.held].kind === "pebble" && near(x, z, this.cairn, REACH);
      [r.a, r.target] = onCairn ? ["stack", this.targets.cairn] : ["throw", null];
      return r;
    }
    if (full) return null;
    let best = -1;
    let bestD = REACH;
    for (let i = 0; i < this.things.length; i++) {
      const t = this.things[i];
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < bestD && this.liftable(i)) [best, bestD] = [i, d];
    }
    if (best < 0) return null;
    r.a = this.things[best].kind === "pebble" ? "lift-pebble" : "lift-stick";
    r.target = this.targets.things[best];
    return r;
  }

  /** Where the glint shows for a target in reach. */
  cueAt(t: CarryTarget): [number, number, number] {
    if (t.at === "thing") {
      const th = this.things[t.i];
      return [th.x, th.y + 0.12 * SCALE[th.kind], th.z];
    }
    if (t.at === "cairn") return [this.cairn.x, this.top() + 0.1, this.cairn.z];
    return [t.x, 0.1, t.z];
  }

  /** The height of the cairn's top: where the next pebble goes. */
  private top(): number {
    return STACK.base + this.stack.length * STACK.step;
  }

  /** Where to walk to act on a target from afar, and whether you are near enough already. A point on the water or ground is always near: it is acted on from where you stand. */
  standFor(t: CarryTarget, x: number, z: number): { x: number; z: number; near: boolean } {
    const at = t.at === "thing" ? this.things[t.i] : t.at === "cairn" ? this.cairn : t;
    return { x: at.x, z: at.z, near: t.at === "water" || t.at === "ground" || near(x, z, at, REACH) };
  }

  /** The loose thing a ray meets, and how far along it: only what can be picked up now. */
  pick(r: Ray): { target: CarryTarget; t: number } | null {
    let best: { target: CarryTarget; t: number } | null = null;
    this.things.forEach((th, i) => {
      if (!this.liftable(i)) return;
      // Generous: a pebble is a few pixels wide, and a finger is not.
      const half = 0.12 * SCALE[th.kind];
      const t = rayBox(r, [th.x - half, th.y, th.z - half], [th.x + half, th.y + 0.18, th.z + half]);
      if (t < (best?.t ?? Infinity)) best = { target: this.targets.things[i], t };
    });
    return best;
  }

  /** How far along the ray the cairn is, while you hold a pebble to put on it; Infinity otherwise. */
  pickCairn(r: Ray): number {
    if (this.thing !== "pebble") return Infinity;
    const c = this.cairn;
    return rayBox(r, [c.x - 0.25, 0, c.z - 0.25], [c.x + 0.25, this.top() + 0.1, c.z + 0.25]);
  }

  /** Pick a thing up. */
  lift(i: number): boolean {
    if (this.held !== null || !this.liftable(i)) return false;
    if (this.things[i].at === "stacked") this.stack.pop();
    this.things[i].at = "held";
    this.held = i;
    this.draw(i);
    return true;
  }

  /**
   * Let go of what you hold, standing at (x, z), toward (ax, az): thrown in an
   * arc (`arc`), or put there by hand. What happens where it lands is its row
   * (carry.ts ROWS). With reduced motion a throw lands at once.
   */
  letGo(x: number, z: number, ax: number, az: number, arc: boolean): boolean {
    const i = this.held;
    if (i === null) return false;
    const th = this.things[i];
    const place = placeAt(this.layout, ax, az, this.world.dog());
    const rx = reaction(th.kind, place);
    const rest = rx.then === "stack" ? this.cairn : restAt(this.layout, ax, az, place, this.world.doorOpen());
    const y = rx.then === "stack" ? this.top() : rx.then === "float" ? FLOAT.y : 0.01;
    // Put down by hand on the ground: that is all that happened.
    const said = !arc && place === "ground" ? "You put it down." : rx.said;
    const landing: Landing = { thing: th.kind, place, x: ax, z: az, reaction: rx, said };
    this.held = null;
    th.at = "flying";
    if (!arc || this.reducedMotion) {
      [th.x, th.y, th.z] = [rest.x, y, rest.z];
      this.land(i, landing);
      return true;
    }
    // Land any earlier throw still in the air: one flight at a time.
    if (this.flight) this.endFlight();
    const d = Math.hypot(ax - x, az - z);
    const k = FLIGHT.ahead / Math.max(d, 0.01);
    this.flight = { i, from: [x + (ax - x) * k, FLIGHT.from, z + (az - z) * k], to: [rest.x, y, rest.z], peak: FLIGHT.peak + d * FLIGHT.peakPerM, t: 0, s: FLIGHT.s + d * FLIGHT.sPerM, landing };
    return true;
  }

  private endFlight() {
    const f = this.flight!;
    this.flight = null;
    const th = this.things[f.i];
    [th.x, th.y, th.z] = f.to;
    this.land(f.i, f.landing);
  }

  /** A thing came down: it sinks, floats, stacks or lies, by its row; then the scene hears where. */
  private land(i: number, l: Landing) {
    const th = this.things[i];
    const rx = l.reaction;
    if (rx.ripple) this.ripple(l.x, l.z);
    if (rx.then === "sink") {
      // Another waits by the pond: pebbles never run out.
      [th.x, th.y, th.z, th.at] = [th.home.x, 0.01, th.home.z, "rest"];
    } else if (rx.then === "float") th.at = "floating";
    else if (rx.then === "stack") {
      th.at = "stacked";
      this.stack.push(i);
      if (this.stack.length > this.holds) {
        this.topple();
        l.said = CAIRN_FALLS;
      } else this.wobble = this.elapsed;
    } else th.at = "rest";
    this.draw(i);
    this.world.land(l);
  }

  /** Too tall: the cairn falls, and its pebbles lie round its stone. */
  private topple() {
    this.stack.forEach((j, k) => {
      const a = k * 2.1 + 0.4;
      const r = 0.32 + k * 0.06;
      const th = this.things[j];
      [th.x, th.y, th.z, th.at] = [this.cairn.x + Math.cos(a) * r, 0.01, this.cairn.z + Math.sin(a) * r, "rest"];
      this.draw(j);
    });
    this.stack = [];
  }

  private ripple(x: number, z: number) {
    this.ring.t = 0;
    this.ring.pos.setXYZ(0, x, 0.05, z);
    this.ring.pos.needsUpdate = true;
  }

  /** The flight, the rings, the cairn's wobble and a floating stick's drift. Allocates nothing. */
  tick(f: Frame) {
    this.elapsed = f.elapsed;
    const fl = this.flight;
    if (fl) {
      fl.t = Math.min(1, fl.t + f.dt / fl.s);
      const th = this.things[fl.i];
      const { from: a, to: b } = fl;
      th.x = a[0] + (b[0] - a[0]) * fl.t;
      th.z = a[2] + (b[2] - a[2]) * fl.t;
      th.y = a[1] + (b[1] - a[1]) * fl.t + Math.sin(Math.PI * fl.t) * fl.peak;
      this.draw(fl.i);
      if (fl.t >= 1) this.endFlight();
    }
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
    const w = f.elapsed - this.wobble;
    if (w < WOBBLE_S + f.dt) {
      // A little side to side, higher stones more, dying away; still with reduced motion.
      const sway = w < WOBBLE_S && !this.reducedMotion ? Math.sin(w * 40) * 0.012 * (1 - w / WOBBLE_S) : 0;
      for (let k = 0; k < this.stack.length; k++) {
        const th = this.things[this.stack[k]];
        th.x = this.cairn.x + sway * (k + 1);
        th.y = STACK.base + k * STACK.step;
        th.z = this.cairn.z;
        this.draw(this.stack[k]);
      }
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
