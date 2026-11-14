// Shared ground the garden's parts (#323) are built on: the camera-facing
// sprite technique every part uses (billboard(), shade(), sprites()), the
// sizes and fog distances that technique needs, a plant's drawn height, a
// sign's board, and the BuildCtx every part's build() takes. Imports nothing
// from scene.ts or any part — scene.ts and every part import from here
// instead, so there is one direction of dependency, never a cycle.

import * as THREE from "three";
import type { DeckLang } from "../deck/langs";
import { stemHeight } from "../ui/plant";
import { GRAIN, PAPER } from "./paper";
import { castsShadow, LIGHT, LIT } from "./sceneLight";
import type { HitBox, HitDisc } from "./scenery";
import * as T from "./textures";
import type { Layout } from "./world";

export const SPRITE_W = 1.0;
export const SPRITE_H = 2.0;
export const FOG_NEAR = 14;
export const FOG_FAR = 46;
/** Plant sprites a little under life size: the tallest bloom stands about eye height. */
export const PLANT_SCALE = 0.85;

/** A plant sprite's drawn height in metres, from its height in SVG units (stemHeight, ui/plant.tsx). */
export function plantHeight(growth: number): number {
  return (stemHeight(growth) / T.VIEW_H) * SPRITE_H * PLANT_SCALE;
}

// The vertex shader part every sprite shares: the fog and selection inputs,
// and billboard(), which sways the quad in the wind, leans it by `droop`, then
// turns it to face the camera around the vertical axis only, like Doom's
// sprites. It returns the view-space position. vPaper: where on its sheet of
// paper the point is (SHADE), fixed to the cut-out as it sways and turns.
// In the shadow map the view is the sun's, so there the cut-out faces the sun
// (sceneLight.ts); vSunAt is the point in that pose, where SHADE looks up its
// shadow. vFront: 1 when the eye sees the side the sun is on, -1 the other.
// vFoot: how high over its foot the point is (m).
export const BILLBOARD = /* glsl */ `
  uniform float uTime;
  uniform float uSway;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uSelected;
  uniform vec3 uSunRight;
  varying float vFog;
  varying float vSel;
  varying vec2 vPaper;
  varying vec3 vAt;
  varying vec3 vSunAt;
  varying float vFront;
  varying float vFoot;
  vec4 billboard(vec3 at, vec2 p, float phase, float droop) {
    // Each cut-out from its own part of the sheet.
    vPaper = p + vec2(phase * 2.3, phase * 1.7);
    vFoot = p.y;
    float h = position.y / ${SPRITE_H.toFixed(1)};
    float a = droop + uSway * sin(uTime * 1.4 + phase) * 0.07 * h + uSway * sin(uTime * 3.1 + phase * 2.0) * 0.015;
    p = vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
    vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
    vec3 world = at + right * p.x + vec3(0.0, p.y, 0.0);
    vAt = world;
    vSunAt = at + uSunRight * p.x + vec3(0.0, p.y, 0.0);
    vFront = dot(right, uSunRight);
    return viewMatrix * vec4(world, 1.0);
  }
`;

