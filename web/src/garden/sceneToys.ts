// Lawn and pond toys in the walk (#360, garden/toys.ts says where the wind
// takes things): the dandelion clocks and their seeds, and the paper boat on
// the pond. A Part because it ticks: the seeds are one small point buffer the
// tick fills in place, and the boat drifts. It says what the action button can
// do where you stand, and does it; GardenScene asks it on a tap, on its button,
// and when it reports what is in reach.

import * as THREE from "three";
import type { Conditions } from "./conditions";
import type { Frame, Part } from "./scenePart";
import { rayBox, type Ray } from "./scenery";
import { BED_H, sprites, type BuildCtx } from "./sceneSprites";
import * as T from "./textures";
import { blowEnds, boatAt, dandelions, flight, FOLD_REACH, FROG_BOARDS, SEEDS, seedAt, voyage, type BoatWord, type Flight, type Head, type ToysWalk, type Voyage } from "./toys";
import type { Layout } from "./world";

/** What the action button does here (GardenScene's Reach): blow a dandelion clock, fold a paper boat. */
export type ToyAct = "blow" | "fold";
/** A thing a tap or the action button acts on: a clock, or the pond's edge. */
export type ToyTarget = { at: "clock"; i: number } | { at: "pond" };
/** What a toy did, for the page to count and to say. */
export type ToyDone = { did: "blow" } | { did: "fold"; word: BoatWord };

/** What the toys need from the rest of the scene: a plant sneezes; the frog, if it is here today, to carry on the boat; the boat's material, made after the build, to tint and sway like the rest. */
export interface ToyHooks {
  sneeze: (plant: number) => void;
  material: (m: THREE.ShaderMaterial) => void;
  frog: () => { home: Readonly<{ x: number; z: number }>; to: (x: number, y: number, z: number) => void } | null;
}

/** Near enough to a clock (m) to blow it. */
const REACH = 1.2;
/** A walk to a clock stops this short of it, so it is still in view. */
export const TOY_STAND = 0.8;
/** A clock's sprite (m): its cell is 16×24 px. */
const CLOCK = { w: 0.34, h: 0.5 };
/** The boat's sprite (m), and how high it floats: the water is at 0.04 m (sceneSky.ts). */
const BOAT = { w: 0.5, h: 0.25, y: 0.03 };
/** With reduced motion the boat is set on the water this far along its way (s), and stays there. */
const BOAT_STILL = 3;

type SpriteMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

const SEED_VERT = /* glsl */ `
  attribute float alpha;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(16.0 / -mv.z, 2.0, 6.0);
    vA = alpha;
  }
`;
const SEED_FRAG = /* glsl */ `
  uniform vec3 uTint;
  varying float vA;
  void main() {
    if (vA < 0.02) discard;
    gl_FragColor = vec4(uTint, vA);
  }
`;

/** One clock's blow: when it began, its seeds' ways, and which of them have landed yet. */
interface Blow {
  at: number;
  flights: Flight[];
  landed: Uint8Array;
  ends: number;
}

export class Toys implements Part {
  private layout: Layout;
  private walk: ToysWalk;
  private reducedMotion: boolean;
  private hooks: ToyHooks;
  private heads: Head[];
  private blown: boolean[];
  private blows: (Blow | null)[];
  private clocks!: SpriteMesh;
  private clockUv!: THREE.InstancedBufferAttribute;
  private seeds!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private seedPos!: THREE.BufferAttribute;
  private seedAlpha!: THREE.BufferAttribute;
  private scene!: THREE.Scene;
  /** Seconds since the walk opened, as of the last tick: a blow or a boat starts then. */
  private now = 0;
  /** The boat, once folded (one a visit): its way, when it set off (null while its word is drawn), its sprite, and the frog, once it climbed on. */
  private boat: { v: Voyage; at: number | null; mesh: SpriteMesh | null; frog: ReturnType<ToyHooks["frog"]>; aboard: boolean } | null = null;
  private disposed = false;
  /** Filled in place every tick: tick allocates nothing. */
  private seed = { x: 0, y: 0, z: 0, a: 0 };
  private at = { x: 0, z: 0 };
  /** Every target the action button can point at, and what reachAt returns, made once: it allocates nothing. */
  private targets: { clocks: ToyTarget[]; pond: ToyTarget };
  private reach: { a: ToyAct; target: ToyTarget };

  constructor(layout: Layout, walk: ToysWalk, reducedMotion: boolean, hooks: ToyHooks) {
    this.layout = layout;
    this.walk = walk;
    this.reducedMotion = reducedMotion;
    this.hooks = hooks;
    this.heads = dandelions(layout, walk.day, BED_H);
    this.blown = this.heads.map(() => false);
    this.blows = this.heads.map(() => null);
    this.targets = { clocks: this.heads.map((_, i) => ({ at: "clock", i })), pond: { at: "pond" } };
    this.reach = { a: "blow", target: this.targets.pond };
  }

