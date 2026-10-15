// The old orchard in the walk (#315): the trees (orchard.ts says where and how
// big) as one instanced sprite mesh, and the bench with the first word's date.
// The garden scene builds it once the door is open; nothing exists before.

import * as THREE from "three";
import { ORCHARD_WORDS } from "../deck/schema";
import { orchardBench, placeTrees, SPRITE_M, treeHits, type OrchardArea, type OrchardTree, type PlacedTree, type TreeHit } from "./orchard";
import { CELL_H_PX, LOOKS, orchardAtlas } from "./orchardArt";
import type { HitBox } from "./scenery";
import * as T from "./textures";

/** One sprite instance, as the scene's sprite helper takes it (scene.ts sprites()). */
export interface OrchardSpriteItem {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  uw: number;
  vh: number;
  phase: number;
  droop: number;
  scale: number;
  index: number;
}

/** What the orchard needs from the garden scene. */
export interface OrchardWorld {
  /** Where the orchard goes: the scene, or a group in it. */
  parent: THREE.Object3D;
  /**
   * The scene's instanced, camera-facing sprites (scene.ts sprites()). The scene
   * keeps their material's time, tint, fog and sway; with reduced motion it sets
   * uSway to 0, so the trees stand still. Nothing else in the orchard moves.
   */
  sprites: (map: THREE.Texture, items: OrchardSpriteItem[], w: number, h: number) => THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** An unlit material that follows the time of day (scene.ts BuildCtx.mat). */
  mat: (tex: THREE.Texture) => THREE.MeshBasicMaterial;
  woodTex: THREE.Texture;
  /** The bench's plaque: benchLine(first word's planting time). */
  bench: string;
}

export interface Orchard {
  /** The trees where they stand, for visitors (treeVisitorSpots) and walking (collideTrees). */
  trees: PlacedTree[];
  /** Tap targets: each tree shows its word (pickTree). */
  hits: TreeHit[];
  /** Scenery the tap can name: the bench. */
  scenery: HitBox[];
  /** The trees' sprite material, for the scene's per-frame uniforms. */
  mats: THREE.ShaderMaterial[];
  dispose(): void;
}

/** Sprite index for the trees: never the selected plant's. */
const TREE_INDEX = -7;

export function buildOrchard(world: OrchardWorld, area: OrchardArea, trees: OrchardTree[]): Orchard {
  const group = new THREE.Group();
  const placed = placeTrees(area, trees);
  const atlas = T.pixelTexture(orchardAtlas(ORCHARD_WORDS));
  const own: THREE.Texture[] = [atlas];
  // Half a texel in from the cell's top and bottom, so nearest sampling never reads the row above or below.
  const inset = 0.5 / (CELL_H_PX * LOOKS.length);
  const items: OrchardSpriteItem[] = placed.map((t) => ({
    x: t.x,
    y: 0,
    z: t.z,
    u: ORCHARD_WORDS.indexOf(t.kind) / ORCHARD_WORDS.length,
    // Canvas textures flip: the atlas's top row is at the top of v.
    v: (LOOKS.length - 1 - LOOKS.indexOf(t.look)) / LOOKS.length + inset,
    uw: 1 / ORCHARD_WORDS.length,
    vh: 1 / LOOKS.length - 2 * inset,
    phase: t.phase,
    droop: 0,
    scale: t.scale,
    index: TREE_INDEX,
  }));
  const mats: THREE.ShaderMaterial[] = [];
  if (items.length) {
    const mesh = world.sprites(atlas, items, SPRITE_M.w, SPRITE_M.h);
    mats.push(mesh.material);
    group.add(mesh);
  }

  // The bench: the same planks as the one by the pond, with a plaque on the back of its seat, read as you come in.
  const b = orchardBench(area);
  const bench = new THREE.Group();
  const plank = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), world.mat(world.woodTex));
    m.position.set(x, y, z);
    bench.add(m);
  };
  plank(1.3, 0.06, 0.4, 0, 0.42, 0);
  plank(1.3, 0.28, 0.05, 0, 0.66, -0.2);
  for (const sx of [-0.55, 0.55]) for (const sz of [-0.15, 0.15]) plank(0.06, 0.42, 0.06, sx, 0.21, sz);
  const plaqueTex = T.pixelTexture(T.notice(world.bench));
  own.push(plaqueTex);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.28), world.mat(plaqueTex));
  // Just behind the back rest, facing away from the seat.
  plaque.position.set(0, 0.66, -0.235);
  plaque.rotation.y = Math.PI;
  bench.add(plaque);
  bench.position.set(b.x, 0, b.z);
  bench.rotation.y = b.turn;
  group.add(bench);
  const scenery: HitBox[] = [{ id: "bench", min: [b.x - 0.68, 0, b.z - 0.25], max: [b.x + 0.68, 0.8, b.z + 0.25], tag: [b.x, 0.88, b.z], turn: b.turn }];

  world.parent.add(group);
  return {
    trees: placed,
    hits: treeHits(placed),
    scenery,
    mats,
    dispose() {
      world.parent.remove(group);
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        for (const m of [o.material].flat()) m.dispose();
      });
      // The wood is the scene's; these two are the orchard's own.
      for (const t of own) t.dispose();
    },
  };
}
