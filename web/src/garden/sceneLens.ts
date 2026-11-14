// The lens (#1164): the garden is drawn as a photo of a small paper model. The scene is drawn into a target with room
// above white, then onto the canvas as a camera would take it: the far garden a little out of focus, as in a close
// photo of a model; a soft glow round what is bright; a soft shoulder, so a bright light rolls off instead of clipping
// flat; a little more contrast; the time of day's grade; a soft dark edge; and a little noise, so the sky and the fog
// do not show bands. A walk that opens at low detail has no lens: the scene goes straight onto the canvas, as CI's
// software WebGL is slow at each pass and each big target (#793).

import * as THREE from "three";

/** Up to here a colour is shown as drawn; above it, it rolls off toward white. Paper in the sun (about 1) stays near white. */
const KNEE = 0.8;
/** How much of a photo's S-curve: the dark a little darker, the light a little lighter. */
const CONTRAST = 0.15;
/** How much darker the corners are than the middle. */
const VIGNETTE = 0.12;
/** Sharp out to here (m): the garden you walk in. Further out the blur grows as a lens's does, toward all of BLUR far off. */
const FOCUS = 8;
/** Nearer than this (m), the blur grows toward the eye: a leaf you brush past. */
const NEAR = 0.5;
/**
 * The blur's radius at its most, as a share of the screen's height. Small: from the lookout the far house must still read
 * as a house, and its light as a light at night (garden-play.md). At 0.003 the house is a smudge at night.
 */
const BLUR = 0.002;
/** How much of the glow is in the picture. */
const GLOW = 0.05;
/** The glow's levels, each half the size of the one before, from half the screen's size. */
const LEVELS = 6;

/** The blur's taps, in a disc of radius 1: the middle, a ring of 5 and a ring of 10, so the taps are about evenly spread. */
const DISC = [
  [0, 0],
  ...Array.from({ length: 5 }, (_, i) => [0.5 * Math.cos((i * 2 * Math.PI) / 5), 0.5 * Math.sin((i * 2 * Math.PI) / 5)]),
  ...Array.from({ length: 10 }, (_, i) => [Math.cos(((i + 0.5) * 2 * Math.PI) / 10), Math.sin(((i + 0.5) * 2 * Math.PI) / 10)]),
];

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** GLSL: blurAt(uv) is how out of focus the scene is at `uv`: 0 in focus, toward 1 far off, toward -1 near the eye. */
const BLUR_AT = /* glsl */ `
uniform sampler2D uDepth;
uniform float uNear;
uniform float uFar;
float blurAt(vec2 uv) {
  float z = texture2D(uDepth, uv).r;
  float d = uNear * uFar / (uFar - z * (uFar - uNear));
  return d < ${NEAR.toFixed(2)} ? d / ${NEAR.toFixed(2)} - 1.0 : max(0.0, 1.0 - ${FOCUS.toFixed(1)} / d);
}`;

/** The scene at half size: its colour, and in alpha the blur of whichever of its four pixels is most out of focus. */
const HALF = /* glsl */ `
uniform sampler2D uScene;
uniform vec2 uTexel;
varying vec2 vUv;
${BLUR_AT}
void main() {
  vec2 t = 0.5 * uTexel;
  vec4 b = vec4(blurAt(vUv - t), blurAt(vUv + vec2(t.x, -t.y)), blurAt(vUv + vec2(-t.x, t.y)), blurAt(vUv + t));
  float near = min(min(b.x, b.y), min(b.z, b.w));
  float far = max(max(b.x, b.y), max(b.z, b.w));
  // One filtered read is the four pixels' mean.
  gl_FragColor = vec4(texture2D(uScene, vUv).rgb, -near > far ? near : far);
}`;

