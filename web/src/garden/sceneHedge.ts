// The hedge (#323): walls of clipped hedge round the gate side (with the old
// door set into it, built by sceneDoor.ts) and, once the door opens, round the
// orchard too. Its own rendering technique: a solid tiled box per wall (dark
// in the gaps and low down) plus one InstancedMesh of every wall's leaf
// clumps, so the whole hedge is two draw calls however many walls it has.

import * as THREE from "three";
import { hedgeClumps, hedgeCore, type Clump, type HedgeWall } from "./hedge";
import type { BuildCtx } from "./sceneSprites";
import * as T from "./textures";

/** A box whose repeating texture shows one tile per `tile` metres on every face (a plain box stretches the texture to each face). */
function tiledBox(w: number, h: number, d: number, tile: number): THREE.BoxGeometry {
  const box = new THREE.BoxGeometry(w, h, d);
  const uv = box.getAttribute("uv") as THREE.BufferAttribute;
  // Faces +x, -x, +y, -y, +z, -z, with four corners each: each face's width and height in metres.
  const sizes = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  sizes.forEach(([fw, fh], f) => {
    for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, (uv.getX(i) * fw) / tile, (uv.getY(i) * fh) / tile);
  });
  return box;
}

/** Vertex colours from `low` at the bottom to `high` at the top, for an unlit material with vertexColors: shading without lights. */
function shadeUp(geo: THREE.BufferGeometry, low: number, high: number) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox!;
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) colors.fill(low + ((high - low) * (pos.getY(i) - min.y)) / (max.y - min.y), i * 3, i * 3 + 3);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/** Hedge has nothing to tick, pick or dispose on its own (its meshes are plain scene children): it only builds. */
export class Hedge {
  private mat!: THREE.MeshBasicMaterial;

  /** The hedge material, shared by every wall addWalls builds: the gate's now, the orchard's later, once the door opens. */
  build(ctx: BuildCtx) {
    this.mat = ctx.mat(T.pixelTexture(T.hedge(), true), { vertexColors: true });
  }

  /**
   * Walls of hedge (hedge.ts). Each solid middle is a box; all their leaf
   * clumps are one instanced mesh: one draw call. A tap meets a wall's
   * outline (pushed into ctx.hitBoxes as id "hedge"). Called once for the
   * gate's hedge (GardenScene.build) and again, later, for the orchard's,
   * when the door opens.
   */
  addWalls(ctx: BuildCtx, walls: HedgeWall[], seed: number) {
    const clumps: Clump[] = [];
    walls.forEach((w, i) => {
      const { min, max } = hedgeCore(w);
      const geo = tiledBox(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
      shadeUp(geo, 0.42, 0.66);
      const m = new THREE.Mesh(geo, this.mat);
      m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      ctx.scene.add(m);
      ctx.hitBoxes.push({ id: "hedge", min: [...w.min], max: [...w.max], tag: null });
      clumps.push(...hedgeClumps(w, seed + i));
    });
    // A rounded clump, lit from above: its underside darker.
    const clump = new THREE.IcosahedronGeometry(1, 1);
    shadeUp(clump, 0.66, 1);
    // About as many leaves to the metre as on the solid middle.
    const uv = clump.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.4, uv.getY(i) * 1.2);
    const mesh = new THREE.InstancedMesh(clump, this.mat, clumps.length);
    const m4 = new THREE.Matrix4();
    const color = new THREE.Color();
    clumps.forEach((c, i) => {
      mesh.setMatrixAt(i, m4.makeScale(...c.r).setPosition(...c.at));
      mesh.setColorAt(i, color.setScalar(c.shade));
    });
    ctx.scene.add(mesh);
  }
}
