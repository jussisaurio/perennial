// The walkable word garden, rendered the 90s way: a tiny framebuffer scaled
// up with hard pixels, unlit textures, fog, and flat sprite plants that turn
// to face you. Loaded only when the garden is opened.

import * as THREE from "three";
import { rng } from "../lib/seed";
import { collide, viewpoint, type Layout, type PlacedPlant } from "./world";
import * as T from "./textures";
import { stemHeight } from "../ui/plant";
import { nearestPlant, NEIGHBOUR, neighbourPerks, PERK, PERK_SCALE, perkEnvelope, pickSigns, sunflowerFaces, type SignLine } from "./whimsy";
import { GATE_HALF, SNAIL_SIGN, type VisitorId, type VisitorView } from "./visitors";
import { BENCH_SIGN, SceneVisitors } from "./sceneVisitors";
import { boardBox, DECOR_KINDS, pickScenery, spriteBox, SUN_TAG, TREE_KINDS, type HitBox, type HitDisc, type SceneryHit, type SceneryView, type SceneryViews, type SceneryWorld } from "./scenery";

export type TimeOfDay = "day" | "dusk" | "night";

/** A name over a plant, a visitor's tag (kind "visitor"), a tapped scenery word (kind "scenery"), or what a visitor says (kind "say"), in screen fractions. */
export interface Label {
  id: string;
  text: string;
  x: number;
  y: number;
  /** 0 to 1: how close (plant names), or how much of a visitor tag shows. */
  near: number;
  kind?: "visitor" | "scenery" | "say";
  gloss?: string;
  /** A visitor whose noun the learner knows: plant-label styling with a tiny leaf. */
  known?: boolean;
}

/** Who visits the walk today. */
export interface WalkVisitors {
  list: VisitorView[];
  /** The first word's plant and its stake text, e.g. "casa · 3 Oct" (#61). */
  keepsake?: { id: string; text: string } | null;
  /** The stake in an empty garden, e.g. "Reserved for Spanish words" (#58). */
  reserved?: string | null;
  /** Tonight's sleeping bloom (#62): three z's drift up from it at night. */
  sleeper?: string | null;
  /** Words for the garden itself (#74): shown when you tap the sunflower, a tree, the pond... */
  scenery?: SceneryViews;
}

export interface SceneCallbacks {
  onSelect: (p: PlacedPlant | null) => void;
  onLabels: (labels: Label[]) => void;
  onProgress: (done: number, total: number) => void;
}

export interface Input {
  /** -1..1 each: forward and right, from keys or the touch stick. */
  move: { x: number; y: number };
  run: boolean;
}

const EYE = 1.05;
const SPRITE_W = 1.0;
const SPRITE_H = 2.0;
const WALK = 3.6;
/**
 * Width of the framebuffer, in pixels, for each level of detail. Normal
 * renders at about screen resolution on most screens (the textures keep the
 * pixel-art look). Low uses big pixels, for slow devices.
 */
export const DETAIL = { normal: 2160, low: 760 } as const;
export type Detail = keyof typeof DETAIL;
const FOG_NEAR = 14;
const FOG_FAR = 46;
/** Plant sprites a little under life size: the tallest bloom stands about eye height. */
const PLANT_SCALE = 0.85;
/** Height of the raised beds: plants stand on their soil. */
const BED_H = 0.28;
/** How far away the sun (or moon) is drawn, along its direction from the eye. */
const SUN_DIST = 200;
/** The far hills: a ring of this radius and height, its middle this high, the texture repeated this often round it. */
const HILLS = { radius: 150, height: 34, y: 10, repeat: 4 };
const UP = new THREE.Vector3(0, 1, 0);

/** A plant sprite's drawn height in metres. 14 + 120 × growth is the plant's height in SVG units (ui/plant.tsx). */
function plantHeight(growth: number): number {
  return (stemHeight(growth) / T.VIEW_H) * SPRITE_H * PLANT_SCALE;
}

// The vertex shader part every sprite shares: the fog and selection inputs,
// and billboard(), which sways the quad in the wind, leans it by `droop`, then
// turns it to face the camera around the vertical axis only, like Doom's
// sprites. It returns the view-space position.
const BILLBOARD = /* glsl */ `
  uniform float uTime;
  uniform float uSway;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uSelected;
  varying float vFog;
  varying float vSel;
  vec4 billboard(vec3 at, vec2 p, float phase, float droop) {
    float h = position.y / ${SPRITE_H.toFixed(1)};
    float a = droop + uSway * sin(uTime * 1.4 + phase) * 0.07 * h + uSway * sin(uTime * 3.1 + phase * 2.0) * 0.015;
    p = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
    vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
    vec3 world = at + right * p.x + vec3(0.0, p.y, 0.0);
    return viewMatrix * vec4(world, 1.0);
  }
`;

// The fragment shader part every sprite shares: time-of-day tint, a pulse
// when selected, and fog.
const SHADE = /* glsl */ `
  uniform vec3 uFog;
  uniform vec3 uTint;
  uniform float uTime;
  varying float vFog;
  varying float vSel;
  vec4 shade(vec4 c) {
    vec3 col = c.rgb * uTint;
    col = mix(col, min(vec3(1.0), col * 1.35 + 0.08), vSel * (0.6 + 0.4 * sin(uTime * 5.0)));
    return vec4(mix(col, uFog, vFog), 1.0);
  }
`;

const SPRITE_VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iUv;
  attribute vec4 iParams; // phase, droop, scale, index
  varying vec2 vUv;
  ${BILLBOARD}
  void main() {
    vec4 mv = billboard(iPos, position.xy * iParams.z, iParams.x, iParams.y);
    gl_Position = projectionMatrix * mv;
    vUv = iUv.xy + uv * iUv.zw;
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    vSel = abs(iParams.w - uSelected) < 0.5 ? 1.0 : 0.0;
  }
`;

const SPRITE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  ${SHADE}
  void main() {
    vec4 c = texture2D(uMap, vUv);
    if (c.a < 0.5) discard;
    gl_FragColor = shade(c);
  }
`;

// Plants: like other sprites, but each samples its small sprite, or its
// full-size one once the streamer has put it in a pool slot (iCell.y >= 0).
const PLANT_VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iParams; // phase, droop, scale, index
  attribute vec2 iCell; // low cell, high slot (-1: none yet)
  uniform vec4 uPerk; // plant index, growth; neighbour index, growth
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
    vec4 mv = billboard(iPos, position.xy * iParams.z * (1.0 + perk), iParams.x, iParams.y);
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
    },
    vertexShader: PLANT_VERT,
    fragmentShader: PLANT_FRAG,
  });
}

function spriteMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uTime: { value: 0 },
      uSway: { value: 1 },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
      uFog: { value: new THREE.Color() },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uSelected: { value: -1 },
    },
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG,
  });
}

