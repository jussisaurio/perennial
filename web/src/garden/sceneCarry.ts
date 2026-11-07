// Carry, throw and put down in the walk (#358; garden/carry.ts says what
// happens): the pebbles by the pond, the rings a splash makes, and the orchard's well (#335 S6) once the door is open. It says what
// the action button can do with them where you stand, does it, flies a thrown
// thing in a small arc, and tells the scene where it landed, for whoever
// answers. A Part: the one place loose things move (a flight), all in one
// instanced sprite mesh.

import * as THREE from "three";
import { PEBBLES, pebbleHome, placeAt, reaction, restAt, type Down, type Place, type Reaction } from "./carry";
import { rayBox, type Ray } from "./scenery";
import type { Frame, Part } from "./scenePart";
import { sprites } from "./sceneSprites";
import * as T from "./textures";
import { REACH_SLACK } from "./reach";
import type { Layout } from "./world";

/** What the action button does with pebbles: pick one up, throw the one you hold where you face, or drop it in the well. */
export type CarryAct = "lift-pebble" | "throw" | "well";

/** What a tap or the action button acts on: a loose thing, the well, a point on the water to throw at, or the ground in reach to put a thing down on. */
export type CarryTarget = { at: "thing"; i: number } | { at: "well" } | { at: "water"; x: number; z: number } | { at: "ground"; x: number; z: number };

/** What a carry did, for the page to count (#335); and once a thing is down, what a screen reader hears. */
export type CarryDone = { did: "lift" | "throw" | "put" | "well" } | { did: "land"; said: string };

/** A thing came down: which one, where it was aimed, the place and its row, and what a screen reader hears (the scene adds who answers). */
export interface Landing extends Down {
  i: number;
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
/** Metres per atlas cell, and a pebble's size in cells. */
const SIZE = 0.5;
const SCALE = 1.1;
/** The well's cell is 1.4 m: its stones as wide as its ring (orchard.ts WELL_R), its roof a little over the eye. */
const WELL_SCALE = 2.8;
/** A throw: it starts this far in front of you at this height, peaks this much above the line (plus some per metre), and flies this long (plus some per metre). */
const FLIGHT = { ahead: 0.3, from: 0.8, peak: 0.15, peakPerM: 0.05, s: 0.3, sPerM: 0.06 };
/** The rings spread for this long (s), from this size to this much bigger (m). */
const RIPPLE = { s: 1.1, size: 1.2, grow: 0.8 };

/** Where a thing is. */
type State = "rest" | "held" | "flying";

interface Thing {
  x: number;
  y: number;
  z: number;
  at: State;
  home: { x: number; z: number };
}

const near = (x: number, z: number, p: { x: number; z: number }, r: number) => Math.hypot(x - p.x, z - p.z) < r;
/** Lying where a hand can pick it up: not held, not in the air. */
const free = (t: Thing) => t.at === "rest";
/** A thing's drawn size: none while you hold it. */
const shown = (t: Thing) => (t.at === "held" ? 0 : SCALE);

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
  private reach: { a: CarryAct; target: CarryTarget | null } = { a: "throw", target: null };
  private flight: { i: number; from: [number, number, number]; to: [number, number, number]; peak: number; t: number; s: number; landing: Landing } | null = null;

  constructor(layout: Layout, reducedMotion: boolean, world: CarryWorld) {
    this.layout = layout;
    this.world = world;
    this.reducedMotion = reducedMotion;
    this.things = Array.from({ length: PEBBLES }, (_, i): Thing => ({ ...pebbleHome(layout, i), y: 0.01, at: "rest", home: pebbleHome(layout, i) }));
    this.targets = { things: this.things.map((_, i) => ({ at: "thing", i })), well: { at: "well" } };
  }