/**
 * The blur, at half size, as a lens spreads each point into a disc. Behind, a point is spread only as far as both it
 * and the point it lands on are out of focus, so a sharp thing does not bleed into the blur behind it. In front, a
 * point spreads over what is behind it, as a near leaf does (Jasper Flick, "Depth of Field", Catlike Coding).
 */
const BOKEH = /* glsl */ `
uniform sampler2D uHalf;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
const vec2 DISC[${DISC.length}] = vec2[](${DISC.map(([x, y]) => `vec2(${x.toFixed(4)}, ${y.toFixed(4)})`).join(", ")});
// How much a point spread blur pixels reaches r pixels away: all of it inside, fading over the last pixel.
float reach(float blur, float r) { return clamp(blur - r + 1.0, 0.0, 1.0); }
void main() {
  float mid = texture2D(uHalf, vUv).a;
  vec3 back = vec3(0.0), front = vec3(0.0);
  float backW = 0.0, frontW = 0.0;
  for (int i = 0; i < ${DISC.length}; i++) {
    vec2 o = DISC[i] * uRadius;
    float r = length(o);
    vec4 s = texture2D(uHalf, vUv + o * uTexel);
    float bw = reach(max(0.0, min(mid, s.a)) * uRadius, r);
    // Only a point blurred by more than about a pixel covers what is behind it: else every sharp pixel would count
    // as in front of itself and take the half-size blur.
    float n = -s.a * uRadius;
    float fw = reach(n, r) * smoothstep(0.25, 0.75, n);
    back += s.rgb * bw;
    backW += bw;
    front += s.rgb * fw;
    frontW += fw;
  }
  // backW is at least 1: the middle tap always reaches itself. With no frontW, cover is 0 and front is not used.
  back /= backW;
  front /= max(frontW, 1e-4);
  float cover = min(1.0, frontW * 3.14159 / ${DISC.length.toFixed(1)});
  gl_FragColor = vec4(mix(back, front, cover), cover);
}`;

/** The glow's way down: a level at half the size of the one before, by 13 taps, so it stays smooth (Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare", 2014). */
const DOWN = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 at(float x, float y) { return texture2D(uSrc, vUv + vec2(x, y) * uTexel).rgb; }
void main() {
  vec3 c = at(0.0, 0.0) * 0.125;
  c += (at(-2.0, 2.0) + at(2.0, 2.0) + at(-2.0, -2.0) + at(2.0, -2.0)) * 0.03125;
  c += (at(0.0, 2.0) + at(-2.0, 0.0) + at(2.0, 0.0) + at(0.0, -2.0)) * 0.0625;
  c += (at(-1.0, 1.0) + at(1.0, 1.0) + at(-1.0, -1.0) + at(1.0, -1.0)) * 0.125;
  gl_FragColor = vec4(c, 1.0);
}`;

/** The glow's way up: the smaller level, spread by a 3×3 tent, added to the larger one. */
const UP = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 at(float x, float y) { return texture2D(uSrc, vUv + vec2(x, y) * uTexel).rgb; }
void main() {
  vec3 c = at(0.0, 0.0) * 4.0;
  c += (at(0.0, 1.0) + at(-1.0, 0.0) + at(1.0, 0.0) + at(0.0, -1.0)) * 2.0;
  c += at(-1.0, 1.0) + at(1.0, 1.0) + at(-1.0, -1.0) + at(1.0, -1.0);
  gl_FragColor = vec4(c / 16.0, 1.0);
}`;

