// The lanterns (lanterns.ts says which are lit): each is one instance in a lit
// and an unlit sprite mesh; the one not shown is drawn at scale 0, so a lantern
// going out costs two attribute writes.

import * as THREE from "three";
import { rayBox, spriteBox, type HitBox, type Ray } from "./scenery";
import type { Part } from "./scenePart";
import type { Lamps } from "./lanterns";
import { sprites, still, type BuildCtx, type SpriteItem } from "./sceneSprites";
import * as T from "./textures";

/** A lantern's sprite (m). */
const LANTERN = { w: 0.42, h: 1.26 };

export class Lanterns implements Part {
  private boxes: HitBox[] = [];
  private lit!: THREE.InstancedBufferAttribute;
  private unlit!: THREE.InstancedBufferAttribute;
  /** Each lantern's halo and pool of light on the ground. */
  private glows: [THREE.Object3D, THREE.Object3D][] = [];

  private lamps: Lamps;

  constructor(lamps: Lamps) {
    this.lamps = lamps;
  }

  /** Draws no random numbers. */
  build(c: BuildCtx) {
    const at = this.lamps.at;
    for (const [x, y, z] of at) {
      const box = spriteBox("lantern", x, y, z, 0.13, 1.26);
      this.boxes.push(box);
      c.hitBoxes.push(box);
    }
    const lanternTex = T.cutoutTexture(T.lantern());
    const lanternItems = (u: number): SpriteItem[] => at.map(([x, y, z]) => ({ x, y, z, u, v: 0, uw: 0.5, vh: 1, phase: 0, droop: 0, scale: 1, index: -3 }));
    const unlit = sprites(lanternTex, lanternItems(0), LANTERN.w, LANTERN.h);
    const lit = sprites(lanternTex, lanternItems(0.5), LANTERN.w, LANTERN.h);
    for (const m of [unlit, lit]) {
      c.mats.add(m.material);
      c.scene.add(still(m));
    }
    this.unlit = unlit.geometry.getAttribute("iParams") as THREE.InstancedBufferAttribute;
    this.lit = lit.geometry.getAttribute("iParams") as THREE.InstancedBufferAttribute;
    const glowTex = T.glowTexture();
    const additive = { map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false } as const;
    for (const [x, y, z] of at) {
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

  /** The time of day changed (lanterns.ts has its dark already): every lantern as it is now. */
  onConditions() {
    for (let i = 0; i < this.lamps.at.length; i++) this.show(i);
  }

  /** Lantern `i` as it is now: the lit or the unlit sprite, and the glow. */
  show(i: number) {
    const lit = this.lamps.lit(i);
    this.lit.setZ(i, lit ? 1 : 0);
    this.unlit.setZ(i, lit ? 0 : 1);
    this.lit.needsUpdate = this.unlit.needsUpdate = true;
    for (const g of this.glows[i]) g.visible = lit;
  }

  /** The lantern a ray meets first while it is dark, and how far along the ray. */
  pick(r: Ray): { i: number; t: number } | null {
    if (!this.lamps.dark) return null;
    let got = -1;
    let best = Infinity;
    for (let i = 0; i < this.boxes.length; i++) {
      const t = rayBox(r, this.boxes[i].min, this.boxes[i].max);
      if (t < best) [got, best] = [i, t];
    }
    return got < 0 ? null : { i: got, t: best };
  }
}