  /** The clocks, and the seeds' points (hidden until a blow). Draws no random numbers: the build order's shared sequence is untouched. */
  build(c: BuildCtx) {
    this.scene = c.scene;
    const tex = T.pixelTexture(T.toyAtlas());
    this.clocks = sprites(
      tex,
      this.heads.map((h, i) => ({ x: h.x, y: 0, z: h.z, u: T.TOY_CELL.clock / T.TOY_CELLS, v: 0, uw: 1 / T.TOY_CELLS, vh: 1, phase: i * 1.7, droop: 0, scale: 1, index: -9 })),
      CLOCK.w,
      CLOCK.h,
    ) as SpriteMesh;
    this.clockUv = this.clocks.geometry.getAttribute("iUv") as THREE.InstancedBufferAttribute;
    // Tinted with the time of day, and swaying in the wind like the plants.
    c.mats.add(this.clocks.material);
    c.scene.add(this.clocks);
    const n = this.heads.length * SEEDS;
    const geo = new THREE.BufferGeometry();
    this.seedPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.seedAlpha = new THREE.BufferAttribute(new Float32Array(n), 1);
    geo.setAttribute("position", this.seedPos);
    geo.setAttribute("alpha", this.seedAlpha);
    this.seeds = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: { uTint: { value: new THREE.Color(1, 1, 1) } }, vertexShader: SEED_VERT, fragmentShader: SEED_FRAG, transparent: true, depthWrite: false }));
    this.seeds.frustumCulled = false;
    this.seeds.visible = false;
    c.scene.add(this.seeds);
  }

  /** The seeds take the light of the time of day, a little brighter than the garden: they are white. */
  onConditions(c: Conditions) {
    const [r, g, b] = T.SKIES[c.time].tint;
    this.seeds.material.uniforms.uTint.value.setRGB(Math.min(1, r * 1.15), Math.min(1, g * 1.15), Math.min(1, b * 1.15));
  }

  tick(f: Frame) {
    this.now = f.elapsed;
    this.tickSeeds(f.elapsed);
    this.tickBoat(f.elapsed);
  }

  /** Every seed in the air or on the ground, where it is now; a seed that lands on a plant makes it sneeze. */
  private tickSeeds(elapsed: number) {
    let any = false;
    let live = false;
    for (let h = 0; h < this.blows.length; h++) {
      const b = this.blows[h];
      if (!b) continue;
      const t = elapsed - b.at;
      for (let i = 0; i < SEEDS; i++) {
        const f = b.flights[i];
        seedAt(f, t, this.reducedMotion, this.seed);
        const k = h * SEEDS + i;
        this.seedPos.setXYZ(k, this.seed.x, this.seed.y, this.seed.z);
        this.seedAlpha.setX(k, this.seed.a);
        if (!b.landed[i] && t >= f.delay + f.time) {
          b.landed[i] = 1;
          // With reduced motion nothing lands: the seeds fade on the clock.
          if (f.plant >= 0 && !this.reducedMotion) this.hooks.sneeze(f.plant);
        }
      }
      any = true;
      if (t > b.ends) this.blows[h] = null;
      else live = true;
    }
    if (!any) return;
    this.seedPos.needsUpdate = true;
    this.seedAlpha.needsUpdate = true;
    // Shown only while a blow is under way: nothing to draw otherwise.
    this.seeds.visible = live;
  }

  /** The boat drifts with the wind, bobbing a little (it rocks with the garden's sway); the frog climbs on when it passes the frog's pad, and rides. */
  private tickBoat(elapsed: number) {
    const b = this.boat;
    if (!b?.mesh || b.at === null) return;
    const t = this.reducedMotion ? BOAT_STILL : elapsed - b.at;
    boatAt(b.v, t, this.at);
    const y = BOAT.y + (this.reducedMotion ? 0 : Math.sin(elapsed * 2.1) * 0.008);
    const pos = b.mesh.geometry.getAttribute("iPos") as THREE.InstancedBufferAttribute;
    pos.setXYZ(0, this.at.x, y, this.at.z);
    pos.needsUpdate = true;
    if (b.frog && !b.aboard && Math.hypot(b.frog.home.x - this.at.x, b.frog.home.z - this.at.z) < FROG_BOARDS) b.aboard = true;
    // On the deck: the hull's top edge is 15 of the boat's 32 px up.
    if (b.aboard) b.frog!.to(this.at.x, y + (15 / 32) * BOAT.h, this.at.z);
  }

  /** Where the boat is now, for its word's tag (the one object tick fills); null before it sets off. */
  boatSpot(): { x: number; z: number } | null {
    return this.boat && this.boat.at !== null ? this.at : null;
  }

  /** The nearest clock still to blow within reach of (x, z), or -1. */
  private clockNear(x: number, z: number): number {
    let best = -1;
    let bestD = REACH;
    for (let i = 0; i < this.heads.length; i++) {
      const d = Math.hypot(this.heads[i].x - x, this.heads[i].z - z);
      if (!this.blown[i] && d < bestD) [best, bestD] = [i, d];
    }
    return best;
  }

  /** May a boat be folded from (x, z): at the pond's edge, with a word to write, and none folded yet this walk. */
  private canFold(x: number, z: number): boolean {
    const p = this.layout.pond;
    return !this.boat && !!this.walk.boat && Math.hypot(x - p.x, z - p.z) < p.r + FOLD_REACH;
  }

  /** What the action button can do from (x, z), and on what: blow a clock in reach; at the pond's edge, fold a boat. Null when nothing here. */
  reachAt(x: number, z: number): { a: ToyAct; target: ToyTarget } | null {
    const i = this.clockNear(x, z);
    if (i >= 0) return this.reached("blow", this.targets.clocks[i]);
    if (this.canFold(x, z)) return this.reached("fold", this.targets.pond);
    return null;
  }

  private reached(a: ToyAct, target: ToyTarget) {
    this.reach.a = a;
    this.reach.target = target;
    return this.reach;
  }

  /** Where the glint shows for a target in reach: on the clock's fluff, or on the water in front of you. */
  cueAt(t: ToyTarget, x: number, z: number): [number, number, number] {
    if (t.at === "clock") return [this.heads[t.i].x, CLOCK.h * 0.7, this.heads[t.i].z];
    const p = this.layout.pond;
    const d = Math.hypot(x - p.x, z - p.z);
    const r = p.r - 0.3;
    return [p.x + ((x - p.x) / d) * r, 0.15, p.z + ((z - p.z) / d) * r];
  }

  /** Where to walk to blow a clock from afar, and whether you are near enough already. */
  standFor(i: number, x: number, z: number): { x: number; z: number; near: boolean } {
    const h = this.heads[i];
    return { x: h.x, z: h.z, near: Math.hypot(x - h.x, z - h.z) < REACH };
  }

  /** The clock a ray meets, and how far along it: only one still to blow. */
  pick(r: Ray): { i: number; t: number } | null {
    let best: { i: number; t: number } | null = null;
    this.heads.forEach((h, i) => {
      if (this.blown[i]) return;
      const t = rayBox(r, [h.x - 0.14, 0, h.z - 0.14], [h.x + 0.14, CLOCK.h * 0.85, h.z + 0.14]);
      if (t < (best?.t ?? Infinity)) best = { i, t };
    });
    return best;
  }

  /** Blow clock `i`: its seeds go with today's wind, and it stands bare for the rest of the walk. False when it is blown already. */
  blow(i: number): boolean {
    if (this.blown[i]) return false;
    this.blown[i] = true;
    this.clockUv.setX(i, T.TOY_CELL.blown / T.TOY_CELLS);
    this.clockUv.needsUpdate = true;
    const flights = Array.from({ length: SEEDS }, (_, k) => flight(this.layout, this.heads[i], this.walk.day, k, BED_H));
    this.blows[i] = { at: this.now, flights, landed: new Uint8Array(SEEDS), ends: blowEnds(flights, this.reducedMotion) };
    this.seeds.visible = true;
    return true;
  }

  /**
   * Fold the boat, standing at (x, z) by the pond: its word is written on its
   * side, and it sets off once the pixel font has loaded (a canvas does not
   * wait for it). Null when it no longer applies.
   */
  fold(x: number, z: number): BoatWord | null {
    const word = this.walk.boat;
    if (!word || !this.canFold(x, z)) return null;
    const boat: NonNullable<Toys["boat"]> = { v: voyage(this.layout.pond, x, z, this.walk.day), at: null, mesh: null, frog: this.hooks.frog(), aboard: false };
    this.boat = boat;
    // No catch: the font's name is fixed and valid, so a rejection is a bug to see, not a case to hide.
    void document.fonts.load(`700 11px "Pixelify Sans"`).then(() => {
      if (this.disposed) return;
      boat.mesh = sprites(T.pixelTexture(T.boat(word.lemma)), [{ x: boat.v.from.x, y: BOAT.y, z: boat.v.from.z, u: 0, v: 0, uw: 1, vh: 1, phase: 0, droop: 0, scale: 1, index: -9 }], BOAT.w, BOAT.h) as SpriteMesh;
      this.hooks.material(boat.mesh.material);
      this.scene.add(boat.mesh);
      boat.at = this.now;
      boatAt(boat.v, 0, this.at);
    });
    return word;
  }

  dispose() {
    this.disposed = true;
  }
}
