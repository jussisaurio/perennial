// The raised beds and the plants in them (#323): the beds themselves, picking
// a plant, the names shown over the nearest ones, a plant perking up when it
// hears its name, and streaming full-size sprites for the plants nearest you
// (loadPlants) so memory stays the same whatever the garden's size.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { NAME_NEAR, petalAt, shakeLength, shiver } from "./shake";
import { brush, brushStep, type Brush } from "./walkInto";
import { nearestPlant, NEIGHBOUR, neighbourPerks, PERK, PERK_SCALE, perkEnvelope, SNEEZE } from "./whimsy";
import type { Label } from "./scene";
import type { Conditions } from "./conditions";
import type { Frame } from "./scenePart";
import { isOld } from "./plants";
import { BILLBOARD, FOG_FAR, FOG_NEAR, instanced, PLANT_SCALE, plantHeight, SHADE, SPRITE_H, SPRITE_W, standingQuad, still, type BuildCtx } from "./sceneSprites";
import { boardBox } from "./scenery";
import { BED_H, bedSign, type Layout, type PlacedPlant } from "./world";
import * as T from "./textures";

/** The plant the action button shakes stands this much taller (#689): a steady mark, like a note lifting off the wall, never a flash. */
const READY_GROW = 0.08;
/** It grows to that over this long (s), and settles back as slowly. In one frame, it read as a fault: the plants jumped taller as you came near (#1109). */
const READY_TIME = 0.4;

// Plants: like other sprites (BILLBOARD, SHADE: sceneSprites.ts), but each
// samples its small sprite, or its full-size one once the streamer has put
// it in a pool slot (iCell.y >= 0).
const PLANT_VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iParams; // phase, droop, scale, index
  attribute vec2 iCell; // low cell, high slot (-1: none yet)
  attribute float iLean; // brushed by the walker (#359): radians, springing back to 0
  attribute float iOld; // 1: an old friend (plants.ts isOld)
  attribute float iReady; // how far it stands taller for the action button (#689): 0 to 1, eased
  uniform vec4 uPerk; // plant index, growth; neighbour index, growth
  uniform vec2 uShake; // plant index, lean (#357)
  uniform vec2 uSneeze; // plant index, squash (#360)
  uniform vec2 uLowSize;
  uniform vec2 uHiSize;
  uniform float uSilver;
  varying vec2 vLow;
  varying vec2 vHi;
  varying float vHasHi;
  varying float vSilver;
  ${BILLBOARD}
  vec2 cellUv(float idx, float cols, vec2 cell, vec2 size) {
    // Half a texel in from the edge, so filtering never reads the neighbour.
    vec2 q = clamp(vec2(uv.x, 1.0 - uv.y), 0.5 / cell, 1.0 - 0.5 / cell);
    float r = floor((idx + 0.5) / cols);
    return (vec2(idx - r * cols, r) * cell + q * cell) / size;
  }
  void main() {
    // A plant that hears its name grows a few percent for a moment.
    float perk = (abs(iParams.w - uPerk.x) < 0.5 ? uPerk.y : 0.0) + (abs(iParams.w - uPerk.z) < 0.5 ? uPerk.w : 0.0);
    // The plant the action button shakes stands a little taller, for as long as it is the one.
    float ready = iReady * ${READY_GROW.toFixed(2)};
    // A shaken plant shivers: it leans side to side for a moment (#357). A brushed one leans away and springs back (#359).
    float shake = abs(iParams.w - uShake.x) < 0.5 ? uShake.y : 0.0;
    // A plant a dandelion seed lands on sneezes (#360): squashed down and out for a moment.
    float sq = abs(iParams.w - uSneeze.x) < 0.5 ? uSneeze.y : 0.0;
    vec4 mv = billboard(iPos, position.xy * iParams.z * (1.0 + perk + ready) * vec2(1.0 + sq * 0.6, 1.0 - sq), iParams.x, iParams.y + shake + iLean * uSway);
    gl_Position = projectionMatrix * mv;
    vLow = cellUv(iCell.x, ${T.LOW_COLS.toFixed(1)}, vec2(${T.LOW_W.toFixed(1)}, ${T.LOW_H.toFixed(1)}), uLowSize);
    vHasHi = iCell.y >= 0.0 ? 1.0 : 0.0;
    vHi = cellUv(max(iCell.y, 0.0), ${T.HI_COLS.toFixed(1)}, vec2(${T.HI_W.toFixed(1)}, ${T.HI_H.toFixed(1)}), uHiSize);
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    vSel = abs(iParams.w - uSelected) < 0.5 ? 1.0 : 0.0;
    vSilver = uSilver * iOld;
  }