  /** The loose things and the well (unseen until showWell), in one instanced mesh; the rings, lying on the water. Draws no random numbers. */
  build() {
    const tex = T.pixelTexture(T.carryAtlas());
    const cell = (c: number) => c / T.CARRY_CELLS;
    const items = this.things.map((t) => ({ x: t.x, y: t.y, z: t.z, u: cell(T.CARRY_CELL.pebble), v: 0, uw: 1 / T.CARRY_CELLS, vh: 1, phase: 0, droop: 0, scale: shown(t), index: -8 }));
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
   * What the action button can do with pebbles from (x, z): holding one by
   * the well, drop it in; holding one elsewhere, throw it where you face;
   * empty-handed, pick up the nearest one in reach. What the button shows now
   * (`held`) stays in reach REACH_SLACK farther (#838).
   */
  reachAt(x: number, z: number, held: CarryTarget | null): { a: CarryAct; target: CarryTarget | null } | null {
    const r = this.reach;
    if (this.held !== null) {
      if (this.well.shown && near(x, z, this.layout.well, WELL_REACH + (held === this.targets.well ? REACH_SLACK : 0))) [r.a, r.target] = ["well", this.targets.well];
      else [r.a, r.target] = ["throw", null];
      return r;
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.things.length; i++) {
      const t = this.things[i];
      const d = Math.hypot(x - t.x, z - t.z);
      if (d < bestD && d < REACH + (held === this.targets.things[i] ? REACH_SLACK : 0) && free(t)) [best, bestD] = [i, d];
    }
    if (best < 0) return null;
    r.a = "lift-pebble";
    r.target = this.targets.things[best];
    return r;
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
      if (!free(th)) return;
      // Generous: a pebble is a few pixels wide, and a finger is not.
      const half = 0.12 * SCALE;
      const t = rayBox(r, [th.x - half, th.y, th.z - half], [th.x + half, th.y + 0.18, th.z + half]);
      if (t < (best?.t ?? Infinity)) best = { target: this.targets.things[i], t };
    });
    return best;
  }

  /** How far along the ray the well is, while you hold a pebble and the door is open; Infinity otherwise. */
  pickWell(r: Ray): number {
    if (this.held === null || !this.well.shown) return Infinity;
    const w = this.layout.well;
    return rayBox(r, [w.x - w.r, 0, w.z - w.r], [w.x + w.r, 1.2, w.z + w.r]);
  }

  /** Pick a thing up. */
  lift(i: number): boolean {
    if (this.held !== null || !free(this.things[i])) return false;
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
    const place = placeAt(this.layout, ax, az);
    const rx = reaction(place);
    const rest = restAt(this.layout, ax, az, place, this.world.doorOpen());
    // Put down by hand on the ground: that is all that happened.
    const said = !arc && place === "ground" ? "You put it down." : rx.said;
    const landing: Landing = { i, place, x: ax, z: az, reaction: rx, said };
    this.held = null;
    th.at = "flying";
    if (!arc || this.reducedMotion) {
      [th.x, th.y, th.z] = [rest.x, 0.01, rest.z];
      this.land(i, landing);
      return true;
    }
    // Land any earlier throw still in the air: one flight at a time.
    if (this.flight) this.endFlight();
    const d = Math.hypot(ax - x, az - z);
    const k = FLIGHT.ahead / Math.max(d, 0.01);
    this.flight = { i, from: [x + (ax - x) * k, FLIGHT.from, z + (az - z) * k], to: [rest.x, 0.01, rest.z], peak: FLIGHT.peak + d * FLIGHT.peakPerM, t: 0, s: FLIGHT.s + d * FLIGHT.sPerM, landing };
    return true;
  }

  private endFlight() {
    const f = this.flight!;
    this.flight = null;
    const th = this.things[f.i];
    [th.x, th.y, th.z] = f.to;
    this.land(f.i, f.landing);
  }

  /** A thing came down: it sinks or lies, by its row; then the scene hears where. */
  private land(i: number, l: Landing) {
    const th = this.things[i];
    const rx = l.reaction;
    if (rx.ripple) this.ripple(l.x, l.z);
    // Another waits by the pond: pebbles never run out.
    if (rx.then === "sink") [th.x, th.y, th.z, th.at] = [th.home.x, 0.01, th.home.z, "rest"];
    else th.at = "rest";
    this.draw(i);
    this.world.land(l);
  }

  private ripple(x: number, z: number) {
    this.ring.t = 0;
    this.ring.pos.setXYZ(0, x, 0.05, z);
    this.ring.pos.needsUpdate = true;
  }

  /** The flight and the rings. Allocates nothing. */
  tick(f: Frame) {
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
  }
}
