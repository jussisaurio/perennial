// The lanterns where paths cross (#361): lit at dusk and night, and each one
// blown out or lit again by hand while they are lit. Which are out lasts the
// visit only: the next walk finds them all lit again. Each lantern is one
// instance in a lit and an unlit sprite mesh; the one not shown is drawn at
// scale 0, so a lantern going out costs two attribute writes. The lookout's
// lantern on its post (#683), on the hill past the stile (#722), is one more,
// the last: the same lantern, blown out and lit the same way (#858).

import * as THREE from "three";
import { REACH_SLACK } from "./reach";
import { lanternSpots } from "./world";
import { rayBox, spriteBox, type HitBox, type Ray } from "./scenery";
import type { Conditions } from "./conditions";
import type { Part } from "./scenePart";
import { hillY, type Lookout } from "./lookout";
import { sprites, still, type BuildCtx, type SpriteItem } from "./sceneSprites";
import * as T from "./textures";

/** Near enough to a lantern (m, from its post) to blow it out or light it. */
export const LANTERN_REACH = 1.5;
/** A lantern's sprite (m). */
const LANTERN = { w: 0.42, h: 1.26 };

export class Lanterns implements Part {
  /** Where each lantern in the garden stands (world.ts lanternSpots), in a fixed order: the moth's lantern is one of these. */
  spots: [number, number][] = [];
  /** The lookout's lantern, by its index after the garden's, or -1 while there is none. */
  lookout = -1;
  /** Which lanterns are lit when it is dark, by index: the garden's, then the lookout's. */
  readonly on: boolean[] = [];
  private dark = false;
  /** Where each lantern stands, by index: [x, y, z]. */
  private at: [number, number, number][] = [];
  private boxes: HitBox[] = [];
  private lit!: THREE.InstancedBufferAttribute;
  private unlit!: THREE.InstancedBufferAttribute;
  /** Each lantern's halo and pool of light on the ground. */
  private glows: [THREE.Object3D, THREE.Object3D][] = [];

  /** Lanterns where paths cross, two by the door, and the lookout's on the hill (`hill`: null while there is no stile). Draws no random numbers. */
  build(c: BuildCtx, hill: Lookout | null) {
    this.spots = lanternSpots(c.L);
    this.at = this.spots.map(([x, z]) => [x, 0, z]);
    if (hill) {
      this.lookout = this.at.length;
      this.at.push([hill.post[0], hillY(hill, ...hill.post), hill.post[1]]);
    }
    for (const [x, y, z] of this.at) {
      const box = spriteBox("lantern", x, y, z, 0.13, 1.26);
      this.boxes.push(box);
      c.hitBoxes.push(box);
      this.on.push(true);
    }
    const lanternTex = T.pixelTexture(T.lantern());
    const lanternItems = (u: number): SpriteItem[] => this.at.map(([x, y, z]) => ({ x, y, z, u, v: 0, uw: 0.5, vh: 1, phase: 0, droop: 0, scale: 1, index: -3 }));
    const unlit = sprites(lanternTex, lanternItems(0), LANTERN.w, LANTERN.h);
    const lit = sprites(lanternTex, lanternItems(0.5), LANTERN.w, LANTERN.h);
    for (const m of [unlit, lit]) {
      c.mats.add(m.material);
      c.scene.add(still(m));
    }
    this.unlit = unlit.geometry.getAttribute("iParams") as THREE.InstancedBufferAttribute;
    this.lit = lit.geometry.getAttribute("iParams") as THREE.InstancedBufferAttribute;
    const glowTex = T.pixelTexture(T.glow());
    const additive = { map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false } as const;
    for (const [x, y, z] of this.at) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ ...additive }));
      halo.scale.set(1.1, 1.1, 1);
      halo.position.set(x, y + 1.12, z);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ ...additive, opacity: 0.55 }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, y + 0.06, z);
      this.glows.push([halo, pool]);
      c.scene.add(still(halo), still(pool));
    }
  }

  onConditions(c: Conditions) {
    this.dark = c.dark;
    for (let i = 0; i < this.at.length; i++) this.show(i);
  }

  /** Lit by dark, unless blown out: the lit or the unlit sprite, and the glow. */
  private show(i: number) {
    const lit = this.dark && this.on[i];
    this.lit.setZ(i, lit ? 1 : 0);
    this.unlit.setZ(i, lit ? 0 : 1);
    this.lit.needsUpdate = this.unlit.needsUpdate = true;
    for (const g of this.glows[i]) g.visible = lit;
  }

  /** Blow lantern `i` out, or light it again. Only while they are lit, at dusk and night: is it lit again now? */
  toggle(i: number): boolean {
    if (!this.dark) return false;
    this.on[i] = !this.on[i];
    this.show(i);
    return this.on[i];
  }

  /** Where lantern `i` stands: [x, z]. */
  spot(i: number): [number, number] {
    return [this.at[i][0], this.at[i][2]];
  }

  /** It is dark, and every lantern in the garden is out. */
  get allOut(): boolean {
    return this.dark && this.on.every((on, i) => i === this.lookout || !on);
  }

  /** The lookout's lantern while they are lit, at dusk and night, or -1. */
  get lookoutLamp(): number {
    return this.dark ? this.lookout : -1;
  }

  /** The lantern nearest (x, z) in reach while it is dark, or -1; the one the button shows now (`held`) stays in reach REACH_SLACK farther (#838). Runs every frame: no allocation. */
  inReach(x: number, z: number, held: number): number {
    if (!this.dark) return -1;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.at.length; i++) {
      const d = Math.hypot(this.at[i][0] - x, this.at[i][2] - z);
      if (d < bestD && d < LANTERN_REACH + (i === held ? REACH_SLACK : 0)) [best, bestD] = [i, d];
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
