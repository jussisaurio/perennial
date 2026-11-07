// Lawn toys in the walk (#360, garden/toys.ts says where the wind takes
// things): the dandelion clocks and their seeds. A Part because it ticks: the
// seeds are one small point buffer the tick fills in place. It says what the
// action button can do where you stand, and does it; GardenScene asks it on a
// tap, on its button, and when it reports what is in reach.

import * as THREE from "three";
import type { Conditions } from "./conditions";
import type { Frame, Part } from "./scenePart";
import { rayBox, type Ray } from "./scenery";
import { sprites, type BuildCtx } from "./sceneSprites";
import * as T from "./textures";
import { blowEnds, dandelions, flight, SEEDS, seedAt, type Flight, type Head, type ToysWalk } from "./toys";
import { REACH_SLACK } from "./reach";
import { BED_H, type Layout } from "./world";

/** What the action button does here (GardenScene's Reach): blow a dandelion clock. */
export type ToyAct = "blow";
/** A clock a tap or the action button acts on. */
export type ToyTarget = { at: "clock"; i: number };
/** What a toy did, for the page to count and to say. */
export type ToyDone = { did: "blow" };

/** What the toys need from the rest of the scene: a plant sneezes. */
export interface ToyHooks {
  sneeze: (plant: number) => void;
}

/** Near enough to a clock (m) to blow it. */
const REACH = 1.2;
/** A walk to a clock stops this short of it, so it is still in view. */
export const TOY_STAND = 0.8;
/** A clock's sprite (m): its cell is 16×24 px. */
const CLOCK = { w: 0.34, h: 0.5 };

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
  /** Seconds since the walk opened, as of the last tick: a blow starts then. */
  private now = 0;
  /** Filled in place every tick: tick allocates nothing. */
  private seed = { x: 0, y: 0, z: 0, a: 0 };
  /** Every target the action button can point at, and what reachAt returns, made once: it allocates nothing. */
  private targets: ToyTarget[];
  private reach: { a: ToyAct; target: ToyTarget };

  constructor(layout: Layout, walk: ToysWalk, reducedMotion: boolean, hooks: ToyHooks) {
    this.layout = layout;
    this.walk = walk;
    this.reducedMotion = reducedMotion;
    this.hooks = hooks;
    this.heads = dandelions(layout, walk.day);
    this.blown = this.heads.map(() => false);
    this.blows = this.heads.map(() => null);
    this.targets = this.heads.map((_, i) => ({ at: "clock", i }));
    this.reach = { a: "blow", target: this.targets[0] };
  }

  /** The clocks, and the seeds' points (hidden until a blow). Draws no random numbers: the build order's shared sequence is untouched. */
  build(c: BuildCtx) {
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

  /** The nearest clock still to blow within reach of (x, z), or -1. The one the button shows now (`held`) stays in reach REACH_SLACK farther (#838). */
  private clockNear(x: number, z: number, held: ToyTarget | null): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.heads.length; i++) {
      const d = Math.hypot(this.heads[i].x - x, this.heads[i].z - z);
      if (!this.blown[i] && d < bestD && d < REACH + (held === this.targets[i] ? REACH_SLACK : 0)) [best, bestD] = [i, d];
    }
    return best;
  }

  /** What the action button can do from (x, z), and on what: blow a clock in reach. Null when nothing here. */
  reachAt(x: number, z: number, held: ToyTarget | null): { a: ToyAct; target: ToyTarget } | null {
    const i = this.clockNear(x, z, held);
    if (i < 0) return null;
    this.reach.target = this.targets[i];
    return this.reach;
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
}
