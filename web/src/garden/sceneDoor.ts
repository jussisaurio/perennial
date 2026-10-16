// The old door in the hedge, and the key that unlocks it (#315, #323). This
// part only builds the door's meshes (the frame, the leaf on its hinge, the
// keyhole's light, and the key lying in the garden). GardenScene still owns
// picking it, acting on a tap and ticking its swing and glint: the door's
// state (locked/key/held/open) is cross-cutting — the tap chain, the quiet
// line it shows and the orchard it reveals all live on the host.

import * as THREE from "three";
import { sprites, type BuildCtx, type DoorAction, type DoorState } from "./scene";
import { DOOR_HALF, HEDGE, keyAt, type Layout } from "./world";
import * as T from "./textures";

/** The door's height and thickness, how far it swings open (it swings out, into the orchard), and for how long. */
export const DOOR = { h: 2.05, thick: 0.06, open: Math.PI / 2, swing: 1.4 };
/** The keyhole, from the door's hinge (texture door(): its iron plate's middle). */
export const KEYHOLE = { x: -(26 / 32) * DOOR_HALF * 2, y: DOOR.h * (1 - 37 / 64) };
/** Near enough to the door (metres from its middle) to be offered its button. */
export const DOOR_REACH = 2.6;
/** Near enough to the hidden key to be offered "Pick up the key" (m). */
export const KEY_REACH = 2;
/** The key's glint: seen from this near (m), a flash this long (s) this often (s). Nothing calls to the learner from across the garden. */
export const GLINT = { near: 7, flash: 0.5, every: 3.2 };

/**
 * The door in the hedge: "key" means the key is hidden in the garden; "held"
 * means the learner picked it up this walk; only "open" is saved. `leaf` turns
 * on its hinge; `swing` is how far through its swing it is (null: not
 * swinging); `near` is what the viewer was last offered (GardenScene.reportDoor).
 */
export class Door {
  state: "locked" | "key" | "held" | "open" = "locked";
  leaf!: THREE.Group;
  keyhole!: { hole: THREE.Mesh; glow: THREE.Sprite };
  key: { mesh: THREE.Mesh; glint: THREE.Sprite; x: number; z: number } | null = null;
  swing: number | null = null;
  near: DoorAction | null = null;

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
      // It catches the light now and then (GardenScene.tick), only when you are near. Not tinted: a glint is bright at dusk too.
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.pixelTexture(T.glint()), transparent: true, depthWrite: false, fog: false }));
      glint.position.set(x + 0.08, 0.1, z);
      glint.visible = false;
      c.scene.add(glint);
      key = { mesh, glint, x, z };
    }
    this.state = typeof doorState === "object" ? "key" : doorState;
    this.leaf = leaf;
    this.keyhole = { hole, glow };
    this.key = key;
  }
}