/** A w×h quad standing on its bottom edge. */
function standingQuad(w: number, h: number): THREE.PlaneGeometry {
  const quad = new THREE.PlaneGeometry(w, h);
  quad.translate(0, h / 2, 0);
  return quad;
}

/** Instanced geometry that shares `quad`'s vertices; the caller adds the per-instance attributes. */
function instanced(quad: THREE.PlaneGeometry): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  geo.setAttribute("uv", quad.getAttribute("uv"));
  return geo;
}

/** Instanced camera-facing quads, bottom-centre anchored, from one atlas. */
type SpriteItem = { x: number; y: number; z: number; u: number; v: number; uw: number; vh: number; phase: number; droop: number; scale: number; index: number };
function sprites(map: THREE.Texture, items: SpriteItem[], w = SPRITE_W, h = SPRITE_H) {
  const geo = instanced(standingQuad(w, h));
  const pos = new Float32Array(items.length * 3);
  const uv = new Float32Array(items.length * 4);
  const params = new Float32Array(items.length * 4);
  items.forEach((it, i) => {
    pos.set([it.x, it.y, it.z], i * 3);
    uv.set([it.u, it.v, it.uw, it.vh], i * 4);
    params.set([it.phase, it.droop, it.scale, it.index], i * 4);
  });
  geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(pos, 3));
  geo.setAttribute("iUv", new THREE.InstancedBufferAttribute(uv, 4));
  geo.setAttribute("iParams", new THREE.InstancedBufferAttribute(params, 4));
  geo.instanceCount = items.length;
  const mesh = new THREE.Mesh(geo, spriteMaterial(map));
  mesh.frustumCulled = false;
  return mesh;
}

// Three z's drifting up from the sleeping bloom (#62). All the motion is in the
// shader, so a frame costs one uniform. With reduced motion they stay still.
const SNORE_VERT = /* glsl */ `
  attribute float phase;
  uniform float uTime;
  uniform float uMove;
  uniform float uScale;
  varying float vA;
  void main() {
    float k = uMove > 0.5 ? fract(uTime / 3.6 + phase / 3.0) : 0.15 + phase * 0.3;
    vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
    vec3 p = position + right * (0.1 + k * 0.2 + sin(k * 6.28) * 0.03) + vec3(0.0, k * 0.5, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp((0.13 + 0.06 * k) * uScale / -mv.z, 3.0, 72.0);
    vA = uMove > 0.5 ? smoothstep(0.0, 0.15, k) * (1.0 - smoothstep(0.65, 1.0, k)) : 0.9;
  }
`;
const SNORE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vA;
  void main() {
    vec4 c = texture2D(uMap, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y));
    if (c.a < 0.5 || vA < 0.02) discard;
    gl_FragColor = vec4(c.rgb, vA);
  }
