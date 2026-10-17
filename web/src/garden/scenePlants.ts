// The raised beds and the plants in them (#323): the beds themselves, picking
// a plant, the names shown over the nearest ones, a plant perking up when it
// hears its name, and streaming full-size sprites for the plants nearest you
// (loadPlants) so memory stays the same whatever the garden's size.

import * as THREE from "three";
import { petalAt, petalForms, shakeLength, shiver } from "./shake";
import { brush, brushStep, type Brush } from "./walkInto";
import { nearestPlant, NEIGHBOUR, neighbourPerks, PERK, PERK_SCALE, perkEnvelope } from "./whimsy";
import type { Label } from "./scene";
import type { Frame } from "./scenePart";
import { BED_H, BILLBOARD, FOG_FAR, FOG_NEAR, instanced, PLANT_SCALE, plantHeight, SHADE, signBoard, SPRITE_H, SPRITE_W, standingQuad, type BuildCtx } from "./sceneSprites";
import { boardBox } from "./scenery";
import type { Layout, PlacedPlant } from "./world";
import * as T from "./textures";

/** Plants this near you (m) show their names; a tap on one opens its card where you stand, and a tap on one farther away walks to it first (#336). */
export const NAME_NEAR = 3.2;

// Plants: like other sprites (BILLBOARD, SHADE: sceneSprites.ts), but each
// samples its small sprite, or its full-size one once the streamer has put
// it in a pool slot (iCell.y >= 0).
const PLANT_VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iParams; // phase, droop, scale, index
  attribute vec2 iCell; // low cell, high slot (-1: none yet)
  attribute float iLean; // brushed by the walker (#359): radians, springing back to 0
  uniform vec4 uPerk; // plant index, growth; neighbour index, growth
  uniform vec2 uShake; // plant index, lean (#357)
  uniform vec2 uLowSize;
  varying vec2 vLow;
  varying vec2 vHi;
  varying float vHasHi;
  ${BILLBOARD}
  vec2 cellUv(float idx, float cols, vec2 cell, vec2 size) {
    // Half a texel in from the edge, so nearest sampling never reads the neighbour.
    vec2 q = clamp(vec2(uv.x, 1.0 - uv.y), 0.5 / cell, 1.0 - 0.5 / cell);
    float r = floor((idx + 0.5) / cols);
    return (vec2(idx - r * cols, r) * cell + q * cell) / size;
  }
  void main() {
    // A plant that hears its name grows a few percent for a moment.
    float perk = (abs(iParams.w - uPerk.x) < 0.5 ? uPerk.y : 0.0) + (abs(iParams.w - uPerk.z) < 0.5 ? uPerk.w : 0.0);
    // A shaken plant shivers: it leans side to side for a moment (#357). A brushed one leans away and springs back (#359).
    float shake = abs(iParams.w - uShake.x) < 0.5 ? uShake.y : 0.0;
    vec4 mv = billboard(iPos, position.xy * iParams.z * (1.0 + perk), iParams.x, iParams.y + shake + iLean * uSway);
    gl_Position = projectionMatrix * mv;
    vLow = cellUv(iCell.x, ${T.LOW_COLS.toFixed(1)}, vec2(${T.LOW_W.toFixed(1)}, ${T.LOW_H.toFixed(1)}), uLowSize);
    vHasHi = iCell.y >= 0.0 ? 1.0 : 0.0;
    vHi = cellUv(max(iCell.y, 0.0), ${T.HI_COLS.toFixed(1)}, vec2(${T.HI_W.toFixed(1)}, ${T.HI_H.toFixed(1)}), vec2(${T.ATLAS.toFixed(1)}));
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    vSel = abs(iParams.w - uSelected) < 0.5 ? 1.0 : 0.0;
  }
`;

const PLANT_FRAG = /* glsl */ `
  uniform sampler2D uLow;
  uniform sampler2D uHi;
  varying vec2 vLow;
  varying vec2 vHi;
  varying float vHasHi;
  ${SHADE}
  void main() {
    vec4 c = vHasHi > 0.5 ? texture2D(uHi, vHi) : texture2D(uLow, vLow);
    if (c.a < 0.5) discard;
    gl_FragColor = shade(c);
  }
