// The hedge (#323): walls of clipped hedge round the gate side (with the old
// door set into it, built by sceneDoor.ts) and, once the door opens, round the
// orchard too. A solid tiled box per wall (dark in the gaps and low down), and
// all their rows of paper leaves (#1164) as one mesh of flat sheets, cut out
// along their tops.

import * as THREE from "three";
import { hedgeCore, hedgeSheets, SHEET_H, SHEET_W, type HedgeWall, type Sheet } from "./hedge";
import { still, type BuildCtx } from "./sceneSprites";
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

/** Vertex colours from `low` at the bottom to `high` at the top, for a material with vertexColors: darker deep down, where the light does not reach in. */
function shadeUp(geo: THREE.BufferGeometry, low: number, high: number) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox!;
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) colors.fill(low + ((high - low) * (pos.getY(i) - min.y)) / (max.y - min.y), i * 3, i * 3 + 3);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/**
 * `sheets` as one geometry: two triangles each, their `paper` (its size in metres) laid on along each from its `u`, and
 * its `light` as its colour (the sun's light is sceneLight.ts's). The paper's top is at a sheet's top; a sheet taller than its paper carries the paper's
 * bottom row on down (the texture clamps there), so a tall flat is solid below its leaves.
 */
export function sheetGeometry(sheets: Sheet[], paper: { w: number; h: number }): THREE.BufferGeometry {
  const pos = new Float32Array(sheets.length * 12);
  const uv = new Float32Array(sheets.length * 8);
  const color = new Float32Array(sheets.length * 12);
  const index: number[] = [];
  const [bl, along] = [new THREE.Vector3(), new THREE.Vector3()];
  const p = new THREE.Vector3();
  sheets.forEach((s, i) => {
    const [a, b] = s.corners;
    bl.set(...a);
    along.set(...b).sub(bl).normalize();
    s.corners.forEach((c, j) => {
      const v = i * 4 + j;
      pos.set(c, v * 3);
      // Along the sheet as its bottom edge runs, so a sheet that narrows at the top keeps its leaves upright. Down
      // from the top corner above it (the bottom left's is the top left).
      uv.set([(s.u + p.set(...c).sub(bl).dot(along)) / paper.w, j < 2 ? 1 - (s.corners[3 - j][1] - c[1]) / paper.h : 1], v * 2);
      color.fill(s.light, v * 3, v * 3 + 3);
    });
    index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geo.setIndex(index);
  return geo;
}

/** Hedge has nothing to tick, pick or dispose on its own (its meshes are plain scene children): it only builds. */
export class Hedge {
  private coreMat!: THREE.MeshBasicMaterial;
  private sheetMat!: THREE.MeshBasicMaterial;

  /** The hedge materials, shared by every wall addWalls builds: the gate's now, the orchard's later, once the door opens. `sheet`: textures.ts paintHedge. */
  build(ctx: BuildCtx, sheet: THREE.Texture) {
    this.coreMat = ctx.mat(T.paperTexture(T.hedge(), true), "card", { vertexColors: true });
    // Both sides: the sheets along the top are seen from either side.
    this.sheetMat = ctx.mat(sheet, "card", { vertexColors: true, alphaTest: 0.5, alphaToCoverage: ctx.msaa, side: THREE.DoubleSide });
  }

  /**
   * Walls of hedge (hedge.ts). Each solid middle is a box; all their sheets of
   * leaves are one mesh: one draw call. A tap meets a wall's outline (pushed
   * into ctx.hitBoxes as id "hedge"). Called once for the gate's hedge
   * (GardenScene.build) and again, later, for the orchard's, when the door opens.
   */
  addWalls(ctx: BuildCtx, walls: HedgeWall[], seed: number) {
    const sheets: Sheet[] = [];
    walls.forEach((w, i) => {
      const { min, max } = hedgeCore(w);
      const geo = tiledBox(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
      shadeUp(geo, 0.42, 0.66);
      const m = new THREE.Mesh(geo, this.coreMat);
      m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      ctx.scene.add(still(m));
      ctx.hitBoxes.push({ id: "hedge", min: [...w.min], max: [...w.max], tag: null });
      sheets.push(...hedgeSheets(w, seed + i));
    });
    ctx.scene.add(still(new THREE.Mesh(sheetGeometry(sheets, { w: SHEET_W, h: SHEET_H }), this.sheetMat)));
  }
}
