// Carry, put down, throw in the walk (#358; garden/carry.ts says what happens):
// the pebbles by the pond, the stick by the shed, the cairn's flat stone, the
// rings a splash makes, and the orchard's well (#335 S6) once the door is open. It says what the action button can do with them
// where you stand, does it, flies a thrown thing in a small arc, and tells the
// scene where it landed, for whoever answers. A Part: the one place loose
// things move (a flight, the cairn's wobble, a stick drifting to the pond's
// edge, a thing in the dog's mouth as it fetches, #335 S2), all in one
// instanced sprite mesh.

import * as THREE from "three";
import { cairnAt, cairnHolds, CAIRN_FALLS, PEBBLES, pebbleHome, placeAt, reaction, restAt, stickHome, type Down, type Loose, type Place, type Reaction } from "./carry";
import { fetchSeed, pickFetch, SURPRISE, type Fetchable, type Surprise } from "./fetch";
import type { Fruit } from "./leave";
import { rayBox, type Ray } from "./scenery";
import type { Frame, Part } from "./scenePart";
import type { Hand } from "./sceneLeave";
import { sprites } from "./sceneSprites";
import * as T from "./textures";
import type { Layout } from "./world";

/** A loose thing in your hands: a fruit the dog brought (#335 S2) is a word of yours. */
export type Picked = { from: "ground"; thing: Exclude<Loose, "fruit"> } | { from: "ground"; thing: "fruit"; fruit: Fruit };

/** What you hold: leave it out's thing (#351), or a loose thing. One thing at a time. */
export type Held = Hand | Picked;

/** What the action button does with loose things: pick one up, throw what you hold where you face, put a pebble on the cairn, drop it in the well, or give the gnome its hat back (#335 S2). */
export type CarryAct = `lift-${Loose}` | "throw" | "stack" | "well" | "give";

/** What a tap or the action button acts on: a loose thing, the cairn, the well, the gnome, a point on the water to throw at, or the ground in reach to put a thing down on. */
export type CarryTarget = { at: "thing"; i: number } | { at: "cairn" } | { at: "well" } | { at: "gnome" } | { at: "water"; x: number; z: number } | { at: "ground"; x: number; z: number };

/**
 * What a carry did, for the page to count (#335); once a thing lands, what a
 * screen reader hears; and what the dog brought back (#335 S2), or the gnome's
 * hat given back, with what a screen reader hears and the course word to say
 * after it (null: none).
 */
export type CarryDone = { did: "lift" | "throw" | "put" | "stack" | "well" } | { did: "land"; said: string } | { did: "fetch" | "give"; said: string; word: string | null };

/** A thing came down: which one, where it was aimed, the place and its row, and what a screen reader hears (the scene adds who answers). */
export interface Landing extends Down {
  thing: Loose;
  place: Place;
  reaction: Reaction;
  said: string;
}

/**
 * What the scene gives: where the dog sits today, and where it is drawn now (it
 * runs to fetch); where the gnome stands, if it is here today; whether the door
 * is open (the orchard is ground too); and where to send a landing.
 */
export interface CarryWorld {
  dog: () => { x: number; z: number } | null;
  dogDrawn: () => Readonly<{ x: number; y: number; z: number }> | null;
  gnome: () => { x: number; z: number } | null;
  doorOpen: () => boolean;
  land: (l: Landing) => void;
}

/** The things the dog may bring as a surprise, each one of a kind (fetch.ts). */
const SURPRISES = Object.keys(SURPRISE) as Surprise[];

/** Near enough (m) to a loose thing or the cairn to use it. */
const REACH = 1.1;
/** Near enough (m) to the well's middle to drop a pebble in: a step from its stones. */
const WELL_REACH = 1.8;
/** A walk to the well heads for this far (m) in front of its stones, on the door's side. */
const WELL_FRONT = 0.5;
/** A walk to a loose thing or the cairn stops this short of it. */
export const CARRY_STAND = 0.6;
/** Metres per atlas cell, and each thing's size in cells. */
const SIZE = 0.5;
const SCALE: Record<Loose, number> = { pebble: 1.1, stick: 2, sock: 1.3, sign: 1.6, hat: 1.12, gnome: 1.12, fruit: 1.2 };
/** What the action button says it picks up, per thing: made once, so reachAt allocates nothing. */
const LIFT: { [K in Loose]: `lift-${K}` } = { pebble: "lift-pebble", stick: "lift-stick", sock: "lift-sock", sign: "lift-sign", hat: "lift-hat", gnome: "lift-gnome", fruit: "lift-fruit" };
/** The dog carries a thing this high (m), and this much nearer you than its middle, so it shows in front of it. */
const MOUTH = { y: 0.16, toward: 0.12 };
/** It drops what it brings this far in front of it (m), toward you: in reach of your hands, while the dog stands where you can see it (kinds/dog.ts). */
const DROP = 0.5;
const STONE_SCALE = 1.6;
/** The well's cell is 1.4 m: its stones as wide as its ring (orchard.ts WELL_R), its roof a little over the eye. */
const WELL_SCALE = 2.8;
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

