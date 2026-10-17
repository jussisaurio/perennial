// Walk into things in the walk (#359, garden/walkInto.ts says how): an
// orchard tree you walk into shakes and drops a fruit (it bounces and rolls),
// petals or leaves; autumn's leaf piles burst into leaves that float down,
// then creep back home. (Brushing the beds is the plants' own: scenePlants.ts.)
// One technique of its own: a small fixed pool of pixel bits (Points) moved on
// the CPU, plus a few fruit sprites. Everything is made at build; tick only
// moves what is already there.

import * as THREE from "three";
import type { FruitKind } from "./leave";
import type { PlacedTree } from "./orchard";
import { TREE_SHAPES } from "./orchardArt";
import type { Frame, Part } from "./scenePart";
import { FOG_FAR, FOG_NEAR, sprites, type BuildCtx } from "./sceneSprites";
import * as T from "./textures";
import { AUTUMN, bumpStep, fellFrom, fruitDrop, leafPiles, PILES, rollStep, scatter, type Fell, type Rolling } from "./walkInto";

/** Pixel bits in the air or on the ground at once. Small, for phones: a burst takes the oldest when they are all out. */
const BITS = 48;
/** How many leaves a pile bursts into, and how many petals or leaves a bumped tree lets go of. */
const BURST = 18;
const SHOWER = 8;
/** Fallen fruit lying about at once: one more bump takes the oldest to drop again. */
const FRUITS = 4;
/**
 * A bit's flight: gravity (m/s², light, so it flutters down), air drag (per
 * s), how long it lies on the ground (s) before it goes (a tree's) or creeps
 * home (a pile's), how fast it creeps (m/s), and its size (m).
 */
const BIT = { g: 3.2, drag: 2.2, lie: 6, lieHome: 2.5, creep: 0.35, size: 0.05 };
/** A bumped tree's shake: how long (s), how fast (rad/s), how far (rad). */
const SHAKE = { s: 1.1, w: 26, a: 0.06 };
/** A pile: metres per cell, and its scale while its leaves are out (it grows back as they come home). */
const PILE = { size: 0.9, low: 0.2 };
/** Metres per leave atlas cell (32 px) for a fallen fruit: a 7 px fruit is about 13 cm. */
const FRUIT_SIZE = 0.6;
/** A bit that is not out: drawn nowhere (the vertex shader puts it outside the view). */
const OFF = -100;

const BITS_VERT = /* glsl */ `
  attribute vec3 iColor;
  uniform float uScale;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vColor;
  varying float vFog;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = position.y < ${(OFF / 2).toFixed(1)} ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
    gl_PointSize = clamp(${BIT.size.toFixed(2)} * uScale / -mv.z, 1.0, 12.0);
    vColor = iColor;
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  }
`;
const BITS_FRAG = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uFog;
  varying vec3 vColor;
  varying float vFog;
  void main() {
    gl_FragColor = vec4(mix(vColor * uTint, uFog, vFog), 1.0);
  }
