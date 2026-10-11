// The walkable word garden, rendered the 90s way: a tiny framebuffer scaled
// up with hard pixels, unlit textures, fog, and flat sprite plants that turn
// to face you. Loaded only when the garden is opened.

import * as THREE from "three";
import { collide, viewpoint, type Layout, type PlacedPlant } from "./world";
import * as T from "./textures";
import { nearestPlant, NEIGHBOUR, neighbourPerks, PERK, PERK_SCALE, perkEnvelope, pickSigns, sunflowerFaces, type SignLine } from "./whimsy";
import { fencePickets, fencePoint, GATE_HALF, gnomePose, gnomeTag, snailPicket, type GnomePose, type VisitorId, type VisitorView } from "./visitors";
import { daily, rareDay } from "../ui/whimsy";

export type TimeOfDay = "day" | "dusk" | "night";

/** A name over a plant, a visitor's tag (kind "visitor"), or what a visitor says (kind "say"), in screen fractions. */
export interface Label {
  id: string;
  text: string;
  x: number;
  y: number;
  /** 0 to 1: how close (plant names), or how much of a visitor tag shows. */
  near: number;
  kind?: "visitor" | "say";
  gloss?: string;
  /** A visitor whose noun the learner knows: plant-label styling with a tiny leaf. */
  known?: boolean;
}

/** Who visits the walk today. */
export interface WalkVisitors {
  list: VisitorView[];
  /** Calendar days since the first review, or null for a new learner. */
  snailDay: number | null;
  /** The first word's plant and its stake text, e.g. "casa · 3 Oct" (#61). */
  keepsake?: { id: string; text: string } | null;
  /** The stake in an empty garden, e.g. "Reserved for Spanish words" (#58). */
  reserved?: string | null;
  /** Tonight's sleeping bloom (#62): three z's drift up from it at night. */
  sleeper?: string | null;
}

export interface SceneCallbacks {
  onSelect: (p: PlacedPlant | null) => void;
  onLabels: (labels: Label[]) => void;
  onProgress?: (done: number, total: number) => void;
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
/** Width of the framebuffer, in pixels, for each level of detail. */
/**
 * Normal renders at about screen resolution on most screens (the textures
 * keep the pixel-art look). Low uses big pixels, for slow devices.
 */
export const DETAIL = { normal: 2160, low: 760 } as const;
export type Detail = keyof typeof DETAIL;
const FOG_NEAR = 14;
const FOG_FAR = 46;
/** Plant sprites a little under life size: the tallest bloom stands about eye height. */
const PLANT_SCALE = 0.85;

const SPRITE_VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iUv;
  attribute vec4 iParams; // phase, droop, scale, index
  uniform float uTime;
  uniform float uSway;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uSelected;
  varying vec2 vUv;
  varying float vFog;
  varying float vSel;
  void main() {
    vec2 p = position.xy * iParams.z;
    float h = position.y / ${SPRITE_H.toFixed(1)};
    float a = iParams.y + uSway * sin(uTime * 1.4 + iParams.x) * 0.07 * h + uSway * sin(uTime * 3.1 + iParams.x * 2.0) * 0.015;
    p = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
    // Turn to face the camera around the vertical axis only, like Doom's sprites.
    vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
    vec3 world = iPos + right * p.x + vec3(0.0, p.y, 0.0);
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    vUv = iUv.xy + uv * iUv.zw;
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    vSel = abs(iParams.w - uSelected) < 0.5 ? 1.0 : 0.0;
  }
`;

const SPRITE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uFog;
  uniform vec3 uTint;
  uniform float uTime;
  varying vec2 vUv;
  varying float vFog;
  varying float vSel;
  void main() {
    vec4 c = texture2D(uMap, vUv);
    if (c.a < 0.5) discard;
    vec3 col = c.rgb * uTint;
    col = mix(col, min(vec3(1.0), col * 1.35 + 0.08), vSel * (0.6 + 0.4 * sin(uTime * 5.0)));
    gl_FragColor = vec4(mix(col, uFog, vFog), 1.0);
  }
`;


// Plants: like other sprites, but each samples its small sprite, or its
// full-size one once the streamer has put it in a pool slot (iCell.y >= 0).
const PLANT_VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iParams; // phase, droop, scale, index
  attribute vec2 iCell; // low cell, high slot (-1: none yet)
  uniform float uTime;
  uniform float uSway;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uSelected;
  uniform vec4 uPerk; // plant index, growth; neighbour index, growth
  uniform vec2 uLowSize;
  varying vec2 vLow;
  varying vec2 vHi;
  varying float vHasHi;
  varying float vFog;
  varying float vSel;
  vec2 cellUv(float idx, float cols, vec2 cell, vec2 size) {
    // Half a texel in from the edge, so nearest sampling never reads the neighbour.
    vec2 q = clamp(vec2(uv.x, 1.0 - uv.y), 0.5 / cell, 1.0 - 0.5 / cell);
    float r = floor((idx + 0.5) / cols);
    return (vec2(idx - r * cols, r) * cell + q * cell) / size;
  }
  void main() {
    // A plant that hears its name grows a few percent for a moment.
    float perk = (abs(iParams.w - uPerk.x) < 0.5 ? uPerk.y : 0.0) + (abs(iParams.w - uPerk.z) < 0.5 ? uPerk.w : 0.0);
    vec2 p = position.xy * iParams.z * (1.0 + perk);
    float h = position.y / ${SPRITE_H.toFixed(1)};
    float a = iParams.y + uSway * sin(uTime * 1.4 + iParams.x) * 0.07 * h + uSway * sin(uTime * 3.1 + iParams.x * 2.0) * 0.015;
    p = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
    vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
    vec3 world = iPos + right * p.x + vec3(0.0, p.y, 0.0);
    vec4 mv = viewMatrix * vec4(world, 1.0);
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
  uniform vec3 uFog;
  uniform vec3 uTint;
  uniform float uTime;
  varying vec2 vLow;
  varying vec2 vHi;
  varying float vHasHi;
  varying float vFog;
  varying float vSel;
  void main() {
    vec4 c = vHasHi > 0.5 ? texture2D(uHi, vHi) : texture2D(uLow, vLow);
    if (c.a < 0.5) discard;
    vec3 col = c.rgb * uTint;
    col = mix(col, min(vec3(1.0), col * 1.35 + 0.08), vSel * (0.6 + 0.4 * sin(uTime * 5.0)));
    gl_FragColor = vec4(mix(col, uFog, vFog), 1.0);
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
      uFogNear: { value: 10 },
      uFogFar: { value: 40 },
      uFog: { value: new THREE.Color() },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uSelected: { value: -1 },
    },
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG,
  });
}