/**
 * Where a thing is. Fetch (#335 S2) adds: "away" (not in the garden: what the
 * dog has not brought yet, or the hat given back), "fetched" (it lies where it
 * came down, and the dog is on its way to take it), and "carried" (in the
 * dog's mouth).
 */
type State = "rest" | "held" | "flying" | "stacked" | "floating" | "away" | "fetched" | "carried";

interface Thing {
  kind: Loose;
  x: number;
  y: number;
  z: number;
  at: State;
  home: { x: number; z: number };
}

const near = (x: number, z: number, p: { x: number; z: number }, r: number) => Math.hypot(x - p.x, z - p.z) < r;
/** A thing's drawn size: none while you hold it, or while it is away. */
const shown = (t: Thing) => (t.at === "held" || t.at === "away" ? 0 : SCALE[t.kind]);

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
  /** The well stands once the door is open (showWell); its instance follows the things and the cairn's stone. */
  private well = { shown: false, i: 0 };
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
  private targets: { things: CarryTarget[]; cairn: CarryTarget; well: CarryTarget; gnome: CarryTarget };
  private reach: { a: CarryAct; target: CarryTarget | null } = { a: "throw", target: null };
  private day: number;
  /** The fruit the dog may fetch this visit: one the learner knows (fetch.ts fetchFruit), or none. */
  readonly fruit: Fruit | null;
  /** The dog's fetch under way: the thing it brings, and the thing it runs to (the same one, mostly). */
  private fetching: { bring: number; to: number } | null = null;
  /** How many times the dog has fetched this visit (each throw's seed), and the last surprise it brought, which never comes twice in a row. */
  private fetches = 0;
  private surprised: Surprise | null = null;

  constructor(layout: Layout, day: number, reducedMotion: boolean, world: CarryWorld, fruit: Fruit | null) {
    this.layout = layout;
    this.world = world;
    this.reducedMotion = reducedMotion;
    this.day = day;
    this.fruit = fruit;
    this.holds = cairnHolds(day);
    this.cairn = cairnAt(layout);
    const pebbles = Array.from({ length: PEBBLES }, (_, i): Thing => ({ kind: "pebble", ...pebbleHome(layout, i), y: 0.01, at: "rest", home: pebbleHome(layout, i) }));
    const stick: Thing = { kind: "stick", ...stickHome(layout), y: 0.01, at: "rest", home: stickHome(layout) };
    // Away until the dog brings them. They never sink, so their home is never used: the stick's will do.
    const away = SURPRISES.filter((k) => k !== "fruit" || fruit).map((kind): Thing => ({ kind, ...stickHome(layout), y: 0.01, at: "away", home: stickHome(layout) }));
    this.things = [...pebbles, stick, ...away];
    this.targets = { things: this.things.map((_, i) => ({ at: "thing", i })), cairn: { at: "cairn" }, well: { at: "well" }, gnome: { at: "gnome" } };
  }

  /** The loose thing you hold, if any. */
  get thing(): Loose | null {
    return this.held === null ? null : this.things[this.held].kind;
  }

  /** The loose thing in your hands, as the page shows it. */
  picked(): Picked | null {
    const thing = this.thing;
    if (thing === null) return null;
    if (thing !== "fruit") return { from: "ground", thing };
    // There is a fruit thing only when the visit has a fruit (the constructor).
    return { from: "ground", thing, fruit: this.fruit! };
  }

  /** Where loose thing `i` is now. */
  at(i: number): Readonly<{ x: number; z: number }> {
    return this.things[i];
  }

  /** The dog has the gnome or its hat (#335 S2): the gnome is not free to come and sit with you. */
  gnomeBusy(): boolean {
    for (const t of this.things) if ((t.kind === "hat" || t.kind === "gnome") && t.at !== "away") return true;
    return false;
  }

  /** The loose things, the cairn's flat stone and the well (unseen until showWell), in one instanced mesh; the rings, lying on the water. Draws no random numbers. */
  build() {
    const tex = T.pixelTexture(T.carryAtlas(this.fruit?.kind ?? null));
    const cell = (c: number) => c / T.CARRY_CELLS;
    const items = this.things.map((t) => ({ x: t.x, y: t.y, z: t.z, u: cell(T.CARRY_CELL[t.kind]), v: 0, uw: 1 / T.CARRY_CELLS, vh: 1, phase: 0, droop: 0, scale: shown(t), index: -8 }));
    items.push({ x: this.cairn.x, y: 0.005, z: this.cairn.z, u: cell(T.CARRY_CELL.flatStone), v: 0, uw: 1 / T.CARRY_CELLS, vh: 1, phase: 0, droop: 0, scale: STONE_SCALE, index: -8 });
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

  /** Draw a thing where it is now; hidden while you hold it, or while it is away. */
  private draw(i: number) {
    const t = this.things[i];
    this.pos.setXYZ(i, t.x, t.y, t.z);
    this.params.setZ(i, shown(t));
    this.pos.needsUpdate = this.params.needsUpdate = true;
  }

  /** Can this thing be picked up now: lying, floating, or on top of the cairn. */
  private liftable(i: number): boolean {
    const at = this.things[i].at;
    return at === "rest" || at === "floating" || (at === "stacked" && this.stack[this.stack.length - 1] === i);
  }

  /**
   * What the action button can do with loose things from (x, z): holding one,
   * put a pebble on the cairn or drop it in the well, in reach, or else throw
   * it; empty-handed, pick up the nearest thing in reach (`full`: you hold
   * leave it out's thing, so not).
   */
  reachAt(x: number, z: number, full: boolean): { a: CarryAct; target: CarryTarget | null } | null {
    const r = this.reach;
    if (this.held !== null) {
      const kind = this.things[this.held].kind;
      const pebble = kind === "pebble";
      // The gnome's hat, by the gnome: it goes back on its head (#335 S2).
      const gnome = kind === "hat" ? this.world.gnome() : null;
      if (pebble && near(x, z, this.cairn, REACH)) [r.a, r.target] = ["stack", this.targets.cairn];
      else if (pebble && this.well.shown && near(x, z, this.layout.well, WELL_REACH)) [r.a, r.target] = ["well", this.targets.well];
      else if (gnome && near(x, z, gnome, REACH)) [r.a, r.target] = ["give", this.targets.gnome];
      else [r.a, r.target] = ["throw", null];
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
    if (t.at === "cairn") return [this.cairn.x, this.top() + 0.1, this.cairn.z];
    // Over the dark of the well's mouth.
    if (t.at === "well") return [this.layout.well.x, 0.75, this.layout.well.z];
    if (t.at === "gnome") {
      // On its bare head. Only offered while the gnome is here (reachAt).
      const g = this.world.gnome()!;
      return [g.x, 0.42, g.z];
    }
    return [t.x, 0.1, t.z];
  }

  /** The height of the cairn's top: where the next pebble goes. */
  private top(): number {
    return STACK.base + this.stack.length * STACK.step;
  }

  /** Where to walk to act on a target from afar, and whether you are near enough already. A point on the water or ground is always near: it is acted on from where you stand. */
  standFor(t: CarryTarget, x: number, z: number): { x: number; z: number; near: boolean } {
    const w = this.layout.well;
    // In front of its stones: a walker may not stand on the well's middle.
    if (t.at === "well") return { x: w.x, z: w.z - w.r - WELL_FRONT, near: near(x, z, w, WELL_REACH) };
    // The gnome: only a target while it is here (reachAt).
    const at = t.at === "thing" ? this.things[t.i] : t.at === "cairn" ? this.cairn : t.at === "gnome" ? this.world.gnome()! : t;
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

  /** How far along the ray the well is, while you hold a pebble and the door is open; Infinity otherwise. */
  pickWell(r: Ray): number {
    if (this.thing !== "pebble" || !this.well.shown) return Infinity;
    const w = this.layout.well;
    return rayBox(r, [w.x - w.r, 0, w.z - w.r], [w.x + w.r, 1.2, w.z + w.r]);
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
    const landing: Landing = { i, thing: th.kind, place, x: ax, z: az, reaction: rx, said };
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

  // ---- Fetch (#335 S2) ----

  /**
   * The dog runs for thing `i`, just come down by it. What it brings back is
   * picked now, seeded by the day and how many times it has fetched this
   * visit. If it brings that same thing, the thing waits for it: nobody else
   * picks it up first.
   */
  fetchFor(i: number) {
    const to = this.things[i];
    if (to.kind === "pebble") throw new Error("fetchFor: the dog does not fetch pebbles (carry.ts ROWS)");
    const gnomeHere = this.world.gnome() !== null;
    const can = SURPRISES.filter((k) => this.can(k, gnomeHere));
    const bring = pickFetch(fetchSeed(this.day, this.fetches++), to.kind, can, this.surprised);
    const b = bring === to.kind ? i : this.things.findIndex((t) => t.kind === bring);
    // Anything but what you threw is one of `can`: a surprise.
    if (b !== i) this.surprised = bring as Surprise;
    this.fetching = { bring: b, to: i };
    if (b === i) to.at = "fetched";
  }

  /** Can this surprise come now: it is away (none is a fruit, on a visit with none), and the hat or the gnome itself only while the gnome stands here with its hat on. */
  private can(k: Surprise, gnomeHere: boolean): boolean {
    const t = this.things.find((th) => th.kind === k);
    if (!t || t.at !== "away") return false;
    return k === "hat" || k === "gnome" ? gnomeHere && !this.gnomeBusy() : true;
  }

  private fetch(): { bring: number; to: number } {
    if (!this.fetching) throw new Error("Carry: the dog is not fetching");
    return this.fetching;
  }

  /** The dog has reached what it ran to: what it brings goes in its mouth. If that is something else, what it ran to lies where it is. */
  dogTakes(): Fetchable {
    const f = this.fetch();
    const to = this.things[f.to];
    if (to.at === "fetched") to.at = "rest";
    const b = this.things[f.bring];
    b.at = "carried";
    return b.kind as Fetchable;
  }

  /** The dog, standing at (x, z), drops what it brings in front of its nose, by the feet of you at (yx, yz): it lies there, to pick up and throw again. */
  dogDrops(x: number, z: number, yx: number, yz: number): { thing: Fetchable; x: number; z: number } {
    const f = this.fetch();
    this.fetching = null;
    const th = this.things[f.bring];
    const d = Math.max(1e-3, Math.hypot(yx - x, yz - z));
    const rest = restAt(this.layout, x + ((yx - x) / d) * DROP, z + ((yz - z) / d) * DROP, "ground", this.world.doorOpen());
    [th.x, th.y, th.z, th.at] = [rest.x, 0.01, rest.z, "rest"];
    this.draw(f.bring);
    return { thing: th.kind as Fetchable, x: th.x, z: th.z };
  }

  /** Give the gnome its hat back from your hands: the hat is away again, for the dog to find another day. */
  give(): boolean {
    const i = this.held;
    if (i === null || this.things[i].kind !== "hat") return false;
    this.things[i].at = "away";
    this.held = null;
    this.draw(i);
    return true;
  }

  private ripple(x: number, z: number) {
    this.ring.t = 0;
    this.ring.pos.setXYZ(0, x, 0.05, z);
    this.ring.pos.needsUpdate = true;
  }

  /** The flight, a thing in the dog's mouth, the rings, the cairn's wobble and a floating stick's drift. Allocates nothing. */
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
    const fe = this.fetching;
    if (fe && this.things[fe.bring].at === "carried") {
      // The dog is here: it is fetching. Its visitors tick before the loose things, so this is where it is drawn this frame.
      const dog = this.world.dogDrawn()!;
      const th = this.things[fe.bring];
      const d = Math.max(1e-3, Math.hypot(f.x - dog.x, f.z - dog.z));
      th.x = dog.x + ((f.x - dog.x) / d) * MOUTH.toward;
      th.y = dog.y + MOUTH.y;
      th.z = dog.z + ((f.z - dog.z) / d) * MOUTH.toward;
      this.draw(fe.bring);
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
