// The lanterns where paths cross (#361): lit at dusk and night, and each one
// blown out or lit again by hand while they are lit. Which are out lasts the
// visit only: the next walk finds them all lit again. Each lantern is one
// instance in a lit and an unlit sprite mesh; the one not shown is drawn at
// scale 0, so a lantern going out costs two attribute writes.

import * as THREE from "three";
import { lanternSpots } from "./world";
import { rayBox, spriteBox, type HitBox, type Ray } from "./scenery";
import type { Conditions } from "./conditions";
import type { Part } from "./scenePart";
import { sprites, type BuildCtx, type SpriteItem } from "./sceneSprites";
import * as T from "./textures";

/** Near enough to a lantern (m, from its post) to blow it out or light it. */
export const LANTERN_REACH = 1.5;

export class Lanterns implements Part {
  /** Where each lantern stands (world.ts lanternSpots), in a fixed order: the moth's lantern is one of these. */
  spots: [number, number][] = [];
  /** Which lanterns are lit when it is dark, by spot. */
  readonly on: boolean[] = [];
  private dark = false;
  private boxes: HitBox[] = [];
  private lit!: THREE.InstancedBufferAttribute;
  private unlit!: THREE.InstancedBufferAttribute;
  /** Each lantern's halo and pool of light on the ground. */
  private glows: [THREE.Object3D, THREE.Object3D][] = [];

  /** Lanterns where paths cross, and two by the door. Draws no random numbers. */
  build(c: BuildCtx) {
    this.spots = lanternSpots(c.L);
    for (const [x, z] of this.spots) {
      const box = spriteBox("lantern", x, 0, z, 0.13, 1.26);
      this.boxes.push(box);
      c.hitBoxes.push(box);
      this.on.push(true);
    }
    const lanternTex = T.pixelTexture(T.lantern());
    const lanternItems = (u: number): SpriteItem[] => this.spots.map(([x, z]) => ({ x, y: 0, z, u, v: 0, uw: 0.5, vh: 1, phase: 0, droop: 0, scale: 1, index: -3 }));
    const unlit = sprites(lanternTex, lanternItems(0), 0.42, 1.26);
    const lit = sprites(lanternTex, lanternItems(0.5), 0.42, 1.26);
    for (const m of [unlit, lit]) {
      c.mats.add(m.material);
      c.scene.add(m);
    }
    this.unlit = unlit.geometry.getAttribute("iParams") as THREE.InstancedBufferAttribute;
    this.lit = lit.geometry.getAttribute("iParams") as THREE.InstancedBufferAttribute;
    const glowTex = T.pixelTexture(T.glow());
    const additive = { map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false } as const;
    for (const [x, z] of this.spots) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ ...additive }));
      halo.scale.set(1.1, 1.1, 1);
      halo.position.set(x, 1.12, z);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ ...additive, opacity: 0.55 }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.06, z);
      this.glows.push([halo, pool]);
      c.scene.add(halo, pool);
    }
  }

  onConditions(c: Conditions) {
    this.dark = c.dark;
    for (let i = 0; i < this.spots.length; i++) this.show(i);
  }

  /** Lit by dark, unless blown out: the lit or the unlit sprite, and the glow. */
  private show(i: number) {
    const lit = this.dark && this.on[i];
    this.lit.setZ(i, lit ? 1 : 0);
    this.unlit.setZ(i, lit ? 0 : 1);
    this.lit.needsUpdate = this.unlit.needsUpdate = true;
    for (const g of this.glows[i]) g.visible = lit;
  }

  /** Blow lantern `i` out, or light it again. Only while they are lit, at dusk and night. */
  toggle(i: number) {
    if (!this.dark) return;
    this.on[i] = !this.on[i];
    this.show(i);
  }

  /** It is dark, and every lantern is out. */
  get allOut(): boolean {
    return this.dark && this.on.every((on) => !on);
  }

  /** The lantern nearest (x, z) in reach while it is dark, or -1. Runs every frame: no allocation. */
  inReach(x: number, z: number): number {
    if (!this.dark) return -1;
    let best = -1;
    let bestD = LANTERN_REACH;
    for (let i = 0; i < this.spots.length; i++) {
      const d = Math.hypot(this.spots[i][0] - x, this.spots[i][1] - z);
      if (d < bestD) [best, bestD] = [i, d];
    }
    return best;
  }

  /** The lantern a ray meets first while it is dark, and how far along the ray. */
  pick(r: Ray): { i: number; t: number } | null {
    if (!this.dark) return null;
    let got = -1;
    let best = Infinity;
    for (let i = 0; i < this.boxes.length; i++) {
      const t = rayBox(r, this.boxes[i].min, this.boxes[i].max);
      if (t < best) [got, best] = [i, t];
    }
    return got < 0 ? null : { i: got, t: best };
  }
}