/** Instanced camera-facing quads, bottom-centre anchored, from one atlas. */
type SpriteItem = { x: number; y: number; z: number; u: number; v: number; uw: number; vh: number; phase: number; droop: number; scale: number; index: number };
function sprites(map: THREE.Texture, items: SpriteItem[], w = SPRITE_W, h = SPRITE_H) {
  const quad = new THREE.PlaneGeometry(w, h);
  quad.translate(0, h / 2, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  geo.setAttribute("uv", quad.getAttribute("uv"));
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

/** One visitor's sprite. `hit`: the drawn part's middle height and half width and height, as fractions of the cell. `top`: where its tag sits. */
interface VisitorSprite {
  v: VisitorView;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  hit: [number, number, number];
  top: number;
  mesh: THREE.Mesh;
  pos: THREE.InstancedBufferAttribute;
  uv: THREE.InstancedBufferAttribute;
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

/** The moth's loop round its lantern (m), and the height of the middle of the lantern glass. */
const MOTH_R = 0.24;
const LANTERN_GLASS_Y = 1.02;
/** How far away a visitor's tag shows on approach (m). The gnome adds its own rules (gnomeTag). */
const TAG_RANGE: Partial<Record<VisitorId, number>> = { heron: 2.5, gnome: 7 };

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
  private clouds: THREE.Mesh[] = [];
  private marker!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private water!: THREE.Texture;
  private lit!: THREE.Mesh;
  private unlit!: THREE.Mesh;
  private glows: THREE.Object3D[] = [];
  private sun!: THREE.Sprite;
  private sunDir = new THREE.Vector3();
  /** The sunflower's position and frame (null: not chosen yet). */
  private flower = { x: 0, z: 0, uv: null as THREE.InstancedBufferAttribute | null, params: null as THREE.InstancedBufferAttribute | null, face: null as boolean | null };
  private selected: PlacedPlant | null = null;
  private time: TimeOfDay = "day";
  private lastLabels = "";
  private tmp = new THREE.Vector3();
  /** Visitor sprites: their own materials, tinted with the time of day but never swaying or selected. */
  private still = new Set<THREE.ShaderMaterial>();
  private visitorSprites: VisitorSprite[] = [];
  private tapped: { id: VisitorId; until: number } | null = null;
  /** A visitor's speech bubble (the frog's croak). */
  private saying: { id: VisitorId; text: string; until: number } | null = null;
  private catAwake = false;
  /** The bird hops away when you come close (t: 0..1 while hopping, 1 once gone) and comes back when you walk off. */
  private bird = { t: -1, dx: 0, dz: 0 };
  /** Lantern spots, for the moth. */
  private lanternSpots: [number, number][] = [];
  /** The lily pads, for the frog. */
  private pads: [number, number][] = [];
  /** The frog: puffed up until `croak` (elapsed s); asleep all day on about one day in 25. */
  private frog = { croak: 0, puffed: false, asleep: false };
  /** The gnome's pose, when it began to peek, its lantern (lit at dusk and night) and the lantern's small glow. */
  private gnome = { pose: "front" as GnomePose, peekAt: 0, lit: false, glow: null as THREE.Sprite | null };
  /** The heron: t is 0 at home, 1 one step back; dir is +1 while stepping back, -1 while stepping home. */
  private heron = { t: 0, dir: 0, tx: 0, tz: 0 };
  /** The moth's loop round its lantern: angle, radius, and a bump into the glass every 6 to 9 s. */
  private moth = { cx: 0, cz: 0, a: 0, r: MOTH_R, bump: -1, next: 7, n: 0 };
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

  constructor(canvas: HTMLCanvasElement, layout: Layout, cb: SceneCallbacks, reducedMotion: boolean, lang = "", visitors: WalkVisitors = { list: [], snailDay: null }) {
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
    this.build();
  }

  /** Builds the static world, then the plants (which need rasterising). */
  private build() {
    const L = this.layout;
    const b = L.bounds;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const mat = (tex: THREE.Texture, opts: THREE.MeshBasicMaterialParameters = {}) => {
      const m = new THREE.MeshBasicMaterial({ map: tex, ...opts });
      this.basic.push(m);
      return m;
    };

    // Ground: grass everywhere, a path surface inside the fence.
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

    // Raised beds: wooden sides, soil on top.
    const woodTex = T.pixelTexture(T.wood(), true);
    const soilTex = T.pixelTexture(T.soil(), true);
    for (const bed of L.beds) {
      const H = 0.28;
      const side = woodTex.clone();
      side.repeat.set(bed.w / 1.2, 1);
      const sideD = woodTex.clone();
      sideD.repeat.set(bed.d / 1.2, 1);
      const top = soilTex.clone();
      top.repeat.set(bed.w / 1.0, bed.d / 1.0);
      const box = new THREE.Mesh(new THREE.BoxGeometry(bed.w, H, bed.d), [mat(sideD), mat(sideD), mat(top), mat(top), mat(side), mat(side)]);
      box.position.set(bed.x, H / 2, bed.z);
      this.scene.add(box);
      // A sign on a post at the front-left corner, facing the path.
      const signTex = T.pixelTexture(T.sign(bed.label));
      // Just outside the front-left corner, turned toward the path, so it never hides a plant.
      const sx = bed.x - bed.w / 2 - 0.3;
      const sz = bed.z + bed.d / 2 + 0.3;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.3), mat(signTex, { side: THREE.DoubleSide }));
      board.position.set(sx, 0.78, sz);
      board.rotation.y = 0.5;
      this.scene.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.66, 0.06), mat(woodTex));
      post.position.set(sx - 0.02, 0.33, sz - 0.03);
      this.scene.add(post);
    }

    // Picket fence with a gap for the gate.
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
    };
    const gateHalf = 1.1;
    fence(b.minX, b.minZ, b.maxX, b.minZ);
    fence(b.minX, b.minZ, b.minX, b.maxZ);
    fence(b.maxX, b.minZ, b.maxX, b.maxZ);
    fence(b.minX, b.maxZ, L.gate.x - gateHalf, b.maxZ);
    fence(L.gate.x + gateHalf, b.maxZ, b.maxX, b.maxZ);
    // An arch over the gate.
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.1, 0.14), mat(woodTex));
      post.position.set(L.gate.x + s * gateHalf, 1.05, b.maxZ);
      this.scene.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(gateHalf * 2 + 0.5, 0.16, 0.2), mat(woodTex));
    beam.position.set(L.gate.x, 2.1, b.maxZ);
    this.scene.add(beam);

    // The pond by the gate, with lily pads.
    this.water = T.pixelTexture(T.water(), true);
    this.water.repeat.set(2, 2);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(L.pond.r, 20), mat(this.water));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(L.pond.x, 0.04, L.pond.z);
    this.scene.add(pond);
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
      this.scene.add(pad);
    }

    // Trees and bushes outside the fence.
    const treeTex = T.pixelTexture(T.trees());
    const trees: Parameters<typeof sprites>[1] = [];
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
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
    const treeMesh = sprites(treeTex, trees);
    this.mats.add(treeMesh.material);
    this.scene.add(treeMesh);

    // Lanterns where paths cross, and two by the gate. Lit at dusk and night.
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
    const lanternTex = T.pixelTexture(T.lantern());
    const lanternItems = (u: number): SpriteItem[] => [...spots.values()].map(([x, z]) => ({ x, y: 0, z, u, v: 0, uw: 0.5, vh: 1, phase: 0, droop: 0, scale: 1, index: -3 }));
    this.unlit = sprites(lanternTex, lanternItems(0), 0.42, 1.26);
    this.lit = sprites(lanternTex, lanternItems(0.5), 0.42, 1.26);
    for (const m of [this.unlit, this.lit]) {
      this.mats.add(m.material as THREE.ShaderMaterial);
      this.scene.add(m);
    }
    const glowTex = T.pixelTexture(T.glow());
    const additive = { map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false } as const;
    for (const [x, z] of spots.values()) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ ...additive }));
      halo.scale.set(1.1, 1.1, 1);
      halo.position.set(x, 1.12, z);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ ...additive, opacity: 0.55 }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.06, z);
      this.glows.push(halo, pool);
      this.scene.add(halo, pool);
    }

    // A bench by the pond, for sitting and admiring.
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

    // Two notice boards whose text changes each day: one on the back fence, one by the bench.
    const signs = pickSigns(this.lang);
    if (this.visitors.list.some((v) => v.id === "cat")) signs.bench = { text: "Bench: taken" };
    const noticeBoard = (line: SignLine, x: number, z: number, turn: number) => {
      const g = new THREE.Group();
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.48), mat(T.pixelTexture(T.notice(line.text)), { side: THREE.DoubleSide }));
      board.position.y = 0.95;
      if (line.upsideDown) board.rotation.z = Math.PI;
      g.add(board);
      for (const sx of [-0.45, 0.45]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.86, 0.06), mat(woodTex));
        post.position.set(sx, 0.43, -0.03);
        g.add(post);
      }
      g.position.set(x, 0, z);
      g.rotation.y = turn;
      this.scene.add(g);
    };
    noticeBoard(signs.fence, L.gate.x, b.minZ + 0.25, 0);
    noticeBoard(signs.bench, bench.position.x + 1.05, bench.position.z - 0.05, 0.35);
    // The snail's progress, on a small board just inside the gate, facing the garden.
    if (this.visitors.snailDay !== null && this.visitors.list.some((v) => v.id === "snail")) {
      const g = new THREE.Group();
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.32), mat(T.pixelTexture(T.notice(`Snail: day ${this.visitors.snailDay + 1}`)), { side: THREE.DoubleSide }));
      board.position.y = 0.62;
      g.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), mat(woodTex));
      post.position.set(0, 0.25, 0.03);
      g.add(post);
      g.position.set(L.gate.x + GATE_HALF + 1.7, 0, b.maxZ - 0.3);
      g.rotation.y = Math.PI - 0.25;
      this.scene.add(g);
    }
    this.buildVisitors(bench.position);

    // Small stakes (#58, #61): one in an empty garden, and the first word's, forever, in front of its plant.
    const stake = (text: string, x: number, z: number, w: number, y: number, turn = 0) => {
      const g = new THREE.Group();
      const board = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.4), mat(T.pixelTexture(T.notice(text)), { side: THREE.DoubleSide }));
      board.position.y = y;
      g.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, y, 0.04), mat(woodTex));
      post.position.set(0, y / 2, -0.03);
      g.add(post);
      g.position.set(x, 0, z);
      g.rotation.y = turn;
      this.scene.add(g);
    };
    const first = L.beds[0];
    // Front right of the empty bed, where the card in the middle does not hide it.
    if (this.visitors.reserved && !L.plants.length) stake(this.visitors.reserved, first.x + first.w / 2 - 0.32, first.z + first.d / 2 - 0.3, 0.64, 0.56, -0.3);
    const kept = this.visitors.keepsake ? L.plants.find((p) => p.id === this.visitors.keepsake!.id) : undefined;
    if (kept) {
      const bed = L.beds[kept.bed];
      stake(this.visitors.keepsake!.text, kept.x, bed.z + bed.d / 2 + 0.16, 0.5, 0.36);
    }
    const sleeper = this.visitors.sleeper ? L.plants.find((p) => p.id === this.visitors.sleeper) : undefined;
    if (sleeper) {
      const top = 0.28 + ((14 + 120 * sleeper.growth) / T.VIEW_H) * SPRITE_H * PLANT_SCALE;
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

    // One sunflower in the far right corner, by the back fence. Unlike every other
    // sprite, it does not look at you: from the garden you see the back of its head,
    // and only from the back path, with the sun behind you, its face.
    this.flower.x = b.maxX - 1;
    this.flower.z = b.minZ + 0.45;
    const flowerMesh = sprites(T.pixelTexture(T.sunflower()), [{ x: this.flower.x, y: 0, z: this.flower.z, u: 0.5, v: 0, uw: 0.5, vh: 1, phase: 1.3, droop: 0, scale: 1, index: -5 }], 0.85, 1.7);
    this.flower.uv = flowerMesh.geometry.getAttribute("iUv") as THREE.InstancedBufferAttribute;
    this.flower.params = flowerMesh.geometry.getAttribute("iParams") as THREE.InstancedBufferAttribute;
    this.mats.add(flowerMesh.material);
    this.scene.add(flowerMesh);

    // Wild bits: tufts, flowers, mushrooms, stones. Thick outside, a few by the fence and pond.
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
    const decorMesh = sprites(decorTex, decor);
    this.mats.add(decorMesh.material);
    this.scene.add(decorMesh);

    // Sky dome, far hills, clouds.
    this.skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(240, 16, 12), this.skyMat);
    dome.renderOrder = -2;
    this.scene.add(dome);
    this.hillMat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, side: THREE.BackSide, fog: false, depthWrite: false });
    const hillRing = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 34, 32, 1, true), this.hillMat);
    hillRing.position.y = 10;
    hillRing.renderOrder = -1;
    this.scene.add(hillRing);
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

    // Fireflies at night, butterflies by day.
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

    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, depthWrite: false, transparent: true, alphaTest: 0.5 }));
    this.sun.scale.set(16, 16, 1);
    this.sun.renderOrder = -1;
    this.scene.add(this.sun);

    this.marker = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), new THREE.MeshBasicMaterial({ map: T.pixelTexture(T.marker()), alphaTest: 0.5, depthTest: false }));
    this.marker.renderOrder = 5;
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.setTime(this.time);
  }

  /**
   * Today's visitors (garden/visitors.ts): the snail on the fence rail, the cat
   * on the bench, a toadstool by a bed, a bird on a sign or the fence, the gnome
   * at a bed corner, the frog on a lily pad, the heron at the pond's edge, the
   * moth at a lantern. One small texture for all of them; each is a
   * one-instance sprite mesh.
   */
  private buildVisitors(bench: THREE.Vector3) {
    if (!this.visitors.list.length) return;
    const L = this.layout;
    const b = L.bounds;
    const tex = T.pixelTexture(T.visitors());
    const RAIL = 0.53; // the top of the fence's upper rail
    const cellU = 1 / T.VISITOR_CELLS;
    // The frog's pad: the one nearest the gate, where you come in.
    const pad = this.pads.reduce((a, p) => (Math.hypot(p[0] - L.gate.x, p[1] - L.gate.z) < Math.hypot(a[0] - L.gate.x, a[1] - L.gate.z) ? p : a), this.pads[0]);
    for (const v of this.visitors.list) {
      let x: number, y: number, z: number, cell: number, size: number;
      // Defaults for the drawn part (the lower half of the cell) and the tag just above it.
      let hit: [number, number, number] = [0.2, 0.4, 0.3];
      let top = v.id === "cat" ? 0.45 : 0.55;
      if (v.id === "frog") {
        this.frog.asleep = rareDay(25, "frog-asleep");
        [x, y, z] = [pad[0], 0.075, pad[1]];
        [cell, size, hit, top] = [this.frog.asleep ? T.VISITOR_CELL.frogAsleep : T.VISITOR_CELL.frog, 0.42, [0.17, 0.25, 0.2], 0.42];
      } else if (v.id === "gnome") {
        // A bed corner chosen by the date; never the front-left one, where the bed's sign is.
        const bed = daily(L.beds, "visitor-gnome-bed");
        const [sx, sz] = daily(
          [
            [1, 1],
            [1, -1],
            [-1, -1],
          ],
          "visitor-gnome-corner",
        );
        [x, y, z] = [bed.x + sx * (bed.w / 2 + 0.2), 0.0, bed.z + sz * (bed.d / 2 + 0.2)];
        [cell, size, hit, top] = [T.VISITOR_CELL.gnomeFront, 0.56, [0.36, 0.25, 0.38], 0.78];
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.pixelTexture(T.glow()), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        glow.scale.set(0.3, 0.3, 1);
        glow.visible = false;
        this.gnome.glow = glow;
        this.scene.add(glow);
      } else if (v.id === "heron") {
        // On the stones at the pond's edge, a little round from the frog's pad, looking at it.
        const a = Math.atan2(pad[1] - L.pond.z, pad[0] - L.pond.x) - 0.6;
        [x, y, z] = [L.pond.x + Math.cos(a) * (L.pond.r + 0.12), 0.0, L.pond.z + Math.sin(a) * (L.pond.r + 0.12)];
        [cell, size, hit, top] = [T.VISITOR_CELL.heron, 1.05, [0.44, 0.22, 0.44], 0.92];
      } else if (v.id === "moth") {
        const [lx, lz] = daily(this.lanternSpots, "visitor-moth-lantern");
        [this.moth.cx, this.moth.cz] = [lx, lz];
        // With reduced motion it sits on the lantern's roof; otherwise tick() moves it.
        [x, y, z] = [lx, 1.235, lz];
        [cell, size, hit, top] = [this.reducedMotion ? T.VISITOR_CELL.mothClosed : T.VISITOR_CELL.mothOpen, 0.36, [0.1, 0.3, 0.2], 0.3];
      } else if (v.id === "snail") {
        const p = fencePoint(L, snailPicket(this.visitors.snailDay ?? 0, fencePickets(L)));
        // A few centimetres inside the fence, so it sits on the rail and not in it.
        [x, y, z] = [p.x + p.dz * 0.06, RAIL, p.z - p.dx * 0.06];
        [cell, size] = [T.VISITOR_CELL.snail, 0.4];
      } else if (v.id === "cat") {
        [x, y, z] = [bench.x + 0.18, 0.45, bench.z + 0.02];
        [cell, size] = [T.VISITOR_CELL.catAsleep, 0.95];
      } else if (v.id === "toadstool") {
        const bed = daily(L.beds, "visitor-toadstool-bed");
        const along = daily([-0.3, -0.1, 0.15, 0.35], "visitor-toadstool-z");
        [x, y, z] = [bed.x + bed.w / 2 + 0.16, 0.0, bed.z + along * bed.d];
        [cell, size] = [T.VISITOR_CELL.toadstool, 0.6];
      } else {
        // On a sign or the fence rail.
        const first = L.beds[0];
        const spots: [number, number, number][] = [
          [L.gate.x, 1.19, b.minZ + 0.25],
          [first.x - first.w / 2 - 0.3, 0.93, first.z + first.d / 2 + 0.3],
          [b.maxX - 0.06, RAIL, (b.maxZ + first.z) / 2],
          [b.minX + 0.06, RAIL, first.z - 1],
        ];
        if (!this.visitors.list.some((o) => o.id === "cat")) spots.push([bench.x + 1.05, 1.19, bench.z - 0.05]);
        [x, y, z] = daily(spots, "visitor-bird-spot");
        [cell, size] = [T.VISITOR_CELL.bird, 0.5];
      }
      const mesh = sprites(tex, [{ x, y, z, u: cell * cellU, v: 0, uw: cellU, vh: 1, phase: 0, droop: 0, scale: 1, index: -6 }], size, size);
      const m = mesh.material as THREE.ShaderMaterial;
      m.uniforms.uSway.value = 0;
      m.uniforms.uFogNear.value = FOG_NEAR;
      m.uniforms.uFogFar.value = FOG_FAR;
      this.still.add(m);
      this.scene.add(mesh);
      const pos = mesh.geometry.getAttribute("iPos") as THREE.InstancedBufferAttribute;
      const uv = mesh.geometry.getAttribute("iUv") as THREE.InstancedBufferAttribute;
      this.visitorSprites.push({ v, x, y, z, w: size, h: size, hit, top, mesh, pos, uv });
    }
  }

  private setCell(s: VisitorSprite, cell: number) {
    const u = cell / T.VISITOR_CELLS;
    if (s.uv.getX(0) === u) return;
    s.uv.setX(0, u);
    s.uv.needsUpdate = true;
  }

  private gnomeCell(s: VisitorSprite) {
    const g = this.gnome;
    this.setCell(s, (g.lit ? T.VISITOR_CELL.gnomeFrontLit : T.VISITOR_CELL.gnomeFront) + ["front", "side", "back", "peek"].indexOf(g.pose));
  }

  /** The visitor under a point on the canvas (CSS pixels), if any. */
  pickVisitor(cssX: number, cssY: number, cssW: number, cssH: number): VisitorView | null {
    const nx = (cssX / cssW) * 2 - 1;
    const ny = -(cssY / cssH) * 2 + 1;
    const ty = Math.tan((this.camera.fov * Math.PI) / 360);
    const tx = ty * this.camera.aspect;
    let best: VisitorView | null = null;
    let bestDepth = Infinity;
    for (const s of this.visitorSprites) {
      if (!s.mesh.visible) continue;
      const [cy, hx, hy] = s.hit;
      this.tmp.set(s.pos.getX(0), s.pos.getY(0) + s.h * cy, s.pos.getZ(0)).applyMatrix4(this.camera.matrixWorldInverse);
      const depth = -this.tmp.z;
      if (depth < 0.2 || depth > 14) continue;
      const rw = Math.max(0.04, (s.w * hx) / depth / tx);
      const rh = Math.max(0.05, (s.h * hy) / depth / ty);
      if (Math.abs(nx - this.tmp.x / depth / tx) < rw && Math.abs(ny - this.tmp.y / depth / ty) < rh && depth < bestDepth) {
        best = s.v;
        bestDepth = depth;
      }
    }
    return best;
  }

  /** Show a visitor's tag for a few seconds (after a tap). */
  tapVisitor(id: VisitorId) {
    this.tapped = { id, until: this.elapsed + 4 };
  }

  /** A visitor says something in a small bubble for a few seconds (the frog's croak). */
  say(id: VisitorId, text: string) {
    this.saying = { id, text, until: this.elapsed + 3.2 };
    if (this.tapped?.id === id) this.tapped = null;
    if (id !== "frog" || this.frog.asleep) return;
    // Its throat puffs up while it croaks.
    this.frog.croak = this.elapsed + 0.7;
    this.frog.puffed = true;
    const s = this.visitorSprites.find((o) => o.v.id === "frog");
    if (s) this.setCell(s, T.VISITOR_CELL.frogCroak);
  }

  /**
   * Visitors react to you: the cat opens one eye, the bird hops away, the gnome
   * turns its back, the heron steps back. The moth goes round its lantern. No
   * allocations here: it runs every frame.
   */
  private tickVisitors(dt: number) {
    for (const s of this.visitorSprites) {
      const d = Math.hypot(s.x - this.x, s.z - this.z);
      if (s.v.id === "gnome") {
        const g = this.gnome;
        const pose = gnomePose(d);
        if (pose !== g.pose) {
          if (pose === "peek") g.peekAt = this.elapsed;
          g.pose = pose;
          this.gnomeCell(s);
        }
        if (g.glow?.visible) {
          // The lantern hangs 7.5 px right of the middle and 4.5 px up in its cell, on the side facing the camera.
          const e = this.camera.matrixWorldInverse.elements;
          const k = 1 / Math.max(1e-6, Math.hypot(e[0], e[8]));
          const off = (7.5 / 32) * s.w;
          g.glow.position.set(s.x + e[0] * k * off, s.y + (4.5 / 32) * s.h, s.z + e[8] * k * off);
        }
      } else if (s.v.id === "frog") {
        if (this.frog.puffed && this.elapsed > this.frog.croak) {
          this.frog.puffed = false;
          this.setCell(s, T.VISITOR_CELL.frog);
        }
      } else if (s.v.id === "heron") {
        // One slow step back when you come within 1.5 m; back home once you are well away. With reduced motion it just stays.
        const hr = this.heron;
        if (this.reducedMotion) continue;
        if (hr.dir === 0 && hr.t === 0 && d < 1.5) {
          const k = 0.5 / Math.max(d, 0.01);
          ({ x: hr.tx, z: hr.tz } = collide(this.layout, s.x + (s.x - this.x) * k, s.z + (s.z - this.z) * k, 0.12));
          hr.dir = 1;
        } else if (hr.dir === 0 && hr.t === 1 && d > 4) hr.dir = -1;
        if (hr.dir !== 0) {
          hr.t = Math.max(0, Math.min(1, hr.t + (hr.dir * dt) / 1.4));
          const e = hr.t * hr.t * (3 - 2 * hr.t);
          s.pos.setXYZ(0, s.x + (hr.tx - s.x) * e, s.y, s.z + (hr.tz - s.z) * e);
          s.pos.needsUpdate = true;
          this.setCell(s, hr.t > 0.15 && hr.t < 0.85 ? T.VISITOR_CELL.heronStep : T.VISITOR_CELL.heron);
          if (hr.t === 0 || hr.t === 1) hr.dir = 0;
        }
      } else if (s.v.id === "moth") {
        if (!s.mesh.visible || this.reducedMotion) continue;
        const m = this.moth;
        let resting = false;
        if (m.bump < 0) {
          m.a += dt * 2.4;
          m.r += (MOTH_R - m.r) * Math.min(1, dt * 3);
          if (this.elapsed > m.next) m.bump = 0;
        } else {
          // Into the glass, 10 cm back, a short rest, then round again.
          m.bump += dt;
          const k = m.bump;
          if (k < 0.35) {
            m.a += dt * 1.2;
            m.r = MOTH_R + (0.09 - MOTH_R) * (k / 0.35);
          } else if (k < 0.55) m.r = 0.09 + 0.1 * ((k - 0.35) / 0.2);
          else if (k < 1.25) resting = true;
          else {
            m.bump = -1;
            m.n++;
            const f = Math.sin(m.n * 12.9898) * 43758.5453;
            m.next = this.elapsed + 6 + 3 * (f - Math.floor(f));
          }
        }
        s.pos.setXYZ(0, m.cx + Math.cos(m.a) * m.r, LANTERN_GLASS_Y - 0.03 + Math.sin(m.a * 2.3) * 0.05, m.cz + Math.sin(m.a) * m.r);
        s.pos.needsUpdate = true;
        this.setCell(s, !resting && Math.sin(this.elapsed * 28) > 0 ? T.VISITOR_CELL.mothOpen : T.VISITOR_CELL.mothClosed);
      } else if (s.v.id === "cat") {
        const awake = d < 2.4;
        if (awake !== this.catAwake) {
          this.catAwake = awake;
          s.uv.setX(0, (awake ? T.VISITOR_CELL.catAwake : T.VISITOR_CELL.catAsleep) / T.VISITOR_CELLS);
          s.uv.needsUpdate = true;
        }
      } else if (s.v.id === "bird") {
        const bd = this.bird;
        if (bd.t < 0 && d < 1) {
          // Away from you, a little to the side.
          const k = 1 / Math.max(d, 0.01);
          bd.dx = (s.x - this.x) * k;
          bd.dz = (s.z - this.z) * k;
          bd.t = this.reducedMotion ? 1 : 0;
          if (this.tapped?.id === "bird") this.tapped = null;
          s.uv.setX(0, T.VISITOR_CELL.birdHop / T.VISITOR_CELLS);
          s.uv.needsUpdate = true;
        }
        if (bd.t >= 0 && bd.t < 1) {
          bd.t = Math.min(1, bd.t + dt / 0.7);
          const e = bd.t * 2.2;
          s.pos.setXYZ(0, s.x + bd.dx * e - bd.dz * e * 0.3, s.y + Math.sin(Math.min(1, bd.t * 1.6) * Math.PI) * 0.25 + bd.t * bd.t * 1.6, s.z + bd.dz * e + bd.dx * e * 0.3);
          s.pos.needsUpdate = true;
        }
        if (bd.t >= 1 && s.mesh.visible) s.mesh.visible = false;
        // It comes back to the same spot once you are well away.
        if (bd.t >= 1 && d > 6) {
          bd.t = -1;
          s.pos.setXYZ(0, s.x, s.y, s.z);
          s.pos.needsUpdate = true;
          s.uv.setX(0, T.VISITOR_CELL.bird / T.VISITOR_CELLS);
          s.uv.needsUpdate = true;
          s.mesh.visible = true;
        }
      }
    }
    if (this.tapped && this.elapsed > this.tapped.until) this.tapped = null;
    if (this.saying && this.elapsed > this.saying.until) this.saying = null;
  }

  async loadPlants(): Promise<void> {
    const plants = this.layout.plants;
    if (!plants.length) return;
    this.cb.onProgress?.(0, plants.length);
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
    const quad = new THREE.PlaneGeometry(SPRITE_W, SPRITE_H);
    quad.translate(0, SPRITE_H / 2, 0);
    const baseY = 0.28 - (4 / T.VIEW_H) * SPRITE_H * PLANT_SCALE; // the SVG frame has 4 units below the base
    for (const idx of groups.values()) {
      const sheet = Math.floor(idx[0] / T.LOW_PER_SHEET);
      const bed = this.layout.beds[plants[idx[0]].bed];
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = quad.index;
      geo.setAttribute("position", quad.getAttribute("position"));
      geo.setAttribute("uv", quad.getAttribute("uv"));
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
    this.cb.onProgress?.(plants.length, plants.length);
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
    hills.repeat.set(4, 1);
    this.hillMat.map = hills;
    this.hillMat.needsUpdate = true;
    const tint = new THREE.Color(...s.tint);
    for (const m of this.basic) m.color.copy(tint);
    for (const mat of [...this.mats, ...this.still]) {
      mat.uniforms.uTint.value.copy(tint);
      mat.uniforms.uFog.value.copy(fog);
      mat.uniforms.uFogNear.value = FOG_NEAR;
      mat.uniforms.uFogFar.value = FOG_FAR;
    }
    for (const c of this.clouds) (c.material as THREE.MeshBasicMaterial).color.set(t === "night" ? 0x39406a : t === "dusk" ? 0xffd2c0 : 0xffffff);
    this.fireflies.visible = t !== "day";
    const dark = t !== "day";
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
    // The frog and the moth come out at dusk; the gnome lights its lantern when the others come on.
    this.gnome.lit = dark;
    for (const s of this.visitorSprites) {
      if (s.v.id === "frog" || s.v.id === "moth") s.mesh.visible = dark;
      // The moth is always in its lantern's light.
      if (s.v.id === "moth") (s.mesh.material as THREE.ShaderMaterial).uniforms.uTint.value.setRGB(0.85, 0.8, 0.7);
      if (s.v.id === "gnome") this.gnomeCell(s);
    }
    if (this.gnome.glow) this.gnome.glow.visible = dark;
    if (this.snore) this.snore.visible = t === "night";
    if (!dark && this.saying?.id === "frog") this.saying = null;
    // The sunflower droops a little at dusk.
    const fp = this.flower.params;
    if (fp) {
      fp.setY(0, t === "dusk" ? 0.14 : 0);
      fp.needsUpdate = true;
    }
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
    const halfW = Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect;
    for (const p of this.layout.plants) {
      const h = ((14 + 120 * p.growth) / T.VIEW_H) * SPRITE_H * PLANT_SCALE;
      v.set(p.x, 0.28 + h * 0.55, p.z).applyMatrix4(this.camera.matrixWorldInverse);
      const depth = -v.z;
      if (depth < 0.2 || depth > 30) continue;
      const sx = v.x / depth / halfW;
      const sy = v.y / depth / Math.tan((this.camera.fov * Math.PI) / 360);
      // Hit box: a bit wider than the stem, as tall as the plant.
      const rw = Math.max(0.03, 0.22 / depth / halfW);
      const rh = Math.max(0.04, (h * 0.6) / depth / Math.tan((this.camera.fov * Math.PI) / 360));
      if (Math.abs(nx - sx) < rw && Math.abs(ny - sy) < rh && depth < bestDepth) {
        best = p;
        bestDepth = depth;
      }
    }
    return best;
  }

  select(p: PlacedPlant | null, walkTo = false) {
    this.selected = p;
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
      const top = 0.28 + ((14 + 120 * p.growth) / T.VIEW_H) * SPRITE_H * PLANT_SCALE;
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
      for (const c of this.clouds) c.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.004);
    }
    for (const bf of this.butterflies) {
      const a = t * 0.7 * motion + bf.ph;
      bf.mesh.position.set(bf.cx + Math.cos(a) * bf.r, 0.75 + Math.sin(a * 2.3) * 0.25, bf.cz + Math.sin(a * 1.3) * bf.r);
      bf.mesh.quaternion.copy(this.camera.quaternion);
      bf.tex.offset.x = motion && Math.sin(t * 18 + bf.ph) > 0 ? 0.5 : 0;
    }
    if (this.selected) {
      const p = this.selected;
      const h = ((14 + 120 * p.growth) / T.VIEW_H) * SPRITE_H * PLANT_SCALE;
      this.marker.position.set(p.x, 0.28 + h + 0.32 + Math.sin(t * 3) * 0.05 * motion, p.z);
      this.marker.quaternion.copy(this.camera.quaternion);
    }

    // The sunflower shows its face only to someone standing in its sun (and never at night).
    const fl = this.flower;
    const face = sunflowerFaces(fl.x, fl.z, this.x, this.z, this.sunDir.x, this.sunDir.z, this.time === "night");
    if (fl.uv && face !== fl.face) {
      fl.face = face;
      fl.uv.setX(0, face ? 0 : 0.5);
      fl.uv.needsUpdate = true;
    }

    if (this.visitorSprites.length) this.tickVisitors(dt);

    this.sun.position.copy(this.camera.position).addScaledVector(this.sunDir, 200);
    this.renderer.render(this.scene, this.camera);
    this.labels();
  }

  /** Projects the point just above a visitor's drawn part into `tmp`. False when it is out of view. */
  private projectTag(s: VisitorSprite): boolean {
    const v = this.tmp.set(s.pos.getX(0), s.pos.getY(0) + s.h * s.top, s.pos.getZ(0)).project(this.camera);
    return v.z <= 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1;
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
      const h = ((14 + 120 * p.growth) / T.VIEW_H) * SPRITE_H * PLANT_SCALE;
      v.set(p.x, 0.28 + h + 0.12, p.z).project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      out.push({ id: p.id, text: p.lemma, x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: 1 - d / 3.2 });
    }
    // What a visitor says (the frog's croak) takes the place of its tag.
    const say = this.saying;
    let sayer: VisitorSprite | null = null;
    if (say) for (const s of this.visitorSprites) if (s.v.id === say.id && s.mesh.visible) sayer = s;
    if (say && sayer && this.projectTag(sayer)) out.push({ id: `say:${say.id}`, text: say.text, kind: "say", x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: 1 });
    // One visitor tag at most: the one you tapped, or the nearest in view that shows its name on approach
    // (within 1.5 m; the heron 2.5 m; the gnome while it faces you).
    let tag: VisitorSprite | null = null;
    let tagShow = 1;
    let nearD = Infinity;
    for (const s of this.visitorSprites) {
      if (!s.v.word || !s.mesh.visible || s === sayer) continue;
      if (this.tapped?.id === s.v.id) {
        if (this.projectTag(s)) [tag, tagShow] = [s, 1];
        break;
      }
      if (s.v.tag !== "approach") continue;
      const d = Math.hypot(s.x - this.x, s.z - this.z);
      const show = s.v.id === "gnome" ? gnomeTag(d, this.elapsed - this.gnome.peekAt) : 1;
      if (show > 0 && d < (TAG_RANGE[s.v.id] ?? 1.5) && d < nearD && this.projectTag(s)) [tag, tagShow, nearD] = [s, show, d];
    }
    if (tag && this.projectTag(tag)) out.push({ id: `visitor:${tag.v.id}`, text: tag.v.word!, gloss: tag.v.gloss, known: tag.v.known, kind: "visitor", x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: tagShow });
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
    return false;
  }
}
