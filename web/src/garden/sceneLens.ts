// The lens (#1164): the garden is drawn as a photo of a small paper model. The scene is drawn into a target with room
// above white, then onto the canvas through one pass, as a camera would take it: a soft shoulder, so a bright light
// rolls off instead of clipping flat; a little more contrast; the time of day's grade; a soft dark edge; and a little
// noise, so the sky and the fog do not show bands. A walk that opens at low detail has no lens: the scene goes straight
// onto the canvas, as CI's software WebGL is slow at each pass and each big target (#793).

import * as THREE from "three";

/** Up to here a colour is shown as drawn; above it, it rolls off toward white. Paper in the sun (about 1) stays near white. */
const KNEE = 0.8;
/** How much of a photo's S-curve: the dark a little darker, the light a little lighter. */
const CONTRAST = 0.15;
/** How much darker the corners are than the middle. */
const VIGNETTE = 0.12;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uScene;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uAspect;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uScene, vUv).rgb;
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

/** How the scene reaches the canvas: through the lens, or (with none) straight. */
export class Lens {
  /** The time of day's grade (GardenScene's LIGHT): the colour the dark is lifted toward, and the light's scale. */
  readonly lift = new THREE.Color(0, 0, 0);
  readonly gain = new THREE.Color(1, 1, 1);
  /**
   * Where the scene is drawn, and the pass that takes it onto the canvas; null with no lens. Half floats, for the room
   * above white. Multisampled, for smooth edges and the plants' alpha to coverage (#1106). Its depth is only for the
   * draw: not kept after it, nor copied out.
   */
  private readonly photo: { target: THREE.WebGLRenderTarget; pass: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> } | null;
  private readonly camera = new THREE.OrthographicCamera();

  /** @param on Whether the walk has the lens: with it, the canvas needs no depth or smoothing of its own. */
  constructor(renderer: THREE.WebGLRenderer, on: boolean) {
    if (!on) {
      this.photo = null;
      return;
    }
    // Without it a half-float target is not drawable, and the walk would be black. WebGL 2 on every GPU we know has it.
    if (!renderer.extensions.has("EXT_color_buffer_float")) throw new Error("the walk needs EXT_color_buffer_float");
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      stencilBuffer: false,
      resolveDepthBuffer: false,
      storeMultisampledDepthBuffer: false,
    });
    // One triangle over the whole screen.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScene: { value: target.texture }, uLift: { value: this.lift }, uGain: { value: this.gain }, uAspect: { value: 1 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    const pass = new THREE.Mesh(geo, mat);
    pass.frustumCulled = false;
    this.photo = { target, pass };
  }

  /** The canvas's size in pixels. */
  setSize(w: number, h: number) {
    if (!this.photo) return;
    this.photo.target.setSize(w, h);
    this.photo.pass.material.uniforms.uAspect.value = w / h;
  }

  /** One frame. The canvas is the renderer's target after. */
  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.photo) {
      renderer.render(scene, camera);
      return;
    }
    renderer.setRenderTarget(this.photo.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.photo.pass, this.camera);
  }

  /**
   * One pixel of the scene, into where the frames draw it: GardenScene.drawOnce's warm-up, as a GPU may set a program
   * up for each kind of target it draws into. The clip holds through the shadow pass, which sets its own target and
   * back: the target's own scissor, or the renderer's for the canvas.
   */
  drawPixel(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const into = this.photo?.target;
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