`;

// The sprites are premultiplied and filtered smooth (#1091): a plant's edge is
// where its alpha crosses one half, so it stays clean however close you stand.
// On a full moon's night (#361), an old friend's outer pixels (those next to an
// empty one) turn a faint silver, fading with the fog like the rest of it.
const PLANT_FRAG = /* glsl */ `
  uniform sampler2D uLow;
  uniform sampler2D uHi;
  uniform vec2 uLowSize;
  uniform vec2 uHiSize;
  varying vec2 vLow;
  varying vec2 vHi;
  varying float vHasHi;
  varying float vSilver;
  ${SHADE}
  float empty(sampler2D m, vec2 at) {
    return 1.0 - step(0.5, texture2D(m, at).a);
  }
  float edge(sampler2D m, vec2 at, vec2 px) {
    return min(1.0, empty(m, at + vec2(px.x, 0.0)) + empty(m, at - vec2(px.x, 0.0)) + empty(m, at + vec2(0.0, px.y)) + empty(m, at - vec2(0.0, px.y)));
  }
  void main() {
    vec4 c = vHasHi > 0.5 ? texture2D(uHi, vHi) : texture2D(uLow, vLow);
    if (c.a < 0.5) discard;
    gl_FragColor = shade(vec4(c.rgb / c.a, 1.0));
    if (vSilver > 0.5) {
      // Two pixels on a full-size sprite: as wide as the rim was when those sprites had half the pixels.
      float rim = vHasHi > 0.5 ? edge(uHi, vHi, 2.0 / uHiSize) : edge(uLow, vLow, 1.0 / uLowSize);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.82, 0.86, 0.96), rim * 0.35 * (1.0 - vFog));
    }
  }
