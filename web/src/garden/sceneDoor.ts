// The old door in the hedge, and the key that unlocks it (#315, #323). This
// part builds the door's meshes (the frame, the leaf on its hinge, the
// keyhole's light, and the key lying in the garden), swings the leaf open,
// and ticks the key's glint. GardenScene still owns picking the door, acting
// on a tap, and opening it (which reveals the orchard): the door's state
// (locked/key/held/open) is cross-cutting — the tap chain and the quiet line
// it shows live on the host, which also reads `state`/`key`/`leaf` directly.

import * as THREE from "three";
import type { DoorState } from "./scene";
import type { Conditions, Frame } from "./scenePart";
import { FOG_FAR, sprites, type BuildCtx } from "./sceneSprites";
import { DOOR_HALF, HEDGE, keyAt, type KeyHelp, type Layout } from "./world";
import * as T from "./textures";

/** The door's height and thickness, how far it swings open (it swings out, into the orchard), and for how long. */
export const DOOR = { h: 2.05, thick: 0.06, open: Math.PI / 2, swing: 1.4 };
/** The keyhole, from the door's hinge (texture door(): its iron plate's middle). */
const KEYHOLE = { x: -(26 / 32) * DOOR_HALF * 2, y: DOOR.h * (1 - 37 / 64) };
/** Near enough to the door (metres from its middle) to be offered its button. */
export const DOOR_REACH = 2.6;
/** Near enough to the hidden key to be offered "Pick up the key" (m). */
export const KEY_REACH = 2;
/** Facing the key, for its late glint (#334): within this angle of straight ahead (its cosine, about 25°). */
const FACING = Math.cos(0.44);
/**
 * The key's late glint (#334), the help a learner without the dog or the bird
 * gets: on for `on` s in every `every` s, gently pulsing, and as wide as `size`
 * times its distance (never under `min` m), so it stays about 25 px on a phone
 * from anywhere in the garden. Its dark outline keeps it clear on sand and grass.
 */
const LATE = { on: 1.4, every: 3.2, size: 0.045, min: 0.18 };

/**
 * The door in the hedge: "key" means the key is hidden in the garden; "held"
 * means the learner picked it up this walk; only "open" is saved. `leaf` turns
 * on its hinge; `swing` is how far through its swing it is (null: not
 * swinging). `handle`: where its ring handle is, for the glint that shows it
 * can be used (#334). `help`: the world's help for a key left waiting.
 */
export class Door {
  private reducedMotion: boolean;
  state: "locked" | "key" | "held" | "open" = "locked";
  leaf!: THREE.Group;
  keyhole!: { hole: THREE.Mesh; glow: THREE.Sprite };
  key: { mesh: THREE.Mesh; glint: THREE.Sprite; x: number; z: number } | null = null;
  swing: number | null = null;
  handle!: [number, number, number];
  /** The world's help for a key left waiting (#334); null without a key. The scene reads it too. */
  help: KeyHelp | null = null;

  constructor(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
  }