/** The photo: the scene, its blur and its glow, then as film takes it. */
const PHOTO = /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uBokeh;
uniform sampler2D uGlow;
uniform float uRadius;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uAspect;
varying vec2 vUv;
${BLUR_AT}
void main() {
  vec3 c = texture2D(uScene, vUv).rgb;
  // Sharp where the blur is under a pixel; the blur where it is more, or where a near thing spreads over this one.
  vec4 bokeh = texture2D(uBokeh, vUv);
  float k = smoothstep(0.5, 1.5, abs(blurAt(vUv)) * uRadius);
  c = mix(c, bokeh.rgb, k + bokeh.a - k * bokeh.a);
  // Every level of the glow, from fine to wide, is about as bright as the scene: their mean keeps its light.
  c = mix(c, texture2D(uGlow, vUv).rgb / ${LEVELS.toFixed(1)}, ${GLOW.toFixed(2)});
  const float K = ${KNEE.toFixed(2)};
  // tanh's slope is 1 at 0, so the shoulder starts with no bend.
  c = min(c, K) + (1.0 - K) * tanh(max(c - K, 0.0) / (1.0 - K));
  c = mix(c, c * c * (3.0 - 2.0 * c), ${CONTRAST.toFixed(2)});
  // The grade: the dark lifted toward one colour, the light scaled toward another.
  c = c * uGain + uLift * (1.0 - c);
  // 0 in the middle, 1 in the corners, round on any screen.
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = dot(p, p) / (0.25 * (uAspect * uAspect + 1.0));
  c *= 1.0 - ${VIGNETTE.toFixed(2)} * smoothstep(0.35, 1.0, r);
  // Half a step of 8-bit colour, fixed per pixel: a moving noise would change a still view.
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

/** A target the lens draws a pass into: half floats, for the room above white. */
const halfFloat = (o: THREE.RenderTargetOptions = {}) => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, ...o });

/** A pass of the lens: one triangle over the whole target. */
const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, blending: THREE.Blending = THREE.NoBlending) =>
  new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader, depthTest: false, depthWrite: false, blending });

/** The lens's targets and passes (Lens.photo). */
type Photo = {
  /** Each pass draws onto it, with the pass as its material. */
  quad: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** The scene. Multisampled, for smooth edges and the plants' alpha to coverage (#1106), with its depth kept, for the blur. */
  scene: THREE.WebGLRenderTarget;
  /** The scene at half size, then the glow's levels, each half the one before; the first ends as the whole glow. */
  levels: THREE.WebGLRenderTarget[];
  /** The blur, at half size. */
  bokeh: THREE.WebGLRenderTarget;
  half: THREE.ShaderMaterial;
  blur: THREE.ShaderMaterial;
  down: THREE.ShaderMaterial;
  up: THREE.ShaderMaterial;
  photo: THREE.ShaderMaterial;
};

/** How the scene reaches the canvas: through the lens, or (with none) straight. */
export class Lens {
  /** The time of day's grade (GardenScene's LIGHT): the colour the dark is lifted toward, and the light's scale. */
  readonly lift = new THREE.Color(0, 0, 0);
  readonly gain = new THREE.Color(1, 1, 1);
  /** Null with no lens. */
  private readonly photo: Photo | null;
  private readonly camera = new THREE.OrthographicCamera();

  /** @param on Whether the walk has the lens: with it, the canvas needs no depth or smoothing of its own. */
  constructor(renderer: THREE.WebGLRenderer, on: boolean) {
    if (!on) {
      this.photo = null;
      return;
    }
    // Without it a half-float target is not drawable, and the walk would be black. WebGL 2 on every GPU we know has it.
    if (!renderer.extensions.has("EXT_color_buffer_float")) throw new Error("the walk needs EXT_color_buffer_float");
    const scene = halfFloat({ samples: 4, depthBuffer: true, stencilBuffer: false, depthTexture: new THREE.DepthTexture(1, 1), storeMultisampledDepthBuffer: false });
    const levels = Array.from({ length: LEVELS }, () => halfFloat());
    const bokeh = halfFloat();
    const depth = { uDepth: { value: scene.depthTexture }, uNear: { value: 0.1 }, uFar: { value: 1 } };
    const texel = () => ({ value: new THREE.Vector2() });
    // One triangle over the whole target.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>(geo);
    quad.frustumCulled = false;
    this.photo = {
      quad,
      scene,
      levels,
      bokeh,
      half: pass(HALF, { uScene: { value: scene.texture }, uTexel: texel(), ...depth }),
      blur: pass(BOKEH, { uHalf: { value: levels[0].texture }, uTexel: texel(), uRadius: { value: 1 } }),
      down: pass(DOWN, { uSrc: { value: null }, uTexel: texel() }),
      // Adds onto the level under it.
      up: pass(UP, { uSrc: { value: null }, uTexel: texel() }, THREE.AdditiveBlending),
      photo: pass(PHOTO, {
        uScene: { value: scene.texture },
        uBokeh: { value: bokeh.texture },
        uGlow: { value: levels[0].texture },
        uRadius: { value: 1 },
        uLift: { value: this.lift },
        uGain: { value: this.gain },
        uAspect: { value: 1 },
        ...depth,
      }),
    };
  }

