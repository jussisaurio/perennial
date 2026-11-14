// The light on the paper garden (#1164): one warm key light from the sun (the
// moon at night), a cool fill where it does not reach, soft shadows, and the
// lanterns' own warm light after dark. It is drawn like a photo of a small
// paper model on a table under one lamp.
//
// Every material reads one set of uniforms (LIT), set by Sun each frame. The
// sun's shadow map covers a square of ground ahead of the eye. A standing
// cut-out turns to face the camera, but in the shadow map it faces the sun, so
// its shadow keeps its shape as you turn; it looks its shadows up in that same
// pose. Low detail draws no shadows (Sun.setShadows): the faces still turn from
// the light, and the lanterns still glow.

import * as THREE from "three";
import type { Lamps } from "./lanterns";
import { after, paperMaterial, type StockName } from "./paper";

/** Texels on a side of the shadow map. */
const SHADOW_PX = 2048;
/** Half the side of the square of ground the shadow map covers (m), and how far ahead of the eye its middle is. Its far edge fades out before the fog is thick (FOG_FAR). */
const HALF = 20;
const AHEAD = 11;
/** How far back along the light the shadow camera stands from the middle of its square (m), and how deep it sees. */
const BACK = 60;
const DEPTH = 120;
/** The sun's lowest angle for light and shadows (its sine): a shadow is at most five times as long as its thing is tall, or at dusk one hedge would shade the whole garden. */
const LOW_SUN = 0.2;
/** Lanterns lit at once, nearest the eye first. A garden has two per bed: the ones out of reach of their light are far in the fog. */
const MAX_LAMPS = 8;
/** How far a lantern's light reaches (m), and its height over its foot: the flame. */
const LAMP_REACH = 4.5;
const FLAME = 1.1;

/**
 * The light every lit material reads, one uniform object for all of them (as paper.ts GRAIN): Sun sets them before each
 * frame. uKey and uFill: how much the lit and the unlit side are lightened, in each colour, times the time of day's tint.
 */
export const LIT = {
  uSunMap: { value: null as THREE.DepthTexture | null },
  uSunMatrix: { value: new THREE.Matrix4() },
  uSunOn: { value: 0 },
  /** Toward the light. */
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  /** Across the light, level: a standing cut-out's width runs along it in the shadow map. */
  uSunRight: { value: new THREE.Vector3(1, 0, 0) },
  uKey: { value: new THREE.Color(1, 1, 1) },
  uFill: { value: new THREE.Color(1, 1, 1) },
  /** Each lit lantern's flame, nearest first; uLampCount of them are in use. */
  uLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) },
  uLampCount: { value: 0 },
  /** A lantern's colour, times how strong lanterns are at this time of day. */
  uLamp: { value: new THREE.Color() },
};

/**
 * GLSL: the light. sunShadow(at): how much sun reaches a point in the world, 0 to 1, soft at the edges (9 filtered
 * taps of the shadow map), and 1 off the map or with no shadows. fillLight(up): the shade's light on a face that turns
 * `up` (1) to the sky or down (-1). lampLight(at, n): the lanterns' light on a point whose face turns to `n` (zero: a
 * cut-out, which takes light from both sides).
 */
export const LIGHT = /* glsl */ `
  uniform sampler2DShadow uSunMap;
  uniform mat4 uSunMatrix;
  uniform float uSunOn;
  uniform vec3 uSunDir;
  uniform vec3 uKey;
  uniform vec3 uFill;
  uniform vec3 uLamps[${MAX_LAMPS}];
  uniform int uLampCount;
  uniform vec3 uLamp;
  // The sky lights the shade from above; the sunlit ground bounces a warmer light into faces that turn from the sky,
  // so a wall in shade stays its own colour, not grey.
  vec3 fillLight(float up) {
    return uFill * mix(vec3(1.1, 1.02, 0.88), vec3(1.0), clamp(0.5 + 0.5 * up, 0.0, 1.0));
  }
  float sunShadow(vec3 at) {
    if (uSunOn < 0.5) return 1.0;
    vec3 s = (uSunMatrix * vec4(at, 1.0)).xyz;
    float edge = max(abs(s.x - 0.5), abs(s.y - 0.5));
    if (edge > 0.5 || s.z > 1.0) return 1.0;
    // 3 by 3 taps a texel and a half apart: with the hardware's own filtering, a soft edge about 4 texels (8 cm) wide.
    float tx = 1.5 / ${SHADOW_PX.toFixed(1)};
    float sum = 0.0;
    for (int i = -1; i <= 1; i++)
      for (int j = -1; j <= 1; j++)
        sum += texture(uSunMap, vec3(s.xy + vec2(i, j) * tx, s.z - 0.0004));
    return mix(sum / 9.0, 1.0, smoothstep(0.42, 0.5, edge));
  }
  vec3 lampLight(vec3 at, vec3 n) {
    float sum = 0.0;
    for (int i = 0; i < ${MAX_LAMPS}; i++) {
      if (i >= uLampCount) break;
      vec3 d = uLamps[i] - at;
      float dd = dot(d, d);
      // Falls off with distance, and to nothing at LAMP_REACH.
      float w = clamp(1.0 - dd / ${(LAMP_REACH * LAMP_REACH).toFixed(2)}, 0.0, 1.0);
      w = w * w / (1.0 + 0.6 * dd);
      // Half its light on a face turned away: the paper around a lantern takes light from every side.
      float facing = dot(n, n) > 0.0 ? 0.5 + 0.5 * dot(n, d) * inversesqrt(dd) : 1.0;
      sum += w * facing;
    }
    return sum * uLamp;
  }
`;