// The fragment shader part every sprite shares: the paper's grain
// (paper.ts), the light (sceneLight.ts) and time-of-day tint, a pulse when
// selected, and fog. A cut-out seen from its shaded side takes less of the sun,
// and a little of it shines through the paper in the paper's own colour. Its
// foot, where it stands, is a little darker.
export const SHADE = /* glsl */ `
  uniform vec3 uFog;
  uniform vec3 uTint;
  uniform float uTime;
  varying float vFog;
  varying float vSel;
  varying vec2 vPaper;
  varying vec3 vAt;
  varying vec3 vSunAt;
  varying float vFront;
  varying float vFoot;
  ${PAPER}
  ${LIGHT}
  vec4 shade(vec4 c) {
    vec3 paperC = c.rgb * paper(vPaper);
    float sun = sunShadow(vSunAt + uSunDir * 0.08);
    float front = smoothstep(-0.3, 0.3, vFront);
    vec3 col = paperC * uTint * mix(fillLight(0.0), uKey, sun * mix(0.4, 1.0, front));
    col += paperC * paperC * uTint * uKey * sun * (1.0 - front) * 0.35;
    col += paperC * lampLight(vAt, vec3(0.0));
    col *= mix(0.78, 1.0, smoothstep(0.0, 0.12, vFoot));
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

// A sprite lying flat (the fish in the pond): centred on iPos, its +x turned
// toward (cos a, sin a) on the ground, where a is iParams.y.
const LYING_VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iUv;
  attribute vec4 iParams; // phase, heading, scale, index
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uSelected;
  varying vec2 vUv;
  varying float vFog;
  varying float vSel;
  varying vec2 vPaper;
  varying vec3 vAt;
  varying vec3 vSunAt;
  varying float vFront;
  varying float vFoot;
  void main() {
    vec2 p = position.xy * iParams.z;
    vPaper = p;
    float a = iParams.y;
    // Local y goes to the far side, so the quad's front faces up.
    vAt = iPos + vec3(p.x * cos(a) + p.y * sin(a), 0.0, p.x * sin(a) - p.y * cos(a));
    // Lying down, it faces the sky: lit from the front, with no foot.
    vSunAt = vAt;
    vFront = 1.0;
    vFoot = 1.0;
    vec4 mv = viewMatrix * vec4(vAt, 1.0);
    gl_Position = projectionMatrix * mv;
    vUv = iUv.xy + uv * iUv.zw;
    vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    vSel = abs(iParams.w - uSelected) < 0.5 ? 1.0 : 0.0;
  }
`;

// A premultiplied map (textures.ts cutoutTexture) has its colour divided by its alpha again.
// SPRITE_DEPTH: the same cut-out in the sun's shadow map.
const SPRITE_DEPTH = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  void main() {
    if (texture2D(uMap, vUv).a < 0.5) discard;
    gl_FragColor = vec4(1.0);
  }
`;
const SPRITE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  ${SHADE}
  void main() {
    vec4 c = texture2D(uMap, vUv);
    if (c.a < 0.5) discard;
    #ifdef PREMULTIPLIED
    c.rgb /= c.a;
    #endif
    gl_FragColor = shade(c);
  }
`;

function spriteMaterial(map: THREE.Texture, vertexShader: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    // Read from the map, so the shader and the map's upload can't disagree.
    defines: map.premultiplyAlpha ? { PREMULTIPLIED: "" } : {},
    uniforms: {
      uMap: { value: map },
      uTime: { value: 0 },
      uSway: { value: 1 },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
      uFog: { value: new THREE.Color() },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uSelected: { value: -1 },
      uGrain: GRAIN,
      ...LIT,
    },
    vertexShader,
    fragmentShader: SPRITE_FRAG,
  });
}

/** A w×h quad standing on its bottom edge. */
export function standingQuad(w: number, h: number): THREE.PlaneGeometry {
  const quad = new THREE.PlaneGeometry(w, h);
  quad.translate(0, h / 2, 0);
  return quad;
}

/** Instanced geometry that shares `quad`'s vertices; the caller adds the per-instance attributes. */
export function instanced(quad: THREE.PlaneGeometry): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  geo.setAttribute("uv", quad.getAttribute("uv"));
  return geo;
}

/** Instanced camera-facing quads, bottom-centre anchored, from one atlas, casting shadows. `lying`: flat on the ground instead, centred, turned by `droop` (LYING_VERT), casting none. */
export type SpriteItem = { x: number; y: number; z: number; u: number; v: number; uw: number; vh: number; phase: number; droop: number; scale: number; index: number };
export function sprites(map: THREE.Texture, items: SpriteItem[], w = SPRITE_W, h = SPRITE_H, lying = false) {
  const geo = instanced(lying ? new THREE.PlaneGeometry(w, h) : standingQuad(w, h));
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
  const mesh = new THREE.Mesh(geo, spriteMaterial(map, lying ? LYING_VERT : SPRITE_VERT));
  mesh.frustumCulled = false;
  if (!lying) castsShadow(mesh, SPRITE_DEPTH);
  return mesh;
}