  /** The canvas's size in pixels. */
  setSize(w: number, h: number) {
    const p = this.photo;
    if (!p) return;
    p.scene.setSize(w, h);
    let [lw, lh] = [Math.ceil(w / 2), Math.ceil(h / 2)];
    for (const level of p.levels) {
      level.setSize(lw, lh);
      [lw, lh] = [Math.max(1, Math.floor(lw / 2)), Math.max(1, Math.floor(lh / 2))];
    }
    p.bokeh.setSize(p.levels[0].width, p.levels[0].height);
    p.half.uniforms.uTexel.value.set(1 / w, 1 / h);
    p.blur.uniforms.uTexel.value.set(1 / p.levels[0].width, 1 / p.levels[0].height);
    p.blur.uniforms.uRadius.value = (BLUR * h) / 2;
    p.photo.uniforms.uRadius.value = BLUR * h;
    p.photo.uniforms.uAspect.value = w / h;
  }

  /** One frame. The canvas is the renderer's target after. */
  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const p = this.photo;
    if (!p) {
      renderer.render(scene, camera);
      return;
    }
    renderer.setRenderTarget(p.scene);
    renderer.render(scene, camera);
    p.half.uniforms.uNear.value = camera.near;
    p.half.uniforms.uFar.value = camera.far;
    this.run(p, renderer, p.half, p.levels[0]);
    this.run(p, renderer, p.blur, p.bokeh);
    for (let i = 1; i < LEVELS; i++) {
      const src = p.levels[i - 1];
      p.down.uniforms.uSrc.value = src.texture;
      p.down.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.run(p, renderer, p.down, p.levels[i]);
    }
    // The way up adds onto each level, so it must not clear it first.
    renderer.autoClear = false;
    for (let i = LEVELS - 1; i > 0; i--) {
      const src = p.levels[i];
      p.up.uniforms.uSrc.value = src.texture;
      p.up.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.run(p, renderer, p.up, p.levels[i - 1]);
    }
    renderer.autoClear = true;
    this.run(p, renderer, p.photo, null);
  }

  /** Draws `material` over all of `into` (the canvas for null). */
  private run(p: Photo, renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, into: THREE.WebGLRenderTarget | null) {
    p.quad.material = material;
    renderer.setRenderTarget(into);
    renderer.render(p.quad, this.camera);
  }

  /**
   * One pixel of the scene, into where the frames draw it: GardenScene.drawOnce's warm-up, as a GPU may set a program
   * up for each kind of target it draws into. The clip holds through the shadow pass, which sets its own target and
   * back: the target's own scissor, or the renderer's for the canvas.
   */
  drawPixel(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const into = this.photo?.scene;
    if (into) {
      into.scissor.set(0, 0, 1, 1);
      into.scissorTest = true;
      renderer.setRenderTarget(into);
    } else {
      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, 1, 1);
    }
    try {
      renderer.render(scene, camera);
    } finally {
      if (into) {
        into.scissorTest = false;
        renderer.setRenderTarget(null);
      } else renderer.setScissorTest(false);
    }
  }
}