/** Built-in materials made lit (litMaterial), so Sun.casters knows them. */
const litMats = new WeakSet<THREE.Material>();

/**
 * Lights a built-in unlit material (after its paper: paper.ts). Its face turns toward the light or away from it, and
 * takes the shadows and the lanterns. A face is its normal where the mesh has normals, or else the plane its pixels lie
 * in. One function for every material, so they share their programs.
 */
function onLight(s: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(s.uniforms, LIT);
  s.vertexShader =
    "varying vec3 vLitN;\n" +
    after(
      s.vertexShader,
      "#include <project_vertex>",
      `#ifdef USE_INSTANCING
      vLitN = mat3(modelMatrix) * mat3(instanceMatrix) * normal;
      #else
      vLitN = mat3(modelMatrix) * normal;
      #endif`,
    );
  // vPaper: the point in the world (paper.ts).
  s.fragmentShader =
    `varying vec3 vLitN;\n${LIGHT}\n` +
    after(
      s.fragmentShader,
      "#include <envmap_fragment>",
      `vec3 litN = dot(vLitN, vLitN) > 1e-6 ? normalize(vLitN) : normalize(cross(dFdx(vPaper), dFdy(vPaper)));
      if (dot(litN, cameraPosition - vPaper) < 0.0) litN = -litN;
      float litFace = dot(litN, uSunDir);
      float litSun = smoothstep(0.0, 0.2, litFace) * (0.8 + 0.2 * litFace) * sunShadow(vPaper + litN * 0.03);
      // The lanterns light the paper's own colour, not the time of day's tint (diffuse).
      vec3 litPaper = outgoingLight / max(diffuse, vec3(0.01));
      outgoingLight = outgoingLight * mix(fillLight(litN.y), uKey, litSun) + litPaper * lampLight(vPaper, litN);`,
    );
}

/** `m`, made of paper of the stock `stock` (paper.ts) and lit (onLight). */
export function litMaterial<M extends THREE.Material>(m: M, stock: StockName): M {
  paperMaterial(m, stock);
  const paper = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    paper.call(m, s, r);
    onLight(s);
  };
  litMats.add(m);
  return m;
}

/** Each cut-out material's material in the shadow map (castsShadow), one for all the meshes that share it. */
const depthOf = new WeakMap<THREE.ShaderMaterial, THREE.ShaderMaterial>();

/**
 * Makes a cut-out's mesh cast a shadow: drawn into the shadow map from both sides, by its own vertex shader (which
 * turns it to face the light there) and `fragmentShader`, which discards where the paper is cut away.
 */
export function castsShadow(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>, fragmentShader: string) {
  const m = mesh.material;
  let depth = depthOf.get(m);
  if (!depth) {
    m.shadowSide = THREE.DoubleSide;
    depth = new THREE.ShaderMaterial({ defines: m.defines, uniforms: m.uniforms, vertexShader: m.vertexShader, fragmentShader });
    depthOf.set(m, depth);
  }
  mesh.castShadow = true;
  mesh.customDepthMaterial = depth;
}

/** A thing lower than this (m) casts no shadow: the ground, a path, a mat, a pond. */
const FLAT = 0.1;

