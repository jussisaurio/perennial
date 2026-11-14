// The dandelion clocks and their seeds (#360), drawn from toys.ts Clocks
// (which says where the wind takes them). A Part because it ticks: the seeds
// are one small point buffer the tick fills in place.

import * as THREE from "three";
import type { Conditions } from "./conditions";
import type { Frame, Part } from "./scenePart";
import { rayBox, type Ray } from "./scenery";
import { sprites, type BuildCtx } from "./sceneSprites";
import * as T from "./textures";
import { SEEDS, seedAt, type Clocks } from "./toys";

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

export class Toys implements Part {
  private clocks!: SpriteMesh;
  private clockUv!: THREE.InstancedBufferAttribute;
  private seeds!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private seedPos!: THREE.BufferAttribute;
  private seedAlpha!: THREE.BufferAttribute;
  /** Each clock as last drawn: blown, and with seeds drawn. */
  private drawnBlown: boolean[];
  private drawnSeeds: boolean[];
  /** Filled in place every tick: tick allocates nothing. */
  private seed = { x: 0, y: 0, z: 0, a: 0 };

  private game: Clocks;
  private reducedMotion: boolean;

  constructor(game: Clocks, reducedMotion: boolean) {
    this.game = game;
    this.reducedMotion = reducedMotion;
    this.drawnBlown = game.heads.map(() => false);
    this.drawnSeeds = game.heads.map(() => false);
  }

  /** The clocks, and the seeds' points (hidden until a blow). Draws no random numbers: the build order's shared sequence is untouched. */
  build(c: BuildCtx) {
    const tex = T.pixelTexture(T.toyAtlas());
    this.clocks = sprites(
      tex,
      this.game.heads.map((h, i) => ({ x: h.x, y: 0, z: h.z, u: T.TOY_CELL.clock / T.TOY_CELLS, v: 0, uw: 1 / T.TOY_CELLS, vh: 1, phase: i * 1.7, droop: 0, scale: 1, index: -9 })),
      CLOCK.w,
      CLOCK.h,
    ) as SpriteMesh;
    this.clockUv = this.clocks.geometry.getAttribute("iUv") as THREE.InstancedBufferAttribute;
    // Tinted with the time of day, and swaying in the wind like the plants.
    c.mats.add(this.clocks.material);
    c.scene.add(this.clocks);
    const n = this.game.heads.length * SEEDS;
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

  /** A blown clock stands bare; every seed in the air or on the ground, where it is now. Allocates nothing. */
  tick(f: Frame) {
    const g = this.game;
    let live = false;
    for (let h = 0; h < g.heads.length; h++) {
      if (g.blown[h] && !this.drawnBlown[h]) {
        this.drawnBlown[h] = true;
        this.clockUv.setX(h, T.TOY_CELL.blown / T.TOY_CELLS);
        this.clockUv.needsUpdate = true;
      }
      const b = g.blows[h];
      if (!b && !this.drawnSeeds[h]) continue;
      for (let i = 0; i < SEEDS; i++) {
        const k = h * SEEDS + i;
        // A blow that has ended leaves no seed behind for the next one to show.
        if (b) seedAt(b.flights[i], f.elapsed - b.at, this.reducedMotion, this.seed);
        else this.seed.a = 0;
        this.seedPos.setXYZ(k, this.seed.x, this.seed.y, this.seed.z);
        this.seedAlpha.setX(k, this.seed.a);
      }
      this.drawnSeeds[h] = b !== null;
      live ||= b !== null;
      this.seedPos.needsUpdate = this.seedAlpha.needsUpdate = true;
    }
    // Shown only while a blow is under way: nothing to draw otherwise.
    this.seeds.visible = live;
  }

  /** The clock a ray meets, and how far along it: only one still to blow. */
  pick(r: Ray): { i: number; t: number } | null {
    let best: { i: number; t: number } | null = null;
    this.game.heads.forEach((h, i) => {
      if (this.game.blown[i]) return;
      const t = rayBox(r, [h.x - 0.14, 0, h.z - 0.14], [h.x + 0.14, CLOCK.h * 0.85, h.z + 0.14]);
      if (t < (best?.t ?? Infinity)) best = { i, t };
    });
    return best;
  }
}