`;

function plantMaterial(low: THREE.Texture, high: THREE.Texture, lowHeight: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLow: { value: low },
      uHi: { value: high },
      uLowSize: { value: new THREE.Vector2(T.ATLAS, lowHeight) },
      uTime: { value: 0 },
      uSway: { value: 1 },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
      uFog: { value: new THREE.Color() },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uSelected: { value: -1 },
      uPerk: { value: new THREE.Vector4(-1, 0, -1, 0) },
      uShake: { value: new THREE.Vector2(-1, 0) },
    },
    vertexShader: PLANT_VERT,
    fragmentShader: PLANT_FRAG,
  });
}

export class Plants {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private layout: Layout;
  private onProgress: (done: number, total: number) => void;
  private behindHedge: (x: number, y: number, z: number) => boolean;
  private disposed = false;

  private chunks: { mesh: THREE.Mesh; center: THREE.Vector3; radius: number }[] = [];
  /** For each plant: the attribute and instance that hold its high-detail slot. */
  private hiRef: { attr: THREE.InstancedBufferAttribute; i: number }[] = [];
  private pool: THREE.DataTexture | null = null;
  private slotOwner = new Int32Array(T.HI_SLOTS).fill(-1);
  private slotOf = new Map<number, number>();
  private streaming = false;
  private hungry = true;
  private lastStream = -1;
  /** Every plant's material, for the perk uniform; also added to ctx.mats for GardenScene's per-frame loop. */
  private plantMats: THREE.ShaderMaterial[] = [];
  /** A plant perking up when it hears its name: its index, when it began, and the neighbour that thought it was called (-1: none). */
  private perk = { i: -1, at: 0, n: -1 };
  /** A shaken plant (#357): its index, when, and the forms falling from it as petals ([]: one leaf). */
  private shook: { i: number; at: number; forms: string[]; still: boolean } | null = null;
  /** Brushing the beds (#359): every plant's lean and spring, and where each plant's lean is drawn (once its bed's mesh is built). */
  private brush: Brush;
  private leanRef: { attr: THREE.InstancedBufferAttribute; i: number }[] = [];
  private onBrush: (p: PlacedPlant) => void;

  /** `onBrush`: the walker brushed past a plant, and its note plays now (at most one a frame). */
  constructor(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    layout: Layout,
    onProgress: (done: number, total: number) => void,
    behindHedge: (x: number, y: number, z: number) => boolean,
    onBrush: (p: PlacedPlant) => void,
  ) {
    this.renderer = renderer;
    this.camera = camera;
    this.layout = layout;
    this.onProgress = onProgress;
    this.behindHedge = behindHedge;
    this.onBrush = onBrush;
    this.brush = brush(layout);
  }

  /** Raised beds: wooden sides, soil on top, and a sign for each. Draws no random numbers. */
  build(c: BuildCtx) {
    const { L, mat, woodTex } = c;
    const soilTex = T.pixelTexture(T.soil(), true);
    for (const bed of L.beds) {
      const side = woodTex.clone();
      side.repeat.set(bed.w / 1.2, 1);
      const sideD = woodTex.clone();
      sideD.repeat.set(bed.d / 1.2, 1);
      const top = soilTex.clone();
      top.repeat.set(bed.w / 1.0, bed.d / 1.0);
      const box = new THREE.Mesh(new THREE.BoxGeometry(bed.w, BED_H, bed.d), [mat(sideD), mat(sideD), mat(top), mat(top), mat(side), mat(side)]);
      box.position.set(bed.x, BED_H / 2, bed.z);
      c.scene.add(box);
      c.hitBoxes.push({ id: "bed", min: [bed.x - bed.w / 2, 0, bed.z - bed.d / 2], max: [bed.x + bed.w / 2, BED_H, bed.z + bed.d / 2], tag: null });
      const signTex = T.pixelTexture(T.sign(bed.label));
      // Just outside the front-left corner, turned toward the path, so it never hides a plant.
      const sx = bed.x - bed.w / 2 - 0.3;
      const sz = bed.z + bed.d / 2 + 0.3;
      const board = signBoard(c, signTex, 0.96, 0.3);
      board.position.set(sx, 0.78, sz);
      board.rotation.y = 0.5;
      c.scene.add(board);
      c.hitBoxes.push(boardBox(sx, sz, 0.96, 0.93, 0.5));
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.66, 0.06), mat(woodTex));
      // Behind the board (it faces the path), never in its plane.
      post.position.set(sx - Math.sin(0.5) * 0.06, 0.33, sz - Math.cos(0.5) * 0.06);
      c.scene.add(post);
    }
  }

  /** Rasterises every plant's sprite and builds one mesh per bed (and sheet), so whole beds can be culled. `ctx` for the shared scene and mats set. */
  async loadPlants(ctx: Pick<BuildCtx, "scene" | "mats">): Promise<void> {
    const plants = this.layout.plants;
    if (!plants.length) return;
    this.onProgress(0, plants.length);
    const sheets = await T.lowSheets(plants);
    if (this.disposed) return;

    // The pool of full-size slots lives only on the GPU: allocate, upload, drop the CPU copy.
    const pool = new THREE.DataTexture(new Uint8Array(T.ATLAS * T.ATLAS * 4), T.ATLAS, T.ATLAS);
    pool.magFilter = pool.minFilter = THREE.NearestFilter;
    pool.generateMipmaps = false;
    pool.needsUpdate = true;
    this.renderer.initTexture(pool);
    (pool.image as { data: Uint8Array | null }).data = null;
    this.pool = pool;

    const mats = sheets.map((c) => {
      const tex = T.pixelTexture(c);
      tex.flipY = false;
      this.renderer.initTexture(tex);
      // Uploaded once; let the canvas go. Nothing re-uploads it (its version does not change).
      (tex as THREE.Texture<unknown>).image = { width: c.width, height: c.height };
      const m = plantMaterial(tex, pool, c.height);
      ctx.mats.add(m);
      this.plantMats.push(m);
      return m;
    });

    // One mesh per bed (and sheet), so whole beds can be culled.
    const groups = new Map<string, number[]>();
    plants.forEach((p, i) => {
      const k = `${p.bed}:${Math.floor(i / T.LOW_PER_SHEET)}`;
      groups.set(k, [...(groups.get(k) ?? []), i]);
    });
    const quad = standingQuad(SPRITE_W, SPRITE_H);
    const baseY = BED_H - (4 / T.VIEW_H) * SPRITE_H * PLANT_SCALE; // the SVG frame has 4 units below the base
    for (const idx of groups.values()) {
      const sheet = Math.floor(idx[0] / T.LOW_PER_SHEET);
      const bed = this.layout.beds[plants[idx[0]].bed];
      const geo = instanced(quad);
      const pos = new Float32Array(idx.length * 3);
      const params = new Float32Array(idx.length * 4);
      const cells = new Float32Array(idx.length * 2);
      idx.forEach((pi, k) => {
        const p = plants[pi];
        pos.set([p.x, baseY, p.z], k * 3);
        params.set([p.phase, p.droop, PLANT_SCALE, pi], k * 4);
        cells.set([pi % T.LOW_PER_SHEET, -1], k * 2);
      });
      const cellAttr = new THREE.InstancedBufferAttribute(cells, 2);
      cellAttr.setUsage(THREE.DynamicDrawUsage);
      const leanAttr = new THREE.InstancedBufferAttribute(new Float32Array(idx.length), 1);
      leanAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("iLean", leanAttr);
      geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(pos, 3));
      geo.setAttribute("iParams", new THREE.InstancedBufferAttribute(params, 4));
      geo.setAttribute("iCell", cellAttr);
      geo.instanceCount = idx.length;
      const center = new THREE.Vector3(bed.x, 0.9, bed.z);
      const radius = Math.hypot(bed.w / 2, bed.d / 2, 1.2) + 0.4;
      geo.boundingSphere = new THREE.Sphere(center, radius);
      const mesh = new THREE.Mesh(geo, mats[sheet]);
      ctx.scene.add(mesh);
      this.chunks.push({ mesh, center, radius });
      idx.forEach((pi, k) => {
        this.hiRef[pi] = { attr: cellAttr, i: k };
        this.leanRef[pi] = { attr: leanAttr, i: k };
      });
    }
    // Not onProgress(done) here: GardenScene.loadPlants calls it after setTime, as main did.
  }

  private setSlot(plant: number, slot: number) {
    const ref = this.hiRef[plant];
    ref.attr.setY(ref.i, slot);
    ref.attr.needsUpdate = true;
  }

  /**
   * Keep full-size sprites for the plants nearest to you (ahead of you
   * first) in the fixed pool, one batch at a time. Memory stays the same
   * whether the garden has 50 plants or 5000.
   */
  private stream(x: number, z: number, yaw: number) {
    const pool = this.pool;
    if (!pool) return;
    const plants = this.layout.plants;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const order = plants.map((p, i) => {
      const dx = p.x - x;
      const dz = p.z - z;
      return { i, d: Math.hypot(dx, dz) * (dx * fx + dz * fz < 0 ? 1.8 : 1) };
    });
    order.sort((a, b) => a.d - b.d);
    const wanted = order.slice(0, T.HI_SLOTS).map((o) => o.i);
    const keep = new Set(wanted);
    for (const [plant, slot] of this.slotOf)
      if (!keep.has(plant)) {
        this.slotOf.delete(plant);
        this.slotOwner[slot] = -1;
        this.setSlot(plant, -1);
      }
    const missing = wanted.filter((i) => !this.slotOf.has(i)).slice(0, T.BATCH);
    this.hungry = missing.length === T.BATCH;
    if (!missing.length) return;
    const slots: number[] = [];
    for (let s = 0; s < T.HI_SLOTS && slots.length < missing.length; s++) if (this.slotOwner[s] === -1) slots.push(s);
    missing.forEach((plant, k) => {
      this.slotOwner[slots[k]] = plant;
      this.slotOf.set(plant, slots[k]);
    });
    // No other batch runs (and so nothing is evicted) until this one is in.
    this.streaming = true;
    const release = () => {
      for (const plant of missing) {
        const slot = this.slotOf.get(plant);
        if (slot === undefined) continue;
        this.slotOf.delete(plant);
        this.slotOwner[slot] = -1;
      }
    };
    T.highBatch(missing.map((i) => plants[i])).then(
      (canvas) => {
        this.streaming = false;
        if (this.disposed) return;
        // A texture that was never uploaded: three copies straight from the canvas into the slot.
        const src = new THREE.Texture(canvas);
        src.flipY = false;
        missing.forEach((plant, k) => {
          const slot = this.slotOf.get(plant)!;
          const c = T.batchCell(k);
          this.renderer.copyTextureToTexture(
            src,
            pool,
            new THREE.Box2(new THREE.Vector2(c.x, c.y), new THREE.Vector2(c.x + T.HI_W, c.y + T.HI_H)),
            new THREE.Vector2((slot % T.HI_COLS) * T.HI_W, Math.floor(slot / T.HI_COLS) * T.HI_H),
          );
          this.setSlot(plant, slot);
        });
      },
      () => {
        this.streaming = false;
        release();
      },
    );
  }

  /** See GardenScene.nod (#60): the public entry point, and what this does. */
  nod(p: PlacedPlant, elapsed: number, reducedMotion: boolean) {
    if (reducedMotion) return;
    const i = this.layout.plants.indexOf(p);
    if (i < 0) return;
    this.perk.i = i;
    this.perk.at = elapsed;
    this.perk.n = neighbourPerks() ? nearestPlant(this.layout.plants, i) : -1;
  }

  /**
   * Shake a plant (#357): it shivers, and its word's other forms fall from it
   * as petals, written on them; a word with no other forms drops one leaf.
   * A new shake ends the last one. With reduced motion it does not shiver,
   * and the petals lie on the soil from the start. Returns the forms that fall.
   */
  shake(p: PlacedPlant, elapsed: number, reducedMotion: boolean): string[] {
    const forms = petalForms(p.lemma, p.forms);
    this.shook = { i: this.layout.plants.indexOf(p), at: elapsed, forms, still: reducedMotion };
    return forms;
  }

  /** The shaken plant's shiver; the shake ends once its last petal has faded. No allocations: it runs every frame. */
  private tickShake(elapsed: number) {
    const k = this.shook;
    if (!k) return;
    const t = elapsed - k.at;
    const done = t > shakeLength(k.forms.length);
    const lean = done || k.still ? 0 : shiver(t);
    for (const m of this.plantMats) m.uniforms.uShake.value.set(done ? -1 : k.i, lean);
    if (done) this.shook = null;
  }

  /** The falling petals, as labels in screen fractions, for the shake under way (#357). */
  petals(elapsed: number, v: THREE.Vector3): Label[] {
    const k = this.shook;
    if (!k) return [];
    const p = this.layout.plants[k.i];
    const top = BED_H + plantHeight(p.growth);
    const t = elapsed - k.at;
    const out: Label[] = [];
    // No forms: one leaf, with no word on it.
    const texts = k.forms.length ? k.forms : [""];
    texts.forEach((text, i) => {
      const at = petalAt(p.id, i, t, top - BED_H, k.still);
      if (!at) return;
      v.set(p.x + at.dx, top + at.dy, p.z + at.dz).project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return;
      out.push({ id: `petal:${i}`, text, kind: "petal", x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: at.alpha });
    });
    return out;
  }

  /** Grows the perking plants a little, then lets them settle. No allocations: it runs every frame. */
  private tickPerk(elapsed: number) {
    const k = this.perk;
    if (k.i < 0) return;
    const t = elapsed - k.at;
    const done = t > Math.max(PERK.rise + PERK.fall, NEIGHBOUR.delay + NEIGHBOUR.rise + NEIGHBOUR.fall);
    const a = done ? 0 : perkEnvelope(t, PERK.rise, PERK.fall) * PERK_SCALE;
    const b = done || k.n < 0 ? 0 : perkEnvelope(t - NEIGHBOUR.delay, NEIGHBOUR.rise, NEIGHBOUR.fall) * PERK_SCALE;
    for (const m of this.plantMats) m.uniforms.uPerk.value.set(done ? -1 : k.i, a, done ? -1 : k.n, b);
    if (done) k.i = -1;
  }

  /** Chunk culling (beds outside the fog are skipped), streaming the plants nearest you, the perk uniform, and brushing. */
  tick(f: Frame) {
    const { elapsed, x, z, yaw } = f;
    for (const c of this.chunks) c.mesh.visible = c.center.distanceTo(this.camera.position) - c.radius < FOG_FAR;
    if (this.pool && !this.streaming && (this.hungry || elapsed - this.lastStream > 0.25)) {
      this.lastStream = elapsed;
      this.stream(x, z, yaw);
    }
    this.tickPerk(elapsed);
    this.tickShake(elapsed);
    this.tickBrush(f);
  }

  /** Brushing the beds (#359): plants you walk right past lean away and spring back, and one plays its note. No allocations. */
  private tickBrush(f: Frame) {
    const b = this.brush;
    const note = brushStep(b, this.layout, f);
    for (let k = 0; k < b.changed; k++) {
      const i = b.dirty[k];
      // Before loadPlants has built the beds' meshes there is nothing to draw the lean on yet.
      const ref = this.leanRef[i];
      if (!ref) continue;
      ref.attr.setX(ref.i, b.lean[i]);
      ref.attr.needsUpdate = true;
    }
    if (note >= 0) this.onBrush(this.layout.plants[note]);
  }

  /** Select the plant under a point on the canvas (CSS pixels), if any. */
  pick(cssX: number, cssY: number, cssW: number, cssH: number): PlacedPlant | null {
    const nx = (cssX / cssW) * 2 - 1;
    const ny = -(cssY / cssH) * 2 + 1;
    const v = new THREE.Vector3();
    let best: PlacedPlant | null = null;
    let bestDepth = Infinity;
    const halfH = Math.tan((this.camera.fov * Math.PI) / 360);
    const halfW = halfH * this.camera.aspect;
    for (const p of this.layout.plants) {
      const h = plantHeight(p.growth);
      v.set(p.x, BED_H + h * 0.55, p.z).applyMatrix4(this.camera.matrixWorldInverse);
      const depth = -v.z;
      if (depth < 0.2 || depth > 30) continue;
      const sx = v.x / depth / halfW;
      const sy = v.y / depth / halfH;
      // Hit box: a bit wider than the stem, as tall as the plant.
      const rw = Math.max(0.03, 0.22 / depth / halfW);
      const rh = Math.max(0.04, (h * 0.6) / depth / halfH);
      // From the orchard (#315), the hedge hides the garden: a tap on it picks no plant behind it.
      if (Math.abs(nx - sx) < rw && Math.abs(ny - sy) < rh && depth < bestDepth && !this.behindHedge(p.x, BED_H + h * 0.55, p.z)) {
        best = p;
        bestDepth = depth;
      }
    }
    return best;
  }

  /** Names over the nearest plants, as DOM text so they stay crisp and readable (GardenScene.labels appends the rest). */
  labelsNear(x: number, z: number, v: THREE.Vector3): Label[] {
    const near: { p: PlacedPlant; d: number }[] = [];
    for (const p of this.layout.plants) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < NAME_NEAR) near.push({ p, d });
    }
    near.sort((a, b) => a.d - b.d);
    const out: Label[] = [];
    for (const { p, d } of near.slice(0, 10)) {
      v.set(p.x, BED_H + plantHeight(p.growth) + 0.12, p.z).project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      out.push({ id: p.id, text: p.lemma, gender: p.gender, x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: 1 - d / NAME_NEAR });
    }
    return out;
  }

  dispose() {
    this.disposed = true;
  }
}