/** The sun (or the moon) and the lanterns, as LIT gives them to every material. */
export class Sun {
  /** In the scene. */
  readonly light = new THREE.DirectionalLight();
  /** A light like this one, for compiling shaders off the scene (GardenScene.warm): which lights there are is part of each program's key. */
  readonly standIn = new THREE.DirectionalLight();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly focus = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly near = new Float32Array(MAX_LAMPS);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    // Always on, with the light always casting: the programs are keyed by both, so they stay the same at each detail.
    // setShadows says whether the map is drawn.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    // On every layer, as a light is only counted for a camera on one of its layers: GardenScene.drawOnce draws on a layer of its own.
    for (const l of [this.light, this.standIn]) {
      l.castShadow = true;
      l.layers.enableAll();
    }
    const l = this.light;
    l.shadow.mapSize.set(SHADOW_PX, SHADOW_PX);
    Object.assign(l.shadow.camera, { left: -HALF, right: HALF, top: HALF, bottom: -HALF, near: 1, far: DEPTH });
    l.shadow.camera.updateProjectionMatrix();
    scene.add(l);
    // The last walk's light is gone with its context.
    LIT.uSunMatrix.value = l.shadow.matrix;
    LIT.uSunMap.value = null;
    LIT.uSunOn.value = 0;
    LIT.uLampCount.value = 0;
  }

  /** Draw shadows, or not (low detail). No shadow map is made until they are first wanted. */
  setShadows(on: boolean) {
    const shadow = this.light.shadow;
    // The map three would make (WebGLShadowMap), with one channel of colour where three makes four, which nothing reads.
    if (on && !shadow.map) {
      const map = new THREE.WebGLRenderTarget(SHADOW_PX, SHADOW_PX, { format: THREE.RedFormat, generateMipmaps: false });
      // 16 bits: a step of 2 mm over DEPTH, finer than the bias, at half the memory of 32.
      const depth = new THREE.DepthTexture(SHADOW_PX, SHADOW_PX, THREE.UnsignedShortType);
      depth.format = THREE.DepthFormat;
      depth.compareFunction = THREE.LessEqualCompare;
      depth.minFilter = depth.magFilter = THREE.LinearFilter;
      map.depthTexture = depth;
      shadow.map = map;
    }
    this.renderer.shadowMap.autoUpdate = on;
    LIT.uSunOn.value = on ? 1 : 0;
    LIT.uSunMap.value = on && shadow.map ? (shadow.map.depthTexture as THREE.DepthTexture) : null;
  }

  /** Every mesh under `root` all of lit materials (litMaterial) that stands up casts a shadow. Again after more is built. */
  casters(root: THREE.Object3D) {
    const box = new THREE.Box3();
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const ms: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
      if (!ms.every((m) => litMats.has(m) && !m.transparent)) return;
      box.makeEmpty().expandByObject(o, false);
      if (box.max.y - box.min.y >= FLAT) o.castShadow = true;
    });
  }

  /**
   * Before each frame: the light from `sunDir` (toward the sun or moon), its shadow map over the ground ahead of
   * `camera`, and the lit lanterns nearest it. `key`, `fill`: the time of day's (LIT); the key fades into the fill as the
   * sun goes down. `lamp`: a lantern's light now. Allocates nothing.
   */
  place(camera: THREE.Camera, sunDir: THREE.Vector3, key: THREE.Color, fill: THREE.Color, lamp: THREE.Color, lamps: Lamps) {
    const L = LIT.uSunDir.value.copy(sunDir);
    if (L.y < LOW_SUN) {
      const k = Math.sqrt((1 - LOW_SUN * LOW_SUN) / (L.x * L.x + L.z * L.z));
      L.set(L.x * k, LOW_SUN, L.z * k);
    }
    const R = LIT.uSunRight.value.set(L.z, 0, -L.x).normalize();
    LIT.uFill.value.copy(fill);
    LIT.uKey.value.copy(fill).lerp(key, THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.1));
    LIT.uLamp.value.copy(lamp);

    // The square's middle, ahead of the eye on the ground; moved in whole texels across the light, so its shadows
    // do not crawl as you walk.
    const e = camera.matrixWorld.elements;
    const f = this.focus.set(-e[8], 0, -e[10]);
    const len = Math.hypot(f.x, f.z);
    // Looking straight down or up: no way is ahead.
    f.multiplyScalar(len > 1e-6 ? AHEAD / len : 0).add(camera.position).setY(0);
    const U = this.up.crossVectors(L, R);
    const texel = (2 * HALF) / SHADOW_PX;
    const a = Math.round(f.dot(R) / texel) * texel;
    const b = Math.round(f.dot(U) / texel) * texel;
    const c = f.dot(L);
    const t = this.light.target.position;
    t.copy(R).multiplyScalar(a).addScaledVector(U, b).addScaledVector(L, c);
    this.light.position.copy(t).addScaledVector(L, BACK);
    this.light.updateMatrixWorld();
    this.light.target.updateMatrixWorld();

    // The nearest lit lanterns, by insertion into a short sorted list.
    const lit = LIT.uLamps.value;
    const near = this.near;
    let n = 0;
    for (let i = 0; i < lamps.at.length; i++) {
      if (!lamps.lit(i)) continue;
      const [x, y, z] = lamps.at[i];
      const d = (x - camera.position.x) ** 2 + (z - camera.position.z) ** 2;
      if (n === MAX_LAMPS && d >= near[n - 1]) continue;
      let j = Math.min(n, MAX_LAMPS - 1);
      for (; j > 0 && near[j - 1] > d; j--) {
        near[j] = near[j - 1];
        lit[j].copy(lit[j - 1]);
      }
      near[j] = d;
      lit[j].set(x, y + FLAME, z);
      n = Math.min(n + 1, MAX_LAMPS);
    }
    LIT.uLampCount.value = n;
  }
}