`;

/** What a bit is doing: not out, in the air, lying on the ground, creeping home to its pile. */
const MODE = { off: 0, air: 1, lying: 2, home: 3 } as const;

type SpriteMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

export class WalkInto implements Part {
  private reducedMotion: boolean;
  private onBump: (t: PlacedTree, fell: Fell, fruit: Readonly<Rolling> | null) => void;
  private onPile: () => void;
  /** The bits' material, for GardenScene.tint (it is not a sprite material: GardenScene.tick sets nothing on it). */
  readonly mats = new Set<THREE.ShaderMaterial>();

  private bits!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private pos!: THREE.BufferAttribute;
  private col!: THREE.BufferAttribute;
  private vel = new Float32Array(BITS * 3);
  private mode = new Uint8Array(BITS);
  private until = new Float32Array(BITS);
  /** The pile a bit belongs to (it creeps home to it), or -1: a tree's. */
  private home = new Int8Array(BITS).fill(-1);
  private nextBit = 0;
  private bitsOut = 0;

  private piles: { x: number; z: number }[] = [];
  private pileParams: THREE.InstancedBufferAttribute | null = null;
  /** Each pile's leaves still away from it, whether walking into it bursts it now, and the scale it is drawn at. */
  private pileOut = new Int16Array(PILES.count);
  private pileArmed = new Uint8Array(PILES.count).fill(1);
  private pileScale = new Float32Array(PILES.count).fill(1);
  private autumnColors: THREE.Color[] = AUTUMN.map((c) => new THREE.Color(c));

  private trees: readonly PlacedTree[] = [];
  private treeParams: THREE.InstancedBufferAttribute | null = null;
  private treeArmed = new Uint8Array(0);
  /** When each tree was bumped (s, Frame.elapsed), or -1: it is still. */
  private shakeAt = new Float32Array(0);
  /** Each tree's petals and leaves, parsed once. */
  private treeColors: { petals: THREE.Color[]; leaves: THREE.Color[] }[] = [];

  private fruit!: SpriteMesh;
  private fruitPos!: THREE.InstancedBufferAttribute;
  private fruitUv!: THREE.InstancedBufferAttribute;
  private fruitParams!: THREE.InstancedBufferAttribute;
  private fruits: Rolling[] = Array.from({ length: FRUITS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, still: true }));
  private nextFruit = 0;

  /** `onBump`: a tree was walked into, what it let fall and, for a fruit, where it is (it moves). `onPile`: a leaf pile burst. */
  constructor(reducedMotion: boolean, onBump: (t: PlacedTree, fell: Fell, fruit: Readonly<Rolling> | null) => void, onPile: () => void) {
    this.reducedMotion = reducedMotion;
    this.onBump = onBump;
    this.onPile = onPile;
  }

  /** The bits, the fruit sprites and, in autumn, the leaf piles. Draws no random numbers. */
  build(c: BuildCtx, autumn: boolean) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(BITS * 3);
    for (let i = 0; i < BITS; i++) pos[i * 3 + 1] = OFF;
    this.pos = new THREE.BufferAttribute(pos, 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(BITS * 3), 3);
    geo.setAttribute("position", this.pos);
    geo.setAttribute("iColor", this.col);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uFogNear: { value: FOG_NEAR }, uFogFar: { value: FOG_FAR }, uFog: { value: new THREE.Color() }, uTint: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: BITS_VERT,
      fragmentShader: BITS_FRAG,
    });
    this.mats.add(mat);
    this.bits = new THREE.Points(geo, mat);
    this.bits.frustumCulled = false;
    c.scene.add(this.bits);

    // Fallen fruit: drawn from the leave atlas's fruit cells, hidden (scale 0) until one falls.
    const atlas = T.pixelTexture(T.leaveAtlas());
    this.fruit = sprites(
      atlas,
      this.fruits.map(() => ({ x: 0, y: 0, z: 0, u: 0, v: 0, uw: 1 / T.LEAVE_CELLS, vh: 1, phase: 0, droop: 0, scale: 0, index: -9 })),
      FRUIT_SIZE,
      FRUIT_SIZE,
    ) as SpriteMesh;
    const fg = this.fruit.geometry;
    this.fruitPos = fg.getAttribute("iPos") as THREE.InstancedBufferAttribute;
    this.fruitUv = fg.getAttribute("iUv") as THREE.InstancedBufferAttribute;
    this.fruitParams = fg.getAttribute("iParams") as THREE.InstancedBufferAttribute;
    c.mats.add(this.fruit.material);
    c.scene.add(this.fruit);

    if (!autumn) return;
    this.piles = leafPiles(c.L);
    if (!this.piles.length) return;
    const mesh = sprites(
      T.pixelTexture(T.leafPile()),
      this.piles.map((p, i) => ({ x: p.x, y: 0.01, z: p.z, u: 0, v: 0, uw: 1, vh: 1, phase: i * 2.1, droop: 0, scale: 1, index: -9 })),
      PILE.size,
      PILE.size,
    );
    this.pileParams = mesh.geometry.getAttribute("iParams") as THREE.InstancedBufferAttribute;
    c.mats.add(mesh.material);
    c.scene.add(mesh);
  }

  /** The orchard's trees once the door is open (orchardScene.ts), and their sprites' params (one instance per tree, in the same order), for the shake. */
  setOrchard(trees: readonly PlacedTree[], params: THREE.InstancedBufferAttribute | null) {
    this.trees = trees;
    this.treeParams = params;
    this.treeArmed = new Uint8Array(trees.length).fill(1);
    this.shakeAt = new Float32Array(trees.length).fill(-1);
    this.treeColors = trees.map((t) => ({ petals: TREE_SHAPES[t.kind].blossom.map((c) => new THREE.Color(c)), leaves: TREE_SHAPES[t.kind].leaf.map((c) => new THREE.Color(c)) }));
  }

  /** Framebuffer pixels per metre at 1 m (GardenScene.resize), for the bits' size. */
  resize(pxPerMetre: number) {
    this.bits.material.uniforms.uScale.value = pxPerMetre;
  }

  tick(f: Frame) {
    const motion = !this.reducedMotion;
    if (this.trees.length) {
      const hit = bumpStep(this.trees, this.treeArmed, f.x, f.z, f.speed);
      if (hit >= 0) this.bump(hit, f, motion);
      this.tickShake(f.elapsed);
    }
    // With reduced motion a pile stays as it is: nothing bursts.
    if (motion) for (let i = 0; i < this.piles.length; i++) this.tickPile(i, f);
    if (this.bitsOut) this.tickBits(f);
    for (let i = 0; i < FRUITS; i++) {
      const r = this.fruits[i];
      if (r.still) continue;
      rollStep(r, f.dt);
      this.fruitPos.setXYZ(i, r.x, r.y, r.z);
      this.fruitPos.needsUpdate = true;
    }
  }

  private bump(i: number, f: Frame, motion: boolean) {
    const t = this.trees[i];
    const fell = fellFrom(t);
    if (motion) this.shakeAt[i] = f.elapsed;
    if (fell === "fruit") {
      // Left and right of the trunk in turn.
      const side = this.nextFruit % 2 ? 1 : -1;
      const slot = this.nextFruit++ % FRUITS;
      const r = this.fruits[slot];
      fruitDrop(t, f.x, f.z, side, motion, r);
      this.fruitPos.setXYZ(slot, r.x, r.y, r.z);
      this.fruitPos.needsUpdate = true;
      // fellFrom gives a fruit only for a fruit tree, never the plain tree.
      this.fruitUv.setX(slot, Math.fround(T.LEAVE_CELL.fruit(t.kind as FruitKind) / T.LEAVE_CELLS));
      this.fruitUv.needsUpdate = true;
      this.fruitParams.setZ(slot, 1);
      this.fruitParams.needsUpdate = true;
      return this.onBump(t, fell, r);
    }
    if (motion) {
      const colors = fell === "petals" ? this.treeColors[i].petals : this.treeColors[i].leaves;
      for (let k = 0; k < SHOWER; k++) {
        const s = scatter(f.elapsed * 7 + k);
        const s2 = scatter(f.elapsed * 13 + k * 3);
        this.spawn(t.x + (s - 0.5) * t.half * 1.4, t.height * (0.45 + 0.4 * s2), t.z + (s2 - 0.5) * t.half * 1.4, (s2 - 0.5) * 0.4, 0, (s - 0.5) * 0.4, colors[k % colors.length], -1, f.elapsed);
      }
    }
    this.onBump(t, fell, null);
  }

  /** The bumped trees shake, less and less, then stand still. */
  private tickShake(elapsed: number) {
    const params = this.treeParams;
    if (!params) return;
    for (let i = 0; i < this.trees.length; i++) {
      const at = this.shakeAt[i];
      if (at < 0) continue;
      const t = elapsed - at;
      const done = t > SHAKE.s;
      params.setY(i, done ? 0 : Math.sin(t * SHAKE.w) * SHAKE.a * (1 - t / SHAKE.s));
      params.needsUpdate = true;
      if (done) this.shakeAt[i] = -1;
    }
  }

  /** Walk into a whole pile and it bursts; it is ready again once its leaves are home and you have stepped away. Its size follows its leaves. */
  private tickPile(i: number, f: Frame) {
    const p = this.piles[i];
    const d = Math.hypot(f.x - p.x, f.z - p.z);
    if (d > PILES.r + 0.5) this.pileArmed[i] = 1;
    else if (this.pileArmed[i] && d < PILES.r && f.speed > 0 && this.pileOut[i] === 0) {
      this.pileArmed[i] = 0;
      for (let k = 0; k < BURST; k++) {
        const a = scatter(f.elapsed * 5 + k) * Math.PI * 2;
        const s = 0.6 + scatter(f.elapsed * 11 + k) * 1.2;
        this.spawn(p.x + Math.cos(a) * 0.15, 0.15, p.z + Math.sin(a) * 0.15, Math.cos(a) * s, 1.6 + s, Math.sin(a) * s, this.autumnColors[k % AUTUMN.length], i, f.elapsed);
      }
      this.onPile();
    }
    const scale = PILE.low + (1 - PILE.low) * (1 - this.pileOut[i] / BURST);
    if (scale === this.pileScale[i] || !this.pileParams) return;
    this.pileScale[i] = scale;
    this.pileParams.setZ(i, scale);
    this.pileParams.needsUpdate = true;
  }

  /** Send a bit into the air: the next one in the pool, even if it is still out (its pile, if any, stops waiting for it). */
  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, home: number, elapsed: number) {
    const i = this.nextBit;
    this.nextBit = (i + 1) % BITS;
    if (this.mode[i] !== MODE.off) {
      if (this.home[i] >= 0) this.pileOut[this.home[i]]--;
    } else this.bitsOut++;
    this.mode[i] = MODE.air;
    this.home[i] = home;
    if (home >= 0) this.pileOut[home]++;
    this.until[i] = elapsed;
    this.pos.setXYZ(i, x, y, z);
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col.setXYZ(i, color.r, color.g, color.b);
    this.col.needsUpdate = true;
  }

  /** The bits flutter down, lie a while, then go (a tree's) or creep home to their pile. */
  private tickBits(f: Frame) {
    const dt = f.dt;
    const pos = this.pos;
    for (let i = 0; i < BITS; i++) {
      const m = this.mode[i];
      if (m === MODE.off) continue;
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      if (m === MODE.air) {
        const drag = Math.max(0, 1 - BIT.drag * dt);
        const v = i * 3;
        this.vel[v] *= drag;
        this.vel[v + 2] *= drag;
        this.vel[v + 1] = (this.vel[v + 1] - BIT.g * dt) * drag;
        // A leaf rocks from side to side as it falls.
        x += (this.vel[v] + Math.sin(f.elapsed * 5 + i) * 0.3) * dt;
        y += this.vel[v + 1] * dt;
        z += (this.vel[v + 2] + Math.cos(f.elapsed * 4 + i) * 0.3) * dt;
        if (y <= 0.02) {
          y = 0.02;
          this.mode[i] = MODE.lying;
          this.until[i] = f.elapsed + (this.home[i] >= 0 ? BIT.lieHome + (i % 5) * 0.4 : BIT.lie);
        }
      } else if (m === MODE.lying) {
        if (f.elapsed > this.until[i]) {
          if (this.home[i] >= 0) this.mode[i] = MODE.home;
          else this.off(i);
        }
      } else {
        const p = this.piles[this.home[i]];
        const dx = p.x - x;
        const dz = p.z - z;
        const d = Math.hypot(dx, dz);
        if (d < 0.08) {
          this.off(i);
          continue;
        }
        const step = Math.min(d, BIT.creep * dt);
        x += (dx / d) * step;
        z += (dz / d) * step;
        // Little hops, as if a breeze nudged it along.
        y = 0.02 + Math.abs(Math.sin(f.elapsed * 6 + i)) * 0.03;
      }
      if (this.mode[i] !== MODE.off) pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }

  private off(i: number) {
    if (this.home[i] >= 0) this.pileOut[this.home[i]]--;
    this.mode[i] = MODE.off;
    this.home[i] = -1;
    this.bitsOut--;
    this.pos.setY(i, OFF);
  }
}