`;

/** What every part of the world is built with (GardenScene.build). */
interface BuildCtx {
  L: Layout;
  b: Layout["bounds"];
  /** The garden inside the fence: width, depth and middle. */
  w: number;
  d: number;
  cx: number;
  cz: number;
  /** An unlit material that follows the time of day's tint. */
  mat: (tex: THREE.Texture, opts?: THREE.MeshBasicMaterialParameters) => THREE.MeshBasicMaterial;
  woodTex: THREE.Texture;
  /** One random sequence for the whole world, so it is laid out the same every time. */
  rand: () => number;
}

/** A sign's board: the text on the front only, plain wood on the back (a two-sided text plane shows the text mirrored from behind). */
function signBoard(c: BuildCtx, tex: THREE.Texture, w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), c.mat(tex)));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), c.mat(c.woodTex));
  back.rotation.y = Math.PI;
  g.add(back);
  return g;
}

export class GardenScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.1, 260);
  private last = performance.now();
  private elapsed = 0;
  private frame = 0;
  private disposed = false;
  private yaw = 0;
  private pitch = -0.2;
  private x = 0;
  private z = 0;
  private bob = 0;
  private glide: { from: [number, number, number]; to: [number, number, number]; pitch: [number, number]; t: number } | null = null;
  /** Every sprite material, for time, sway, tint, fog and selection uniforms. */
  private mats = new Set<THREE.ShaderMaterial>();
  private chunks: { mesh: THREE.Mesh; center: THREE.Vector3; radius: number }[] = [];
  /** For each plant: the attribute and instance that hold its high-detail slot. */
  private hiRef: { attr: THREE.InstancedBufferAttribute; i: number }[] = [];
  private pool: THREE.DataTexture | null = null;
  private slotOwner = new Int32Array(T.HI_SLOTS).fill(-1);
  private slotOf = new Map<number, number>();
  private streaming = false;
  private hungry = true;
  private lastStream = -1;
  private basic: THREE.MeshBasicMaterial[] = [];
  private skyMat!: THREE.MeshBasicMaterial;
  private hillMat!: THREE.MeshBasicMaterial;
  private fireflies!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private butterflies: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; cx: number; cz: number; r: number; ph: number; tex: THREE.Texture }[] = [];
  private clouds: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private marker!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private water!: THREE.Texture;
  private lit!: ReturnType<typeof sprites>;
  private unlit!: ReturnType<typeof sprites>;
  private glows: THREE.Object3D[] = [];
  private sun!: THREE.Sprite;
  private sunDir = new THREE.Vector3();
  /** The sunflower: where it stands, its sprite's frame and lean, and which side it shows (null: not drawn yet). */
  private flower!: { x: number; z: number; uv: THREE.InstancedBufferAttribute; params: THREE.InstancedBufferAttribute; face: boolean | null };
  private selected: PlacedPlant | null = null;
  private time: TimeOfDay = "day";
  private lastLabels = "";
  private tmp = new THREE.Vector3();
  /** What a tap can name in the garden itself (#74), built once. The clouds and the sun are read at tap time. */
  private hitBoxes: HitBox[] = [];
  private hitDiscs: HitDisc[] = [];
  private hillProfile: number[] = [];
  /** The tapped scenery word and where its tag sits (it follows the sun or a cloud). */
  private sceneryTap: { view: SceneryView; hit: SceneryHit; until: number } | null = null;
  /** Lantern spots, for the moth. */
  private lanternSpots: [number, number][] = [];
  /** The lily pads, for the frog. */
  private pads: [number, number][] = [];
  /** Plant materials, for the perk uniform. */
  private plantMats: THREE.ShaderMaterial[] = [];
  /** A plant perking up when it hears its name: its index, when it began, and the neighbour that thought it was called (-1: none). */
  private perk = { i: -1, at: 0, n: -1 };
  /** The sleeping bloom's z's, shown at night. */
  private snore: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  readonly input: Input = { move: { x: 0, y: 0 }, run: false };

  private layout: Layout;
  private cb: SceneCallbacks;
  private reducedMotion: boolean;

  /** The course language, for the odd sign written in it. */
  private lang: string;
  private visitors: WalkVisitors;
  /** Today's visitors in the walk (sceneVisitors.ts). */
  private guests: SceneVisitors;

  constructor(canvas: HTMLCanvasElement, layout: Layout, cb: SceneCallbacks, reducedMotion: boolean, lang: string, visitors: WalkVisitors) {
    this.layout = layout;
    this.cb = cb;
    this.reducedMotion = reducedMotion;
    this.lang = lang;
    this.visitors = visitors;
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.x = layout.gate.x;
    // Start inside the gate, close enough that the first bed fills the view.
    const first = layout.beds[0];
    this.z = Math.min(layout.gate.z - 1.2, first.z + first.d / 2 + 3.2);
    this.camera.rotation.order = "YXZ";
    this.guests = new SceneVisitors(
      {
        scene: this.scene,
        camera: this.camera,
        layout,
        reducedMotion,
        elapsed: () => this.elapsed,
        sprite: (tex, x, y, z, u, uw, size) => {
          const mesh = sprites(tex, [{ x, y, z, u, v: 0, uw, vh: 1, phase: 0, droop: 0, scale: 1, index: -6 }], size, size);
          mesh.material.uniforms.uSway.value = 0;
          return mesh;
        },
      },
      visitors.list,
    );
    this.build();
  }

  /**
   * Builds the static world, part by part; the plants follow (they need
   * rasterising). Keep the order: the parts share one random sequence.
   */
  private build() {
    const L = this.layout;
    const b = L.bounds;
    const c: BuildCtx = {
      L,
      b,
      w: b.maxX - b.minX,
      d: b.maxZ - b.minZ,
      cx: (b.minX + b.maxX) / 2,
      cz: (b.minZ + b.maxZ) / 2,
      mat: (tex, opts = {}) => {
        const m = new THREE.MeshBasicMaterial({ map: tex, ...opts });
        this.basic.push(m);
        return m;
      },
      woodTex: T.pixelTexture(T.wood(), true),
      rand: rng(1),
    };
    this.buildGround(c);
    this.buildBeds(c);
    this.buildFence(c);
    this.buildPond(c);
    this.buildTrees(c);
    this.buildLanterns(c);
    const bench = this.buildBench(c);
    this.buildSigns(c, bench);
    this.guests.build({ bench: bench.position, pads: this.pads, lanterns: this.lanternSpots });
    this.buildStakes(c);
    this.buildSunflower(c);
    this.buildDecor(c);
    this.buildSky(c);
    this.buildCritters(c);
    this.buildSun();
    this.setTime(this.time);
  }

  /** Ground: grass everywhere, a path surface inside the fence. */
  private buildGround(c: BuildCtx) {
    const { w, d, cx, cz, mat } = c;
    const grassTex = T.pixelTexture(T.grass(), true);
    grassTex.repeat.set(200, 200);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(grassTex));
    ground.rotation.x = -Math.PI / 2;
    // Layers of flat ground sit a few cm apart: some GPUs have a 16-bit depth buffer.
    ground.position.y = -0.06;
    this.scene.add(ground);
    const pathTex = T.pixelTexture(T.path(), true);
    pathTex.repeat.set(w / 1.1, d / 1.1);
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(pathTex));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(cx, 0.01, cz);
    this.scene.add(yard);
  }

  /** Raised beds: wooden sides, soil on top, and a sign for each. */
  private buildBeds(c: BuildCtx) {
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
      this.scene.add(box);
      this.hitBoxes.push({ id: "bed", min: [bed.x - bed.w / 2, 0, bed.z - bed.d / 2], max: [bed.x + bed.w / 2, BED_H, bed.z + bed.d / 2], tag: null });
      const signTex = T.pixelTexture(T.sign(bed.label));
      // Just outside the front-left corner, turned toward the path, so it never hides a plant.
      const sx = bed.x - bed.w / 2 - 0.3;
      const sz = bed.z + bed.d / 2 + 0.3;
      const board = signBoard(c, signTex, 0.96, 0.3);
      board.position.set(sx, 0.78, sz);
      board.rotation.y = 0.5;
      this.scene.add(board);
      this.hitBoxes.push(boardBox(sx, sz, 0.96, 0.93, 0.5));
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.66, 0.06), mat(woodTex));
      // Behind the board (it faces the path), never in its plane.
      post.position.set(sx - Math.sin(0.5) * 0.06, 0.33, sz - Math.cos(0.5) * 0.06);
      this.scene.add(post);
    }
  }

  /** The picket fence, with an arch over the gate. */
  private buildFence(c: BuildCtx) {
    const { L, b, mat, woodTex } = c;
    const fenceTex = T.pixelTexture(T.picket(), true);
    const fence = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.1) return;
      const t = fenceTex.clone();
      t.repeat.set(len / 1.0, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.8), mat(t, { transparent: false, alphaTest: 0.5, side: THREE.DoubleSide }));
      m.position.set((x1 + x2) / 2, 0.4, (z1 + z2) / 2);
      m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      this.scene.add(m);
      this.hitBoxes.push({ id: "fence", min: [Math.min(x1, x2) - 0.05, 0, Math.min(z1, z2) - 0.05], max: [Math.max(x1, x2) + 0.05, 0.8, Math.max(z1, z2) + 0.05], tag: null });
    };
    fence(b.minX, b.minZ, b.maxX, b.minZ);
    fence(b.minX, b.minZ, b.minX, b.maxZ);
    fence(b.maxX, b.minZ, b.maxX, b.maxZ);
    fence(b.minX, b.maxZ, L.gate.x - GATE_HALF, b.maxZ);
    fence(L.gate.x + GATE_HALF, b.maxZ, b.maxX, b.maxZ);
    // An arch over the gate.
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.1, 0.14), mat(woodTex));
      post.position.set(L.gate.x + s * GATE_HALF, 1.05, b.maxZ);
      this.scene.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(GATE_HALF * 2 + 0.5, 0.16, 0.2), mat(woodTex));
    beam.position.set(L.gate.x, 2.1, b.maxZ);
    this.scene.add(beam);
    const gateTag: [number, number, number] = [L.gate.x, 2.26, b.maxZ];
    for (const sx of [-1, 1]) this.hitBoxes.push({ id: "gate", min: [L.gate.x + sx * GATE_HALF - 0.1, 0, b.maxZ - 0.1], max: [L.gate.x + sx * GATE_HALF + 0.1, 2.1, b.maxZ + 0.1], tag: gateTag });
    this.hitBoxes.push({ id: "gate", min: [L.gate.x - GATE_HALF - 0.25, 2.0, b.maxZ - 0.1], max: [L.gate.x + GATE_HALF + 0.25, 2.18, b.maxZ + 0.1], tag: gateTag });
  }

  /** The pond by the gate, with lily pads. */
  private buildPond(c: BuildCtx) {
    const { L, mat } = c;
    this.water = T.pixelTexture(T.water(), true);
    this.water.repeat.set(2, 2);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(L.pond.r, 20), mat(this.water));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(L.pond.x, 0.04, L.pond.z);
    this.scene.add(pond);
    this.hitDiscs.push({ id: "pond", x: L.pond.x, y: 0.045, z: L.pond.z, r: L.pond.r + 0.18, tagY: 0.3 });
    const rim = new THREE.Mesh(new THREE.RingGeometry(L.pond.r, L.pond.r + 0.18, 20), mat(T.pixelTexture(T.path(), true), { color: 0xb0aaa0 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(L.pond.x, 0.045, L.pond.z);
    this.scene.add(rim);
    const padTex = T.pixelTexture(T.lilypad());
    for (let i = 0; i < 4; i++) {
      const a = i * 1.9 + 0.4;
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), mat(padTex, { alphaTest: 0.5 }));
      pad.rotation.set(-Math.PI / 2, 0, a);
      pad.position.set(L.pond.x + Math.cos(a) * L.pond.r * 0.55, 0.07, L.pond.z + Math.sin(a) * L.pond.r * 0.55);
      this.pads.push([pad.position.x, pad.position.z]);
      this.hitDiscs.push({ id: "lily", x: pad.position.x, y: 0.07, z: pad.position.z, r: 0.2, tagY: 0.14 });
      this.scene.add(pad);
    }
  }

  /** Trees and bushes outside the fence. */
  private buildTrees(c: BuildCtx) {
    const { L, b, w, d, rand } = c;
    const treeTex = T.pixelTexture(T.trees());
    const trees: SpriteItem[] = [];
    const perimeter = 2 * (w + d);
    const count = Math.round(perimeter / 2.2);
    for (let i = 0; i < count; i++) {
      const t = (i / count) * perimeter;
      let x: number, z: number;
      if (t < w) [x, z] = [b.minX + t, b.minZ];
      else if (t < w + d) [x, z] = [b.maxX, b.minZ + (t - w)];
      else if (t < 2 * w + d) [x, z] = [b.maxX - (t - w - d), b.maxZ];
      else [x, z] = [b.minX, b.maxZ - (t - 2 * w - d)];
      const nx = x < b.minX + 0.01 ? -1 : x > b.maxX - 0.01 ? 1 : 0;
      const nz = z < b.minZ + 0.01 ? -1 : z > b.maxZ - 0.01 ? 1 : 0;
      if (nz === 1 && Math.abs(x - L.gate.x) < 3.5) continue; // keep the view from the gate open
      const out = 1.2 + rand() * 5;
      const kind = rand() < 0.3 ? 3 : Math.floor(rand() * 3);
      trees.push({
        x: x + nx * out + (rand() - 0.5),
        y: 0,
        z: z + nz * out + (rand() - 0.5),
        u: kind * 0.25,
        v: 0,
        uw: 0.25,
        vh: 1,
        phase: rand() * 6,
        droop: 0,
        scale: kind === 3 ? 1.1 : 2.4 + rand() * 1.6,
        index: -2,
      });
    }
    for (const t of trees) {
      const k = TREE_KINDS[Math.round(t.u * 4)];
      this.hitBoxes.push(spriteBox(k.id, t.x, 0, t.z, k.half * t.scale, k.top * t.scale));
    }
    const treeMesh = sprites(treeTex, trees);
    this.mats.add(treeMesh.material);
    this.scene.add(treeMesh);
  }

  /** Lanterns where paths cross, and two by the gate. Lit at dusk and night. */
  private buildLanterns(c: BuildCtx) {
    const { L } = c;
    const spots = new Map<string, [number, number]>();
    for (const bed of L.beds)
      for (const sx of [-1, 1]) {
        const x = bed.x + sx * (bed.w / 2 + 0.95);
        const z = bed.z + bed.d / 2 + 0.95;
        spots.set(`${x.toFixed(1)},${z.toFixed(1)}`, [x, z]);
      }
    spots.set("gate-l", [L.gate.x - 1.6, L.gate.z - 0.4]);
    spots.set("gate-r", [L.gate.x + 1.6, L.gate.z - 0.4]);
    this.lanternSpots = [...spots.values()];
    for (const [x, z] of this.lanternSpots) this.hitBoxes.push(spriteBox("lantern", x, 0, z, 0.13, 1.26));
    const lanternTex = T.pixelTexture(T.lantern());
    const lanternItems = (u: number): SpriteItem[] => this.lanternSpots.map(([x, z]) => ({ x, y: 0, z, u, v: 0, uw: 0.5, vh: 1, phase: 0, droop: 0, scale: 1, index: -3 }));
    this.unlit = sprites(lanternTex, lanternItems(0), 0.42, 1.26);
    this.lit = sprites(lanternTex, lanternItems(0.5), 0.42, 1.26);
    for (const m of [this.unlit, this.lit]) {
      this.mats.add(m.material);
      this.scene.add(m);
    }
    const glowTex = T.pixelTexture(T.glow());
    const additive = { map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false } as const;
    for (const [x, z] of this.lanternSpots) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ ...additive }));
      halo.scale.set(1.1, 1.1, 1);
      halo.position.set(x, 1.12, z);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ ...additive, opacity: 0.55 }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.06, z);
      this.glows.push(halo, pool);
      this.scene.add(halo, pool);
    }
  }

  /** A bench by the pond, for sitting and admiring. Returns where it stands. */
  private buildBench(c: BuildCtx): THREE.Group {
    const { L, mat, woodTex } = c;
    const bench = new THREE.Group();
    const plank = (w: number, h: number, dd: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), mat(woodTex));
      m.position.set(x, y, z);
      bench.add(m);
    };
    plank(1.3, 0.06, 0.4, 0, 0.42, 0);
    plank(1.3, 0.28, 0.05, 0, 0.66, -0.2);
    for (const sx of [-0.55, 0.55]) for (const sz of [-0.15, 0.15]) plank(0.06, 0.42, 0.06, sx, 0.21, sz);
    bench.position.set(L.pond.x + 0.2, 0, L.pond.z - L.pond.r - 0.75);
    this.scene.add(bench);
    {
      const { x, z } = bench.position;
      this.hitBoxes.push({ id: "bench", min: [x - 0.68, 0, z - 0.25], max: [x + 0.68, 0.8, z + 0.22], tag: [x, 0.88, z] });
    }
    return bench;
  }

  /** Notice boards: two whose text changes each day, one at the gate, and the snail's. */
  private buildSigns(c: BuildCtx, bench: THREE.Group) {
    const { L, b, mat, woodTex } = c;
    // Two notice boards whose text changes each day: one on the back fence, one by the bench.
    const signs = pickSigns(this.lang);
    if (this.visitors.list.some((v) => v.id === "cat")) signs.bench = { text: "Bench: taken" };
    const noticeBoard = (line: SignLine, x: number, z: number, turn: number) => {
      const g = new THREE.Group();
      const board = signBoard(c, T.pixelTexture(T.notice(line.text)), 1.2, 0.48);
      board.position.y = 0.95;
      if (line.upsideDown) board.rotation.z = Math.PI;
      g.add(board);
      for (const sx of [-0.45, 0.45]) {
        // Behind the board with a gap: a post in the board's plane fights it and shows through the text.
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.86, 0.06), mat(woodTex));
        post.position.set(sx, 0.43, -0.06);
        g.add(post);
      }
      g.position.set(x, 0, z);
      g.rotation.y = turn;
      this.scene.add(g);
      this.hitBoxes.push(boardBox(x, z, 1.2, 1.19, turn));
    };
    noticeBoard(signs.fence, L.gate.x, b.minZ + 0.25, 0);
    noticeBoard(signs.bench, bench.position.x + BENCH_SIGN.dx, bench.position.z + BENCH_SIGN.dz, 0.35);
    // Just outside the gate, facing in: the walk stops at the gateway, and the sign admits it.
    noticeBoard({ text: "Mind the invisible wall" }, L.gate.x, b.maxZ + 1.6, Math.PI);
    // The snail's finish line (where it set off), on a small board just inside the gate, facing the garden.
    if (this.visitors.list.some((v) => v.id === "snail")) {
      const g = new THREE.Group();
      const board = signBoard(c, T.pixelTexture(T.notice(SNAIL_SIGN)), 1.0, 0.4);
      board.position.y = 0.62;
      g.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), mat(woodTex));
      post.position.set(0, 0.25, -0.05);
      g.add(post);
      g.position.set(L.gate.x + GATE_HALF + 1.7, 0, b.maxZ - 0.3);
      g.rotation.y = Math.PI - 0.25;
      this.scene.add(g);
      this.hitBoxes.push(boardBox(g.position.x, g.position.z, 1.0, 0.82, g.rotation.y));
    }
  }

  /** Small stakes, and the sleeping bloom's z's. */
  private buildStakes(c: BuildCtx) {
    const { L, mat, woodTex } = c;
    // Small stakes (#58, #61): one in an empty garden, and the first word's, forever, in front of its plant.
    const stake = (text: string, x: number, z: number, w: number, y: number, turn = 0) => {
      const g = new THREE.Group();
      const board = signBoard(c, T.pixelTexture(T.notice(text)), w, w * 0.4);
      board.position.y = y;
      g.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, y, 0.04), mat(woodTex));
      post.position.set(0, y / 2, -0.03);
      g.add(post);
      g.position.set(x, 0, z);
      g.rotation.y = turn;
      this.scene.add(g);
      this.hitBoxes.push(boardBox(x, z, w, y + w * 0.2, turn));
    };
    const first = L.beds[0];
    // Front right of the empty bed, where the card in the middle does not hide it.
    if (this.visitors.reserved && !L.plants.length) stake(this.visitors.reserved, first.x + first.w / 2 - 0.32, first.z + first.d / 2 - 0.3, 0.64, 0.56, -0.3);
    const keepsake = this.visitors.keepsake;
    const kept = keepsake ? L.plants.find((p) => p.id === keepsake.id) : undefined;
    if (keepsake && kept) {
      const bed = L.beds[kept.bed];
      stake(keepsake.text, kept.x, bed.z + bed.d / 2 + 0.16, 0.5, 0.36);
    }
    const sleeper = this.visitors.sleeper ? L.plants.find((p) => p.id === this.visitors.sleeper) : undefined;
    if (sleeper) {
      const top = BED_H + plantHeight(sleeper.growth);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([sleeper.x, top, sleeper.z, sleeper.x, top, sleeper.z, sleeper.x, top, sleeper.z]), 3));
      geo.setAttribute("phase", new THREE.BufferAttribute(new Float32Array([0, 1, 2]), 1));
      this.snore = new THREE.Points(
        geo,
        new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uMove: { value: this.reducedMotion ? 0 : 1 }, uScale: { value: 400 }, uMap: { value: T.pixelTexture(T.snoreZ()) } },
          vertexShader: SNORE_VERT,
          fragmentShader: SNORE_FRAG,
          transparent: true,
          depthWrite: false,
        }),
      );
      this.snore.frustumCulled = false;
      this.snore.visible = false;
      this.scene.add(this.snore);
    }
  }

  /** The sunflower that turns its back on you. */
  private buildSunflower(c: BuildCtx) {
    const { b } = c;
    // One sunflower in the far right corner, by the back fence. Unlike every other
    // sprite, it does not look at you: from the garden you see the back of its head,
    // and only from the back path, with the sun behind you, its face.
    const x = b.maxX - 1;
    const z = b.minZ + 0.45;
    const flowerMesh = sprites(T.pixelTexture(T.sunflower()), [{ x, y: 0, z, u: 0.5, v: 0, uw: 0.5, vh: 1, phase: 1.3, droop: 0, scale: 1, index: -5 }], 0.85, 1.7);
    this.hitBoxes.push(spriteBox("sunflower", x, 0, z, 0.24, 1.62));
    const geo = flowerMesh.geometry;
    this.flower = { x, z, uv: geo.getAttribute("iUv") as THREE.InstancedBufferAttribute, params: geo.getAttribute("iParams") as THREE.InstancedBufferAttribute, face: null };
    this.mats.add(flowerMesh.material);
    this.scene.add(flowerMesh);
  }

  /** Wild bits: tufts, flowers, mushrooms, stones. Thick outside, a few by the fence and pond. */
  private buildDecor(c: BuildCtx) {
    const { L, b, w, d, cx, cz, rand } = c;
    const decorTex = T.pixelTexture(T.decor());
    const decor: SpriteItem[] = [];
    const put = (x: number, z: number, kind: number, scale = 0.42, y = 0.01) => decor.push({ x, y, z, u: kind * 0.25, v: 0, uw: 0.25, vh: 1, phase: rand() * 6, droop: 0, scale, index: -4 });
    for (let i = 0; i < 420; i++) {
      const a = rand() * Math.PI * 2;
      const rad = Math.max(w, d) / 2 + 0.6 + rand() * 22;
      const x = cx + Math.cos(a) * rad;
      const z = cz + Math.sin(a) * rad;
      if (x > b.minX - 0.3 && x < b.maxX + 0.3 && z > b.minZ - 0.3 && z < b.maxZ + 0.3) continue;
      put(x, z, rand() < 0.62 ? 0 : rand() < 0.75 ? 1 : rand() < 0.5 ? 2 : 3, 0.42, -0.06);
    }
    for (let i = 0; i < Math.round((w + d) * 1.2); i++) {
      const t = rand();
      const side = Math.floor(rand() * 3);
      const [x, z] = side === 0 ? [b.minX + 0.25, b.minZ + t * d] : side === 1 ? [b.maxX - 0.25, b.minZ + t * d] : [b.minX + t * w, b.minZ + 0.25];
      put(x, z, rand() < 0.6 ? 0 : 1, 0.36);
    }
    for (let i = 0; i < 12; i++) {
      const a = rand() * Math.PI * 2;
      put(L.pond.x + Math.cos(a) * (L.pond.r + 0.3), L.pond.z + Math.sin(a) * (L.pond.r + 0.3), [3, 3, 0, 2][i % 4], 0.38);
    }
    for (const it of decor) {
      const k = DECOR_KINDS[Math.round(it.u * 4)];
      if (k) this.hitBoxes.push(spriteBox(k.id, it.x, Math.max(0, it.y), it.z, k.half * it.scale, k.top * it.scale));
    }
    const decorMesh = sprites(decorTex, decor);
    this.mats.add(decorMesh.material);
    this.scene.add(decorMesh);
  }

  /** Sky dome, far hills, clouds. */
  private buildSky(c: BuildCtx) {
    const { rand } = c;
    this.skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(240, 16, 12), this.skyMat);
    dome.renderOrder = -2;
    this.scene.add(dome);
    this.hillMat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, side: THREE.BackSide, fog: false, depthWrite: false });
    const hillRing = new THREE.Mesh(new THREE.CylinderGeometry(HILLS.radius, HILLS.radius, HILLS.height, 32, 1, true), this.hillMat);
    hillRing.position.y = HILLS.y;
    hillRing.renderOrder = -1;
    this.scene.add(hillRing);
    this.hillProfile = T.hillProfile();
    const cloudTex = T.pixelTexture(T.cloud());
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: cloudTex, alphaTest: 0.5, fog: false, depthWrite: false }));
      const a = (i / 9) * Math.PI * 2 + rand();
      c.position.set(Math.cos(a) * 130, 42 + rand() * 22, Math.sin(a) * 130);
      c.lookAt(0, c.position.y, 0);
      c.renderOrder = -1;
      this.clouds.push(c);
      this.scene.add(c);
    }
  }

  /** Fireflies at night, butterflies by day. */
  private buildCritters(c: BuildCtx) {
    const { L, b, w, d, rand } = c;
    const n = 70;
    const ff = new Float32Array(n * 3);
    const ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ff.set([b.minX + rand() * w, 0.3 + rand() * 1.4, b.minZ + rand() * d], i * 3);
      ph[i] = rand() * 6.28;
    }
    const ffGeo = new THREE.BufferGeometry();
    ffGeo.setAttribute("position", new THREE.BufferAttribute(ff, 3));
    ffGeo.setAttribute("phase", new THREE.BufferAttribute(ph, 1));
    this.fireflies = new THREE.Points(
      ffGeo,
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uMove: { value: 1 } },
        vertexShader: `attribute float phase; uniform float uTime; uniform float uMove; varying float vA;
          void main() { vec3 p = position + uMove * vec3(sin(uTime*0.5+phase)*0.6, sin(uTime*0.8+phase*2.0)*0.25, cos(uTime*0.4+phase)*0.6);
            vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(14.0 / -mv.z, 2.0, 6.0); vA = 0.5 + 0.5 * sin(uTime * 2.0 + phase * 3.0); }`,
        fragmentShader: `varying float vA; void main() { if (vA < 0.25) discard; gl_FragColor = vec4(1.0, 0.95, 0.45, 1.0) * vA; }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.scene.add(this.fireflies);
    const blooms = L.plants.filter((p) => p.stage === "bloom");
    for (let i = 0; i < Math.min(8, 2 + Math.floor(blooms.length / 15)); i++) {
      const home = blooms.length ? blooms[Math.floor(rand() * blooms.length)] : { x: L.gate.x + rand() * 4 - 2, z: L.gate.z - 3 };
      const tex = T.pixelTexture(T.butterfly([45, 200, 320, 15, 270][i % 5]));
      tex.repeat.set(0.5, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.11), new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
      this.basic.push(m.material);
      this.butterflies.push({ mesh: m, cx: home.x, cz: home.z, r: 0.5 + rand() * 1.2, ph: rand() * 6.28, tex });
      this.scene.add(m);
    }
  }

  /** The sun (or moon), and the marker over the selected plant. */
  private buildSun() {
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, depthWrite: false, transparent: true, alphaTest: 0.5 }));
    this.sun.scale.set(16, 16, 1);
    this.sun.renderOrder = -1;
    this.scene.add(this.sun);

    // Always on top: no depth test, and in the transparent pass with the highest
    // renderOrder, because the far hills and clouds draw in that pass after the
    // opaque one (and a mesh without a depth test writes no depth to stop them).
    this.marker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.28),
      new THREE.MeshBasicMaterial({ map: T.pixelTexture(T.marker()), alphaTest: 0.5, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  /** The visitor under a point on the canvas (CSS pixels), if any. */
  pickVisitor(cssX: number, cssY: number, cssW: number, cssH: number): VisitorView | null {
    return this.guests.pick(cssX, cssY, cssW, cssH);
  }

  /** Show a visitor's tag for a few seconds (after a tap). */
  tapVisitor(id: VisitorId) {
    this.guests.tap(id);
    this.sceneryTap = null;
  }

  /**
   * The scenery under a point on the canvas (CSS pixels), with its word, or
   * null. Ask only after the plants and visitors: they come first. One ray
   * through volumes built with the garden; it runs on a tap, not every frame.
   */
  pickScenery(cssX: number, cssY: number, cssW: number, cssH: number): { view: SceneryView; hit: SceneryHit } | null {
    const words = this.visitors.scenery;
    if (!words) return null;
    const c = this.camera;
    const d = this.tmp.set((cssX / cssW) * 2 - 1, -(cssY / cssH) * 2 + 1, 0.5).unproject(c).sub(c.position).normalize();
    const world: SceneryWorld = {
      boxes: this.hitBoxes,
      discs: this.hitDiscs,
      bounds: this.layout.bounds,
      far: FOG_FAR,
      hills: { radius: HILLS.radius, bottom: HILLS.y - HILLS.height / 2, top: HILLS.y + HILLS.height / 2, profile: this.hillProfile, rows: T.HILL_ROWS, repeat: HILLS.repeat },
      sunDir: this.sunDir,
      night: this.time === "night",
      sunRadius: 0.045,
      clouds: this.clouds.map((m) => m.position),
      cloudHalf: [8.8, 5],
    };
    const hit = pickScenery({ ox: c.position.x, oy: c.position.y, oz: c.position.z, dx: d.x, dy: d.y, dz: d.z }, world, (id) => !!words[id]);
    return hit ? { view: words[hit.id]!, hit } : null;
  }

  /** Show a scenery word's tag for a few seconds (after a tap). One tag at a time: a visitor's tapped tag goes. */
  tapScenery(s: { view: SceneryView; hit: SceneryHit }) {
    this.sceneryTap = { ...s, until: this.elapsed + 4 };
    this.guests.untap();
  }

  /** A visitor says something in a small bubble for a few seconds (the frog's croak). */
  say(id: VisitorId, text: string) {
    this.guests.say(id, text);
  }

  async loadPlants(): Promise<void> {
    const plants = this.layout.plants;
    if (!plants.length) return;
    this.cb.onProgress(0, plants.length);
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
      this.mats.add(m);
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
      geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(pos, 3));
      geo.setAttribute("iParams", new THREE.InstancedBufferAttribute(params, 4));
      geo.setAttribute("iCell", cellAttr);
      geo.instanceCount = idx.length;
      const center = new THREE.Vector3(bed.x, 0.9, bed.z);
      const radius = Math.hypot(bed.w / 2, bed.d / 2, 1.2) + 0.4;
      geo.boundingSphere = new THREE.Sphere(center, radius);
      const mesh = new THREE.Mesh(geo, mats[sheet]);
      this.scene.add(mesh);
      this.chunks.push({ mesh, center, radius });
      idx.forEach((pi, k) => (this.hiRef[pi] = { attr: cellAttr, i: k }));
    }
    this.setTime(this.time);
    this.cb.onProgress(plants.length, plants.length);
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
  private stream() {
    const pool = this.pool;
    if (!pool) return;
    const plants = this.layout.plants;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const order = plants.map((p, i) => {
      const dx = p.x - this.x;
      const dz = p.z - this.z;
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

  setTime(t: TimeOfDay) {
    this.time = t;
    const s = T.SKIES[t];
    const fog = new THREE.Color(s.fog);
    this.scene.fog = new THREE.Fog(fog, FOG_NEAR, FOG_FAR);
    this.skyMat.map?.dispose();
    const skyTex = T.pixelTexture(T.sky(s, t === "night"));
    // The gradient covers the upper half of the dome; below the horizon it clamps.
    skyTex.repeat.set(1, 2);
    skyTex.offset.set(0, -1);
    this.skyMat.map = skyTex;
    this.skyMat.needsUpdate = true;
    this.hillMat.map?.dispose();
    const hills = T.pixelTexture(T.hills(t === "night"), true);
    hills.repeat.set(HILLS.repeat, 1);
    this.hillMat.map = hills;
    this.hillMat.needsUpdate = true;
    const tint = new THREE.Color(...s.tint);
    for (const m of this.basic) m.color.copy(tint);
    for (const mat of [...this.mats, ...this.guests.mats]) {
      mat.uniforms.uTint.value.copy(tint);
      mat.uniforms.uFog.value.copy(fog);
    }
    for (const c of this.clouds) c.material.color.set(t === "night" ? 0x39406a : t === "dusk" ? 0xffd2c0 : 0xffffff);
    const dark = t !== "day";
    this.fireflies.visible = dark;
    this.lit.visible = dark;
    this.unlit.visible = !dark;
    for (const g of this.glows) g.visible = dark;
    this.sun.material.map?.dispose();
    this.sun.material.map = T.pixelTexture(T.sun(t));
    this.sun.material.needsUpdate = true;
    // High in the south-west by day, low in the west at dusk, the moon in the east at night.
    const [sx, sy, sz] = t === "day" ? [-0.5, 0.55, -0.7] : t === "dusk" ? [-0.95, 0.12, -0.3] : [0.6, 0.45, -0.65];
    this.sunDir.set(sx, sy, sz).normalize();
    for (const bf of this.butterflies) bf.mesh.visible = t !== "night";
    this.guests.setDark(dark);
    if (this.snore) this.snore.visible = t === "night";
    // The sunflower droops a little at dusk.
    this.flower.params.setY(0, t === "dusk" ? 0.14 : 0);
    this.flower.params.needsUpdate = true;
  }

  private detail: Detail = "normal";
  private size: [number, number] = [1, 1];

  setDetail(d: Detail) {
    this.detail = d;
    this.resize(...this.size);
  }

  resize(cssW: number, cssH: number) {
    this.size = [cssW, cssH];
    // A small framebuffer scaled up by CSS with hard pixels. A whole number of
    // device pixels per game pixel keeps every pixel the same size.
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.round((cssW * dpr) / DETAIL[this.detail]));
    this.renderer.setSize(Math.round((cssW * dpr) / scale), Math.round((cssH * dpr) / scale), false);
    this.camera.aspect = cssW / cssH;
    this.camera.updateProjectionMatrix();
    // Framebuffer pixels per metre at 1 m, for the z's point size.
    if (this.snore) this.snore.material.uniforms.uScale.value = Math.round((cssH * dpr) / scale) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  /**
   * The plant hears its name (#60): it perks up for a moment. On about one
   * listen in 30 its nearest neighbour perks up too, a little late, as if it
   * thought you called it. Nothing moves with reduced motion.
   */
  nod(p: PlacedPlant) {
    if (this.reducedMotion) return;
    const i = this.layout.plants.indexOf(p);
    if (i < 0) return;
    this.perk.i = i;
    this.perk.at = this.elapsed;
    this.perk.n = neighbourPerks() ? nearestPlant(this.layout.plants, i) : -1;
  }

  /** Grows the perking plants a little, then lets them settle. No allocations: it runs every frame. */
  private tickPerk() {
    const k = this.perk;
    if (k.i < 0) return;
    const t = this.elapsed - k.at;
    const done = t > Math.max(PERK.rise + PERK.fall, NEIGHBOUR.delay + NEIGHBOUR.rise + NEIGHBOUR.fall);
    const a = done ? 0 : perkEnvelope(t, PERK.rise, PERK.fall) * PERK_SCALE;
    const b = done || k.n < 0 ? 0 : perkEnvelope(t - NEIGHBOUR.delay, NEIGHBOUR.rise, NEIGHBOUR.fall) * PERK_SCALE;
    for (const m of this.plantMats) m.uniforms.uPerk.value.set(done ? -1 : k.i, a, done ? -1 : k.n, b);
    if (done) k.i = -1;
  }

  look(dx: number, dy: number) {
    this.glide = null;
    this.yaw -= dx * 0.0055;
    this.pitch = Math.max(-0.75, Math.min(0.5, this.pitch - dy * 0.004));
  }

  /** Walk straight ahead (or back, if negative) by `metres`. */
  step(metres: number) {
    this.glide = null;
    ({ x: this.x, z: this.z } = collide(this.layout, this.x - Math.sin(this.yaw) * metres, this.z - Math.cos(this.yaw) * metres));
  }

  turn(amount: number) {
    this.glide = null;
    this.yaw += amount;
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
      if (Math.abs(nx - sx) < rw && Math.abs(ny - sy) < rh && depth < bestDepth) {
        best = p;
        bestDepth = depth;
      }
    }
    return best;
  }

  select(p: PlacedPlant | null, walkTo = false) {
    this.selected = p;
    if (p) this.sceneryTap = null;
    const index = p ? this.layout.plants.indexOf(p) : -1;
    for (const mat of this.mats) mat.uniforms.uSelected.value = index;
    this.marker.visible = !!p;
    if (p && walkTo) {
      const v = viewpoint(this.layout, p);
      // Turn the short way round.
      let yaw = v.yaw;
      while (yaw - this.yaw > Math.PI) yaw -= Math.PI * 2;
      while (yaw - this.yaw < -Math.PI) yaw += Math.PI * 2;
      // Look at the flower head, not the stem, so the view stays nearly level
      // and the plant sits above the card at the bottom of the screen.
      const top = BED_H + plantHeight(p.growth);
      const pitch = Math.max(-0.18, Math.min(0.05, Math.atan2(top - EYE, Math.hypot(p.x - v.x, p.z - v.z))));
      if (this.reducedMotion) {
        [this.x, this.z, this.yaw, this.pitch] = [v.x, v.z, yaw, pitch];
      } else this.glide = { from: [this.x, this.z, this.yaw], to: [v.x, v.z, yaw], pitch: [this.pitch, pitch], t: 0 };
    }
    this.cb.onSelect(p);
  }

  start() {
    const loop = () => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.elapsed += dt;
      this.tick(dt);
    };
    loop();
  }

  private tick(dt: number) {
    const t = this.elapsed;
    const motion = this.reducedMotion ? 0 : 1;

    // Walking: forward is -z at yaw 0.
    const { move, run } = this.input;
    const len = Math.hypot(move.x, move.y);
    if (len > 0.01) {
      this.glide = null;
      const speed = WALK * (run ? 2 : 1) * Math.min(1, len);
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const nx = this.x + ((fx * move.y + -fz * move.x) / Math.max(1, len)) * speed * dt;
      const nz = this.z + ((fz * move.y + fx * move.x) / Math.max(1, len)) * speed * dt;
      ({ x: this.x, z: this.z } = collide(this.layout, nx, nz));
      this.bob += dt * speed * 3.2;
    }
    if (this.glide) {
      const g = this.glide;
      g.t = Math.min(1, g.t + dt / 0.9);
      const e = g.t < 0.5 ? 2 * g.t * g.t : 1 - (-2 * g.t + 2) ** 2 / 2;
      this.x = g.from[0] + (g.to[0] - g.from[0]) * e;
      this.z = g.from[1] + (g.to[1] - g.from[1]) * e;
      this.yaw = g.from[2] + (g.to[2] - g.from[2]) * e;
      this.pitch = g.pitch[0] + (g.pitch[1] - g.pitch[0]) * e;
      if (g.t >= 1) this.glide = null;
    }

    this.camera.position.set(this.x, EYE + Math.sin(this.bob) * 0.035 * motion, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.updateMatrixWorld();

    for (const mat of this.mats) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uSway.value = motion;
    }
    // Chunk culling: three skips beds outside the view (bounding spheres);
    // beds wholly inside the fog are skipped here.
    for (const c of this.chunks) c.mesh.visible = c.center.distanceTo(this.camera.position) - c.radius < FOG_FAR;
    if (this.pool && !this.streaming && (this.hungry || t - this.lastStream > 0.25)) {
      this.lastStream = t;
      this.stream();
    }
    this.fireflies.material.uniforms.uTime.value = t;
    this.fireflies.material.uniforms.uMove.value = motion;
    if (this.snore?.visible) this.snore.material.uniforms.uTime.value = t;
    this.tickPerk();
    if (motion) {
      this.water.offset.set((t * 0.02) % 1, Math.sin(t * 0.3) * 0.03);
      for (const c of this.clouds) c.position.applyAxisAngle(UP, dt * 0.004);
    }
    for (const bf of this.butterflies) {
      const a = t * 0.7 * motion + bf.ph;
      bf.mesh.position.set(bf.cx + Math.cos(a) * bf.r, 0.75 + Math.sin(a * 2.3) * 0.25, bf.cz + Math.sin(a * 1.3) * bf.r);
      bf.mesh.quaternion.copy(this.camera.quaternion);
      bf.tex.offset.x = motion && Math.sin(t * 18 + bf.ph) > 0 ? 0.5 : 0;
    }
    if (this.selected) {
      const p = this.selected;
      this.marker.position.set(p.x, BED_H + plantHeight(p.growth) + 0.32 + Math.sin(t * 3) * 0.05 * motion, p.z);
      this.marker.quaternion.copy(this.camera.quaternion);
    }

    // The sunflower shows its face only to someone standing in its sun (and never at night).
    const fl = this.flower;
    const face = sunflowerFaces(fl.x, fl.z, this.x, this.z, this.sunDir.x, this.sunDir.z, this.time === "night");
    if (face !== fl.face) {
      fl.face = face;
      fl.uv.setX(0, face ? 0 : 0.5);
      fl.uv.needsUpdate = true;
    }

    if (this.guests.any) this.guests.tick(dt, this.x, this.z);

    this.sun.position.copy(this.camera.position).addScaledVector(this.sunDir, SUN_DIST);
    this.renderer.render(this.scene, this.camera);
    this.labels();
  }

  /** Names over the nearest plants, as DOM text so they stay crisp and readable. */
  private labels() {
    const v = this.tmp;
    const near: { p: PlacedPlant; d: number }[] = [];
    for (const p of this.layout.plants) {
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < 3.2) near.push({ p, d });
    }
    near.sort((a, b) => a.d - b.d);
    const out: Label[] = [];
    for (const { p, d } of near.slice(0, 10)) {
      v.set(p.x, BED_H + plantHeight(p.growth) + 0.12, p.z).project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      out.push({ id: p.id, text: p.lemma, x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: 1 - d / 3.2 });
    }
    // A tapped scenery word (#74) is the one tag while it shows: no visitor tag beside it.
    let scenery: Label | null = null;
    const st = this.sceneryTap;
    if (st && this.elapsed > st.until) this.sceneryTap = null;
    else if (st) {
      const h = st.hit;
      if (h.follow === "sun") v.copy(this.camera.position).addScaledVector(this.sunDir, SUN_DIST).y += SUN_DIST * SUN_TAG;
      else if (h.follow) v.set(this.clouds[h.follow.cloud].position.x, h.y, this.clouds[h.follow.cloud].position.z);
      else v.set(h.x, h.y, h.z);
      v.project(this.camera);
      if (v.z <= 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1)
        scenery = { id: `scenery:${st.view.id}`, text: st.view.word, gloss: st.view.gloss, known: st.view.known, kind: "scenery", x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: 1 };
    }
    // What a visitor says (the frog's croak), then the scenery word, then one visitor tag at most.
    const { say, tag } = this.guests.labels(this.x, this.z, !this.sceneryTap);
    for (const l of [say, scenery, tag]) if (l) out.push(l);
    const key = out.map((l) => `${l.id}${l.text}${l.x.toFixed(3)}${l.y.toFixed(3)}${l.near.toFixed(2)}`).join();
    if (key !== this.lastLabels) {
      this.lastLabels = key;
      this.cb.onLabels(out);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        if (mat instanceof THREE.ShaderMaterial) for (const u of Object.values(mat.uniforms)) if (u.value instanceof THREE.Texture) u.value.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    // Some browsers throw here (WebGL turned off by policy) instead of returning null: same answer.
    return false;
  }
}