`;

function plantMaterial(low: THREE.DataTexture, high: THREE.DataTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLow: { value: low },
      uHi: { value: high },
      uLowSize: { value: new THREE.Vector2(low.image.width, low.image.height) },
      uHiSize: { value: new THREE.Vector2(high.image.width, high.image.height) },
      uTime: { value: 0 },
      uSway: { value: 1 },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
      uFog: { value: new THREE.Color() },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uSelected: { value: -1 },
      uPerk: { value: new THREE.Vector4(-1, 0, -1, 0) },
      uShake: { value: new THREE.Vector2(-1, 0) },
      uSneeze: { value: new THREE.Vector2(-1, 0) },
      uSilver: { value: 0 },
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
  /** The sheets of small sprites, on the GPU only. */
  private low: THREE.DataTexture[] = [];
  /** Which plant holds each full-size slot (-1: none). Sized in buildPlants, to the garden (textures.ts hiSlots). */
  private slotOwner = new Int32Array(0);
  private slotOf = new Map<number, number>();
  private streaming = false;
  private hungry = true;
  private lastStream = -1;
  /** stream's scratch: per plant, its distance and index in one number (see stream). Sized in buildPlants. */
  private near = new Float64Array(0);
  /** Every plant's material, for the perk uniform; also added to ctx.mats for GardenScene's per-frame loop. */
  private plantMats: THREE.ShaderMaterial[] = [];
  /** The plant the action button shakes (an index into the layout's plants; -1: none). */
  private readyIndex = -1;
  /** How far each plant stands taller for the action button, 0 to 1 (#689), before easing; and the plants on the way up or down, the one it shakes among them. */
  private risen: Float32Array;
  private rising: number[] = [];
  /** Where each plant's rise is drawn (once its bed's mesh is built). */
  private readyRef: { attr: THREE.InstancedBufferAttribute; i: number }[] = [];
  /** A plant perking up when it hears its name: its index, when it began, and the neighbour that thought it was called (-1: none). */
  private perk = { i: -1, at: 0, n: -1 };
  /** A shaken plant (#357): its index, when, and the forms falling from it as petals ([]: one leaf). */
  private shook: { i: number; at: number; forms: string[]; still: boolean } | null = null;
  /** Brushing the beds (#359): every plant's lean and spring, and where each plant's lean is drawn (once its bed's mesh is built). */
  private brush: Brush;
  private leanRef: { attr: THREE.InstancedBufferAttribute; i: number }[] = [];
  private onBrush: (p: PlacedPlant) => void;
  /** A plant sneezing (#360): its index, and when it began. */
  private sneezing = { i: -1, at: 0 };
  /** Tonight's moon is full (moon.ts). */
  private fullMoon: boolean;

  /** `onBrush`: the walker brushed past a plant, and its note plays now (at most one a frame). `fullMoon`: tonight's moon is full (#361). */
  constructor(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    layout: Layout,
    onProgress: (done: number, total: number) => void,
    behindHedge: (x: number, y: number, z: number) => boolean,
    onBrush: (p: PlacedPlant) => void,
    fullMoon: boolean,
  ) {
    this.renderer = renderer;
    this.camera = camera;
    this.layout = layout;
    this.onProgress = onProgress;
    this.behindHedge = behindHedge;
    this.onBrush = onBrush;
    this.brush = brush(layout);
    this.risen = new Float32Array(layout.plants.length);
    this.fullMoon = fullMoon;
  }

  /** On a full moon's night, old friends get their silver edge (#361). GardenScene.loadPlants gives the conditions again once the materials exist. */
  onConditions(c: Conditions) {
    const silver = this.fullMoon && c.time === "night" ? 1 : 0;
    for (const m of this.plantMats) m.uniforms.uSilver.value = silver;
  }

  /**
   * Raised beds: wooden sides, soil on top, and a sign for each, a bed per step: the scene yields between them (#459). Draws no random numbers.
   * All beds' wood is one mesh and all their soil another: a mesh per bed part was most of the walk's draw calls, and each costs main-thread time every frame.
   */
  *build(c: BuildCtx): Generator<void> {
    const { L, mat, woodTex } = c;
    const soilTex = T.paperTexture(T.soil(), true);
    const wood: THREE.BufferGeometry[] = [];
    const soil: THREE.BufferGeometry[] = [];
    // Every bed sign on one canvas, one texture and one material; each board shows its own cell.
    const atlas = T.signs(L.beds.flatMap((bed) => (bed.sign === null ? [] : bedSign(bed.sign, c.lang))));
    const signMat = mat(T.pixelTexture(atlas));
    const rows = atlas.height / T.SIGN.h;
    let sign = 0;
    for (const bed of L.beds) {
      const box = new THREE.BoxGeometry(bed.w, BED_H, bed.d);
      // Each face's texture repeat (faces +x, -x, +y, -y, +z, -z), in its UVs, so one material draws every bed.
      const repeat = [[bed.d / 1.2, 1], [bed.d / 1.2, 1], [bed.w, bed.d], [bed.w, bed.d], [bed.w / 1.2, 1], [bed.w / 1.2, 1]];
      const uv = box.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) {
        const [ru, rv] = repeat[Math.floor(i / 4)];
        uv.setXY(i, uv.getX(i) * ru, uv.getY(i) * rv);
      }
      box.translate(bed.x, BED_H / 2, bed.z);
      wood.push(faces(box, [0, 1, 4, 5]));
      soil.push(faces(box, [2, 3]));
      c.hitBoxes.push({ id: "bed", min: [bed.x - bed.w / 2, 0, bed.z - bed.d / 2], max: [bed.x + bed.w / 2, BED_H, bed.z + bed.d / 2], tag: null });
      // Only the first bed of a month has a sign (world.ts layout).
      if (bed.sign === null) {
        yield;
        continue;
      }
      const n = sign++;
      // Just outside the front-left corner, turned toward the path, so it never hides a plant.
      const sx = bed.x - bed.w / 2 - 0.3;
      const sz = bed.z + bed.d / 2 + 0.3;
      // As signBoard: the text on the front only, plain wood on the back.
      const face = new THREE.PlaneGeometry(0.96, 0.3);
      // This bed's cell in the atlas, half a texel in from its edge so nearest sampling never reads the next cell (or an
      // empty one). The texture is flipped: v = 1 is the canvas's top row.
      const col = n % T.SIGN.cols;
      const row = Math.floor(n / T.SIGN.cols);
      const inU = (u: number) => Math.min(Math.max(u, 0.5 / T.SIGN.w), 1 - 0.5 / T.SIGN.w);
      const inV = (v: number) => Math.min(Math.max(v, 0.5 / T.SIGN.h), 1 - 0.5 / T.SIGN.h);
      const faceUv = face.getAttribute("uv");
      for (let k = 0; k < faceUv.count; k++) faceUv.setXY(k, (col + inU(faceUv.getX(k))) / T.SIGN.cols, 1 - (row + 1 - inV(faceUv.getY(k))) / rows);
      const board = new THREE.Mesh(face, signMat);
      board.position.set(sx, 0.78, sz);
      board.rotation.y = 0.5;
      c.scene.add(still(board));
      wood.push(new THREE.PlaneGeometry(0.96, 0.3).rotateY(Math.PI + 0.5).translate(sx, 0.78, sz));
      c.hitBoxes.push(boardBox(sx, sz, 0.96, 0.93, 0.5));
      // The post: behind the board (it faces the path), never in its plane.
      wood.push(new THREE.BoxGeometry(0.06, 0.66, 0.06).translate(sx - Math.sin(0.5) * 0.06, 0.33, sz - Math.cos(0.5) * 0.06));
      yield;
    }
    // A garden with no beds yet: mergeGeometries needs at least one geometry.
    if (!wood.length) return;
    c.scene.add(still(new THREE.Mesh(mergeGeometries(wood), mat(woodTex))));
    c.scene.add(still(new THREE.Mesh(mergeGeometries(soil), mat(soilTex))));
  }

  /**
   * A texture that lives only on the GPU: storage allocated, nothing uploaded (WebGL starts it
   * cleared). Sprites are copied into it later. Uploading empty sheets took ~55 ms at CPU 10× (#459).
   * Filtered smooth, with `levels` mipmap levels for plants far off, which the sprite worker makes (#1091).
   */
  private gpuTexture(w: number, h: number, levels: number): THREE.DataTexture {
    const t = new THREE.DataTexture(null, w, h);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    // Only the sizes count: three allocates a level for each, and uploads none while dataReady is false.
    t.mipmaps = Array.from({ length: levels }, (_, l) => ({ data: new Uint8Array(0), width: w >> l, height: h >> l }));
    t.source.dataReady = false;
    t.needsUpdate = true;
    this.renderer.initTexture(t);
    return t;
  }

  /**
   * Copies sprites from the worker into `dst` at (x, y), every mipmap level: all of them, or the one
   * full-size sprite at `cell` of a batch. Every number halves exactly at each level (textures.ts levelsFor).
   */
  private copyLevels(src: THREE.DataTexture[], dst: THREE.DataTexture, x: number, y: number, cell?: { x: number; y: number }) {
    src.forEach((level, l) => {
      const part = cell ? new THREE.Box2(new THREE.Vector2(cell.x >> l, cell.y >> l), new THREE.Vector2((cell.x + T.HI_W) >> l, (cell.y + T.HI_H) >> l)) : null;
      this.renderer.copyTextureToTexture(level, dst, part, new THREE.Vector2(x >> l, y >> l), 0, l);
    });
  }

  /** One mesh per bed (and sheet), so whole beds can be culled. The sprites are empty until drawSprites draws them. `ctx` for the shared scene and mats set. */
  buildPlants(ctx: Pick<BuildCtx, "scene" | "mats">) {
    const plants = this.layout.plants;
    if (!plants.length) return;
    this.onProgress(0, plants.length);
    const slots = T.hiSlots(plants.length);
    this.slotOwner = new Int32Array(slots).fill(-1);
    const pool = this.gpuTexture(T.POOL_W, (slots / T.HI_COLS) * T.HI_H, T.HI_LEVELS);
    this.pool = pool;
    this.near = new Float64Array(plants.length);
    this.low = T.lowSheetHeights(plants.length).map((h) => this.gpuTexture(T.ATLAS, h, T.LOW_LEVELS));
    const mats = this.low.map((tex) => {
      const m = plantMaterial(tex, pool);
      ctx.mats.add(m);
      this.plantMats.push(m);
      return m;
    });

    const groups = new Map<string, number[]>();
    plants.forEach((p, i) => {
      const k = `${p.bed}:${Math.floor(i / T.LOW_PER_SHEET)}`;
      const list = groups.get(k);
      if (list) list.push(i);
      else groups.set(k, [i]);
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
      const old = new Float32Array(idx.length);
      // Written in place: no small array per plant (#459).
      idx.forEach((pi, k) => {
        const p = plants[pi];
        pos[k * 3] = p.x;
        pos[k * 3 + 1] = baseY;
        pos[k * 3 + 2] = p.z;
        params[k * 4] = p.phase;
        params[k * 4 + 1] = p.droop;
        params[k * 4 + 2] = PLANT_SCALE;
        params[k * 4 + 3] = pi;
        cells[k * 2] = pi % T.LOW_PER_SHEET;
        cells[k * 2 + 1] = -1;
        old[k] = isOld(p) ? 1 : 0;
      });
      const cellAttr = new THREE.InstancedBufferAttribute(cells, 2);
      cellAttr.setUsage(THREE.DynamicDrawUsage);
      const leanAttr = new THREE.InstancedBufferAttribute(new Float32Array(idx.length), 1);
      leanAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("iLean", leanAttr);
      const readyAttr = new THREE.InstancedBufferAttribute(new Float32Array(idx.length), 1);
      readyAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("iReady", readyAttr);
      geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(pos, 3));
      geo.setAttribute("iParams", new THREE.InstancedBufferAttribute(params, 4));
      geo.setAttribute("iCell", cellAttr);
      geo.setAttribute("iOld", new THREE.InstancedBufferAttribute(old, 1));
      geo.instanceCount = idx.length;
      const center = new THREE.Vector3(bed.x, 0.9, bed.z);
      const radius = Math.hypot(bed.w / 2, bed.d / 2, 1.2) + 0.4;
      geo.boundingSphere = new THREE.Sphere(center, radius);
      const mesh = new THREE.Mesh(geo, mats[sheet]);
      ctx.scene.add(still(mesh));
      this.chunks.push({ mesh, center, radius });
      idx.forEach((pi, k) => {
        this.hiRef[pi] = { attr: cellAttr, i: k };
        this.leanRef[pi] = { attr: leanAttr, i: k };
        this.readyRef[pi] = { attr: readyAttr, i: k };
      });
    }
  }

  /** The plant meshes, one per bed and sheet: all children of the scene. */
  meshes(): THREE.Mesh[] {
    return this.chunks.map((c) => c.mesh);
  }

  /**
   * Draws every plant's small sprite, a run of plants per task so the page
   * never waits long (#459); the runs nearest you first, so the plants you see
   * come up first. Not onProgress(total) at the end: GardenScene.loadPlants does that.
   */
  async drawSprites(): Promise<void> {
    const plants = this.layout.plants;
    const at = this.camera.position;
    const runs: { start: number; d: number }[] = [];
    for (let start = 0; start < plants.length; start += T.LOW_RUN) {
      let d = Infinity;
      for (let i = start; i < Math.min(start + T.LOW_RUN, plants.length); i++) d = Math.min(d, Math.hypot(plants[i].x - at.x, plants[i].z - at.z));
      runs.push({ start, d });
    }
    runs.sort((a, b) => a.d - b.d);
    let done = 0;
    for (const { start } of runs) {
      const run = plants.slice(start, start + T.LOW_RUN);
      const src = await T.lowRun(run);
      if (this.disposed) return;
      const c = T.lowCell(start);
      this.copyLevels(src, this.low[c.sheet], c.x, c.y);
      done += run.length;
      if (done < plants.length) this.onProgress(done, plants.length);
    }
  }

  private setSlot(plant: number, slot: number) {
    const ref = this.hiRef[plant];
    ref.attr.setY(ref.i, slot);
    ref.attr.needsUpdate = true;
  }

  /**
   * Keep full-size sprites for the plants nearest to you (ahead of you
   * first) in the pool, one batch at a time. The pool has a slot for every
   * plant of a small garden and 210 at most, so a garden of 5000 takes no more memory than one of 210.
   */
  private stream(x: number, z: number, yaw: number) {
    const pool = this.pool;
    if (!pool) return;
    const plants = this.layout.plants;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    // Into arrays sized once, not an object per plant: this runs 4 times a second, or every frame while plants are missing (#459).
    // Distance (in 1/4096 m) times the plant count, plus the index: sort() with no compare
    // function sorts in native code. With one, V8 sorted through copies of the array: the walk's biggest allocation (#571).
    const { near } = this;
    const n = plants.length;
    for (let i = 0; i < n; i++) {
      const dx = plants[i].x - x;
      const dz = plants[i].z - z;
      near[i] = Math.floor(Math.sqrt(dx * dx + dz * dz) * (dx * fx + dz * fz < 0 ? 1.8 : 1) * 4096) * n + i;
    }
    near.sort();
    const wanted = Array.from(near.subarray(0, this.slotOwner.length), (k) => k % n);
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
    for (let s = 0; s < this.slotOwner.length && slots.length < missing.length; s++) if (this.slotOwner[s] === -1) slots.push(s);
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
      (src) => {
        this.streaming = false;
        if (this.disposed) return;
        missing.forEach((plant, k) => {
          const slot = this.slotOf.get(plant)!;
          this.copyLevels(src, pool, (slot % T.HI_COLS) * T.HI_W, Math.floor(slot / T.HI_COLS) * T.HI_H, T.batchCell(k));
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

  /** Mark the plant the action button shakes (#689), or none: it rises, and the last one settles back (tickReady). */
  ready(p: PlacedPlant | null) {
    this.readyIndex = p ? this.layout.plants.indexOf(p) : -1;
    if (this.readyIndex >= 0 && !this.rising.includes(this.readyIndex)) this.rising.push(this.readyIndex);
  }

  /**
   * Eases each rising plant toward standing taller, or back, so its size never steps (#1109). With reduced motion too:
   * a step is what looked like a fault (accessibility.md, section 6). No allocations: it runs every frame.
   */
  private tickReady(dt: number) {
    const { rising, risen } = this;
    for (let k = rising.length - 1; k >= 0; k--) {
      const i = rising[k];
      // Before loadPlants has built the beds' meshes there is nothing to draw the rise on yet: it starts once they are.
      const ref = this.readyRef[i];
      if (!ref) continue;
      const up = i === this.readyIndex;
      const a = up ? Math.min(1, risen[i] + dt / READY_TIME) : Math.max(0, risen[i] - dt / READY_TIME);
      if (a !== risen[i]) {
        risen[i] = a;
        ref.attr.setX(ref.i, a * a * (3 - 2 * a));
        ref.attr.needsUpdate = true;
      }
      // Settled back: out of the list (the order does not matter).
      if (!up && a === 0) {
        rising[k] = rising[rising.length - 1];
        rising.pop();
      }
    }
  }

  /**
   * Shake a plant (#357): it shivers, and its word's other forms fall from it
   * as petals, written on them; a word with no other forms drops one leaf.
   * A new shake ends the last one. With reduced motion it does not shiver,
   * and the petals lie on the soil from the start. `forms`: the ones that fall (game.ts, shake.ts petalForms).
   */
  shake(p: PlacedPlant, forms: string[], elapsed: number, reducedMotion: boolean) {
    this.shook = { i: this.layout.plants.indexOf(p), at: elapsed, forms, still: reducedMotion };
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

  /** A dandelion seed landed on plant `i` (an index into the layout's plants): it sneezes. The newest sneeze takes the place of one still going. */
  sneeze(i: number, elapsed: number) {
    this.sneezing.i = i;
    this.sneezing.at = elapsed;
  }

  /** Squashes the sneezing plant, then lets it pop back. No allocations: it runs every frame. */
  private tickSneeze(elapsed: number) {
    const k = this.sneezing;
    if (k.i < 0) return;
    const t = elapsed - k.at;
    const done = t > SNEEZE.rise + SNEEZE.fall;
    const a = done ? 0 : perkEnvelope(t, SNEEZE.rise, SNEEZE.fall) * SNEEZE.squash;
    for (const m of this.plantMats) m.uniforms.uSneeze.value.set(done ? -1 : k.i, a);
    if (done) k.i = -1;
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

  /** Chunk culling (beds outside the fog are skipped), streaming the plants nearest you, the perk and sneeze uniforms, brushing, and the plant in reach rising. */
  tick(f: Frame) {
    const { elapsed, x, z, yaw } = f;
    for (const c of this.chunks) c.mesh.visible = c.center.distanceTo(this.camera.position) - c.radius < FOG_FAR;
    if (this.pool && !this.streaming && (this.hungry || elapsed - this.lastStream > 0.25)) {
      this.lastStream = elapsed;
      this.stream(x, z, yaw);
    }
    this.tickPerk(elapsed);
    this.tickShake(elapsed);
    this.tickSneeze(elapsed);
    this.tickBrush(f);
    this.tickReady(f.dt);
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
      const dx = p.x - x;
      const dz = p.z - z;
      // Not Math.hypot: it allocates on each call, and this runs for every plant on every frame (#459).
      const d = Math.sqrt(dx * dx + dz * dz);
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

/** Some faces of a one-segment box (+x, -x, +y, -y, +z, -z), as a geometry of their own. */
function faces(box: THREE.BoxGeometry, which: number[]): THREE.BufferGeometry {
  const index = box.getIndex()!.array;
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) g.setAttribute(name, box.getAttribute(name));
  g.setIndex(which.flatMap((f) => Array.from(index.slice(f * 6, f * 6 + 6))));
  return g;
}