  /**
   * The door frame, its leaf, the keyhole's light, and the key at this
   * learner's hiding place, if its word brought it. Built right after the
   * gate's hedge (GardenScene.buildHedge): nothing here draws random numbers.
   */
  build(c: BuildCtx, L: Layout, doorState: DoorState) {
    const { b, mat, woodTex } = c;
    const gx = L.gate.x;
    const z0 = b.maxZ + HEDGE.gap;
    // A wooden frame round the door, on the garden side.
    const doorTag: [number, number, number] = [gx, DOOR.h + 0.35, z0];
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, DOOR.h + 0.14, 0.2), mat(woodTex));
      post.position.set(gx + s * (DOOR_HALF + 0.06), (DOOR.h + 0.14) / 2, z0);
      c.scene.add(post);
      c.hitBoxes.push({ id: "door", min: [gx + s * (DOOR_HALF + 0.06) - 0.06, 0, z0 - 0.1], max: [gx + s * (DOOR_HALF + 0.06) + 0.06, DOOR.h + 0.14, z0 + 0.1], tag: doorTag });
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(DOOR_HALF * 2 + 0.36, 0.14, 0.22), mat(woodTex));
    beam.position.set(gx, DOOR.h + 0.14, z0);
    c.scene.add(beam);
    c.hitBoxes.push({ id: "door", min: [gx - DOOR_HALF - 0.18, DOOR.h + 0.07, z0 - 0.11], max: [gx + DOOR_HALF + 0.18, DOOR.h + 0.21, z0 + 0.11], tag: doorTag });

    // The door turns on its hinge, at the right as you face it from the garden.
    const leaf = new THREE.Group();
    leaf.position.set(gx + DOOR_HALF, 0, z0 + DOOR.thick / 2 + 0.02);
    const face = mat(T.pixelTexture(T.door()));
    const planks = new THREE.Mesh(new THREE.BoxGeometry(DOOR_HALF * 2, DOOR.h, DOOR.thick), [mat(woodTex), mat(woodTex), mat(woodTex), mat(woodTex), face, face]);
    planks.position.set(-DOOR_HALF, DOOR.h / 2, 0);
    leaf.add(planks);
    // Warm light through the keyhole, the same by day and night (it is not tinted); at dusk and night a soft glow round it too.
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.09), new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false }));
    hole.rotation.y = Math.PI;
    hole.position.set(KEYHOLE.x, KEYHOLE.y, -DOOR.thick / 2 - 0.004);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.pixelTexture(T.glow()), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.set(0.32, 0.32, 1);
    glow.position.set(KEYHOLE.x, KEYHOLE.y, -DOOR.thick / 2 - 0.03);
    leaf.add(hole, glow);
    c.scene.add(leaf);

    // The key, at this learner's hiding place, far from the door: a small find.
    let key: { mesh: THREE.Mesh; glint: THREE.Sprite; x: number; z: number } | null = null;
    if (typeof doorState === "object") {
      const { x, z } = keyAt(L, doorState.key);
      // Lying on the ground, turned a little, as if dropped.
      const mesh = sprites(T.pixelTexture(T.key()), [{ x, y: 0.03, z, u: 0, v: 0, uw: 1, vh: 1, phase: 0, droop: 0.5, scale: 1, index: -7 }], 0.36, 0.13, true);
      c.mats.add(mesh.material);
      c.scene.add(mesh);
      // Late help (#334): after a week it catches the light now and then, whenever you face it (tick). Not tinted or fogged: a glint is bright at
      // dusk too. Drawn over whatever stands in front (a bench leg, a bed): it is the help, so it must not hide.
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.pixelTexture(T.sparkle()), transparent: true, depthTest: false, depthWrite: false, fog: false }));
      glint.renderOrder = 10;
      glint.position.set(x, 0.25, z);
      glint.visible = false;
      c.scene.add(glint);
      key = { mesh, glint, x, z };
    }
    this.state = typeof doorState === "object" ? "key" : doorState;
    this.help = typeof doorState === "object" ? doorState.help : null;
    // The ring handle, just over the keyhole, on the garden side.
    this.handle = [gx + DOOR_HALF + KEYHOLE.x, KEYHOLE.y + 0.12, z0 - 0.05];
    this.leaf = leaf;
    this.keyhole = { hole, glow };
    this.key = key;
  }

  /** Warm light through the keyhole shows at dusk and night, until the door opens for good. */
  onConditions(c: Conditions) {
    this.keyhole.glow.visible = c.dark && this.state !== "open";
  }

  /**
   * The door swings open, slowing as it goes. A key left waiting a week (#334)
   * glints now and then whenever you face it, from as far as you can see; in
   * reach, the scene's own glint shows it instead.
   */
  tick(f: Frame) {
    if (this.swing !== null) {
      this.swing = Math.min(1, this.swing + f.dt / DOOR.swing);
      this.leaf.rotation.y = DOOR.open * (1 - (1 - this.swing) ** 3);
      if (this.swing >= 1) this.swing = null;
    }
    // With reduced motion, a still glint.
    const key = this.state === "key" ? this.key : null;
    if (!key) return;
    const dx = key.x - f.x;
    const dz = key.z - f.z;
    const d = Math.hypot(dx, dz);
    // Forward is -z at yaw 0.
    const facing = (-Math.sin(f.yaw) * dx - Math.cos(f.yaw) * dz) / d > FACING;
    const k = f.elapsed % LATE.every;
    key.glint.visible = !!this.help?.glint && facing && d >= KEY_REACH && d < FOG_FAR && (this.reducedMotion || k < LATE.on);
    const pulse = this.reducedMotion ? 1 : 0.8 + 0.2 * Math.sin((Math.PI * k) / LATE.on);
    key.glint.scale.setScalar(Math.max(LATE.min, LATE.size * d) * pulse);
  }
}
