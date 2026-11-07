// The lanterns where paths cross (#361): lit at dusk and night, and each one
// blown out or lit again by hand while they are lit. Which are out lasts the
// visit only: the next walk finds them all lit again. Each lantern is one
// instance in a lit and an unlit sprite mesh; the one not shown is drawn at
// scale 0, so a lantern going out costs two attribute writes. And the
// lookout's lantern on its post (#683), on the hill past the stile (#722), lifted to the far light across the
// valley: lit by dark, and never blown out.

import * as THREE from "three";
import { lanternSpots } from "./world";
import { rayBox, spriteBox, type HitBox, type Ray } from "./scenery";
import type { Conditions } from "./conditions";
import type { Frame, Part } from "./scenePart";
import { hillY, RAISE_REACH, type Lookout, type LookoutLight } from "./lookout";
import { sprites, still, type BuildCtx, type SpriteItem } from "./sceneSprites";
import * as T from "./textures";

/** Near enough to a lantern (m, from its post) to blow it out or light it. */
export const LANTERN_REACH = 1.5;
/** A lantern's sprite (m), and its head's share of the texture's 48 rows: the glass and its cap, over the post. */
const LANTERN = { w: 0.42, h: 1.26, head: 14 / 48 };
/** How high the lookout's lantern is lifted (m). */
const LIFT_M = 0.45;

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
  /** The lookout's lantern (#683), once the stile stands (#722): where its post stands and how high the hill is at its foot, its head (its uv and place) and halo, and how high it was lifted last frame. */
  private post: [number, number] | null = null;
  private foot = 0;
  private head!: { uv: THREE.InstancedBufferAttribute; pos: THREE.InstancedBufferAttribute; halo: THREE.Sprite };
  private lifted = 0;
  private lookout: LookoutLight;
  private reducedMotion: boolean;

  constructor(lookout: LookoutLight, reducedMotion: boolean) {
    this.lookout = lookout;
    this.reducedMotion = reducedMotion;
  }

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
    for (const [x, z] of this.spots) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ ...additive }));
      halo.scale.set(1.1, 1.1, 1);
      halo.position.set(x, 1.12, z);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ ...additive, opacity: 0.55 }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.06, z);
      this.glows.push([halo, pool]);
      c.scene.add(still(halo), still(pool));
    }
  }

  /**
   * The lookout (#683) on the hill past the stile (#722): the old gardener's
   * stool, and a lantern on a post whose head lifts off it. The head is its own sprite,
   * cut from the lanterns' texture, so it can rise; its halo goes with it.
   */
  buildLookout(c: BuildCtx, at: Lookout) {
    const [px, pz] = at.post;
    this.post = at.post;
    this.foot = hillY(at, px, pz);
    const tex = T.pixelTexture(T.lantern());
    const postH = LANTERN.h * (1 - LANTERN.head);
    // The texture is flipped on upload: v 0 is its bottom row.
    const item = (y: number, v: number, vh: number): SpriteItem[] => [{ x: px, y, z: pz, u: 0, v, uw: 0.5, vh, phase: 0, droop: 0, scale: 1, index: -3 }];
    const post = sprites(tex, item(this.foot, 0, 1 - LANTERN.head), LANTERN.w, postH);
    const head = sprites(tex, item(this.foot + postH, 1 - LANTERN.head, LANTERN.head), LANTERN.w, LANTERN.h * LANTERN.head);
    for (const m of [post, head]) c.mats.add(m.material);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.pixelTexture(T.glow()), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.scale.set(1.1, 1.1, 1);
    halo.position.set(px, this.foot + 1.12, pz);
    this.head = { uv: head.geometry.getAttribute("iUv") as THREE.InstancedBufferAttribute, pos: head.geometry.getAttribute("iPos") as THREE.InstancedBufferAttribute, halo };
    // A three-legged stool, its seat a round of wood.
    const stool = new THREE.Group();
    const wood = c.mat(c.woodTex);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 8), wood);
    seat.position.y = 0.45;
    stool.add(seat);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), wood);
      leg.position.set(Math.cos(a) * 0.12, 0.225, Math.sin(a) * 0.12);
      leg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
      stool.add(leg);
    }
    stool.position.set(at.stool[0], hillY(at, ...at.stool), at.stool[1]);
    stool.rotation.y = 0.5;
    c.scene.add(still(post), head, halo, still(stool));
    this.showHead();
  }

  onConditions(c: Conditions) {
    this.dark = c.dark;
    for (let i = 0; i < this.spots.length; i++) this.show(i);
    if (this.post) this.showHead();
  }

  /** The lookout's lantern: lit by dark, like the rest. */
  private showHead() {
    this.head.uv.setX(0, this.dark ? 0.5 : 0);
    this.head.uv.needsUpdate = true;
    this.head.halo.visible = this.dark;
  }

  /** Near enough to the lookout's lantern to raise it, while it is lit. Runs every frame: no allocation. */
  canRaise(x: number, z: number): boolean {
    return this.dark && !!this.post && Math.hypot(this.post[0] - x, this.post[1] - z) < RAISE_REACH;
  }

  /** The lookout's lantern rises, holds, and comes down (lookout.ts); with reduced motion it stays where it is. */
  tick(f: Frame) {
    if (!this.post || this.reducedMotion) return;
    const lift = this.lookout.lift(f.elapsed) * LIFT_M;
    if (lift === this.lifted) return;
    this.lifted = lift;
    this.head.pos.setY(0, this.foot + LANTERN.h * (1 - LANTERN.head) + lift);
    this.head.pos.needsUpdate = true;
    this.head.halo.position.y = this.foot + 1.12 + lift;
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