/**
 * What every part of the world (#323) is built with: GardenScene.build() makes
 * one of these and passes it, in a fixed order, to each part's build(). The
 * parts push their own tap targets and materials into the shared scene,
 * hitBoxes, hitDiscs and mats straight away, rather than handing them back to
 * be merged.
 */
export interface BuildCtx {
  L: Layout;
  /** The course language, for what is written in the world (#650). */
  lang: DeckLang;
  b: Layout["bounds"];
  /** The garden inside the fence: width, depth and middle. */
  w: number;
  d: number;
  cx: number;
  cz: number;
  /** A lit material (sceneLight.ts litMaterial) that follows the time of day's tint. */
  mat: (tex: THREE.Texture, opts?: THREE.MeshBasicMaterialParameters) => THREE.MeshBasicMaterial;
  woodTex: THREE.Texture;
  /** The screen smooths shapes' edges (#1106), so a cut-out's edges can be smooth too (alphaToCoverage). */
  msaa: boolean;
  /** One random sequence for the whole world, so it is laid out the same every time. */
  rand: () => number;
  scene: THREE.Scene;
  /** What a tap can meet (scenery.ts): every part adds its own boxes and discs here as it builds. */
  hitBoxes: HitBox[];
  hitDiscs: HitDisc[];
  /** Every sprite shader material a part makes: GardenScene.tick sets their time and sway uniforms, and tints them for the time of day. */
  mats: Set<THREE.ShaderMaterial>;
  /** Every plain (unlit, untinted-by-default) material a part makes outside of `mat()`, so GardenScene.tint can still tint it for the time of day. */
  basic: THREE.MeshBasicMaterial[];
}

/**
 * For what never moves once built: its matrices are set once here, not recomposed
 * on every frame (#571). Anything that moves, turns or scales later must not be still.
 */
export function still<O extends THREE.Object3D>(o: O): O {
  o.traverse((p) => {
    p.matrixAutoUpdate = false;
    p.updateMatrix();
  });
  return o;
}

/** Metres of wood one repeat of the wood texture covers along the grain. The beds' sides repeat it as often (scenePlants.ts). */
const WOOD_TILE = 1.2;
/** A face of wood narrower than this (m) is one piece with no plank gap: a post, a leg, a board's edge. */
const ONE_PLANK = 0.25;

/**
 * A box of wood (#1091), for `c.mat(c.woodTex)`. On each face the grain runs along the longer side; a face at least
 * ONE_PLANK across shows the texture's two planks, a narrower one the middle of one plank.
 */
export function woodBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const box = new THREE.BoxGeometry(w, h, d);
  const uv = box.getAttribute("uv");
  // Faces +x, -x, +y, -y, +z, -z, with four corners each: each face's size along its u and its v, in metres.
  const sizes = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  // Across the grain: the whole texture (two planks), or a band inside its lower plank, clear of its gaps and light edge (textures.ts wood).
  const across = (t: number, size: number) => (size < ONE_PLANK ? 0.1 + t * 0.3 : t);
  sizes.forEach(([fu, fv], f) => {
    for (let i = f * 4; i < f * 4 + 4; i++) {
      const [u, v] = [uv.getX(i), uv.getY(i)];
      if (fu >= fv) uv.setXY(i, (u * fu) / WOOD_TILE, across(v, fv));
      else uv.setXY(i, (v * fv) / WOOD_TILE, across(u, fu));
    }
  });
  return box;
}

/** A sign's board: the text on the front only, plain wood on the back (a two-sided text plane shows the text mirrored from behind). */
export function signBoard(c: BuildCtx, tex: THREE.Texture, w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), c.mat(tex)));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), c.mat(c.woodTex));
  back.rotation.y = Math.PI;
  g.add(back);
  return g;
}
