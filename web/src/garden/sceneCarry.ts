// The pebbles by the pond, the rings a splash makes, and the orchard's well
// (#335 S6) once the door is open, drawn from carry.ts Pebbles (which says
// what happens). A Part: one instanced sprite mesh for the things and the well,
// one for the rings.

import * as THREE from "three";
import type { CarryTarget, Pebble, Pebbles } from "./carry";
import { rayBox, type Ray } from "./scenery";
import type { Frame, Part } from "./scenePart";
import { sprites } from "./sceneSprites";
import * as T from "./textures";
import type { Layout } from "./world";

/** Metres per atlas cell, and a pebble's size in cells. */
const SIZE = 0.5;
const SCALE = 1.1;
/** The well's cell is 1.4 m: its stones as wide as its ring (orchard.ts WELL_R), its roof a little over the eye. */
const WELL_SCALE = 2.8;
/** The rings spread for this long (s), from this size to this much bigger (m). */
const RIPPLE = { s: 1.1, size: 1.2, grow: 0.8 };

/** A thing's drawn size: none while you hold it. */
const shown = (t: Pebble) => (t.at === "held" ? 0 : SCALE);

export class Carry implements Part {
  /** Their own materials: tinted with the time of day, never swaying in the wind (GardenScene.tint). */
  readonly mats = new Set<THREE.ShaderMaterial>();
  /** Everything this builds hangs under one group, which the scene adds once. */
  readonly root = new THREE.Group();
  /** The well's instance follows the things'. */
  private wellAt = 0;
  private wellShown = false;
  /** Each thing as last drawn (x, y, z, size), so a still frame uploads nothing. */
  private drawn: Float64Array;
  private pos!: THREE.InstancedBufferAttribute;
  private params!: THREE.InstancedBufferAttribute;
  private ring!: { pos: THREE.InstancedBufferAttribute; uv: THREE.InstancedBufferAttribute; params: THREE.InstancedBufferAttribute; t: number; n: number };

  private layout: Layout;
  private reducedMotion: boolean;
  private pebbles: Pebbles;

  constructor(layout: Layout, reducedMotion: boolean, pebbles: Pebbles) {
    this.layout = layout;
    this.reducedMotion = reducedMotion;
    this.pebbles = pebbles;
    this.drawn = new Float64Array(pebbles.things.length * 4);
  }

  /** The loose things and the well (unseen until the door opens), in one instanced mesh; the rings, lying on the water. Draws no random numbers. */
  build() {
    const tex = T.pixelTexture(T.carryAtlas());
    const cell = (c: number) => c / T.CARRY_CELLS;
    const items = this.pebbles.things.map((t) => ({ x: t.x, y: t.y, z: t.z, u: cell(T.CARRY_CELL.pebble), v: 0, uw: 1 / T.CARRY_CELLS, vh: 1, phase: 0, droop: 0, scale: shown(t), index: -8 }));
    const w = this.layout.well;
    this.wellAt = items.length;
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
    this.ring = { pos: g.getAttribute("iPos") as THREE.InstancedBufferAttribute, uv: g.getAttribute("iUv") as THREE.InstancedBufferAttribute, params: g.getAttribute("iParams") as THREE.InstancedBufferAttribute, t: Infinity, n: 0 };
    this.pebbles.things.forEach((t, i) => this.drawn.set([t.x, t.y, t.z, shown(t)], i * 4));
  }

  /** The loose thing a ray meets, and how far along it: only what lies free. */
  pick(r: Ray): { target: CarryTarget; t: number } | null {
    let best: { target: CarryTarget; t: number } | null = null;
    this.pebbles.things.forEach((th, i) => {
      if (th.at !== "rest") return;
      // Generous: a pebble is a few pixels wide, and a finger is not.
      const half = 0.12 * SCALE;
      const t = rayBox(r, [th.x - half, th.y, th.z - half], [th.x + half, th.y + 0.18, th.z + half]);
      if (t < (best?.t ?? Infinity)) best = { target: this.pebbles.thing(i), t };
    });
    return best;
  }

  /** How far along the ray the well is, while you hold a pebble and the door is open; Infinity otherwise. */
  pickWell(r: Ray): number {
    if (this.pebbles.held === null || !this.pebbles.wellShown) return Infinity;
    const w = this.layout.well;
    return rayBox(r, [w.x - w.r, 0, w.z - w.r], [w.x + w.r, 1.2, w.z + w.r]);
  }

  /** Each thing where it is now (hidden while you hold it), the well once it stands, and the rings. Allocates nothing. */
  tick(f: Frame) {
    const p = this.pebbles;
    const d = this.drawn;
    for (let i = 0; i < p.things.length; i++) {
      const t = p.things[i];
      const s = shown(t);
      const k = i * 4;
      if (d[k] === t.x && d[k + 1] === t.y && d[k + 2] === t.z && d[k + 3] === s) continue;
      d[k] = t.x;
      d[k + 1] = t.y;
      d[k + 2] = t.z;
      d[k + 3] = s;
      this.pos.setXYZ(i, t.x, t.y, t.z);
      this.params.setZ(i, s);
      this.pos.needsUpdate = this.params.needsUpdate = true;
    }
    if (p.wellShown !== this.wellShown) {
      this.wellShown = p.wellShown;
      this.params.setZ(this.wellAt, WELL_SCALE);
      this.params.needsUpdate = true;
    }
    const ring = this.ring;
    if (p.ripple.n !== ring.n) {
      ring.n = p.ripple.n;
      ring.t = 0;
      ring.pos.setXYZ(0, p.ripple.x, 0.05, p.ripple.z);
      ring.pos.needsUpdate = true;
    }
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
