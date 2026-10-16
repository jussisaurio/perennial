// Fireflies at night, butterflies by day, and the sleeping bloom's z's at
// night (#323). Three small point/sprite effects with no tap of their own:
// moved here as they were, not redesigned (a later pass may rethink how the
// garden's many small animated things are described).

import * as THREE from "three";
import { BED_H, type BuildCtx } from "./scene";
import type { PlacedPlant } from "./world";
import type { Conditions } from "./scenePart";
import * as T from "./textures";

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

type Butterfly = { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; cx: number; cz: number; r: number; ph: number; tex: THREE.Texture };

export class Critters {
  private camera: THREE.PerspectiveCamera;
  private reducedMotion: boolean;
  private fireflies!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private butterflies: Butterfly[] = [];
  private snore: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;

  constructor(camera: THREE.PerspectiveCamera, reducedMotion: boolean) {
    this.camera = camera;
    this.reducedMotion = reducedMotion;
  }

  /** Fireflies everywhere at night, and a few butterflies over blooms, awake by day. */
  build(c: BuildCtx) {
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
    c.scene.add(this.fireflies);
    const blooms = L.plants.filter((p) => p.stage === "bloom");
    for (let i = 0; i < Math.min(8, 2 + Math.floor(blooms.length / 15)); i++) {
      const home = blooms.length ? blooms[Math.floor(rand() * blooms.length)] : { x: L.gate.x + rand() * 4 - 2, z: L.gate.z - 3 };
      const tex = T.pixelTexture(T.butterfly([45, 200, 320, 15, 270][i % 5]));
      tex.repeat.set(0.5, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.11), new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
      c.basic.push(m.material);
      this.butterflies.push({ mesh: m, cx: home.x, cz: home.z, r: 0.5 + rand() * 1.2, ph: rand() * 6.28, tex });
      c.scene.add(m);
    }
  }

  /** The sleeping bloom's z's (#62), if the garden has one tonight. Draws no random numbers. */
  buildSnore(c: BuildCtx, sleeper: PlacedPlant | undefined, plantHeight: (growth: number) => number) {
    if (!sleeper) return;
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
    c.scene.add(this.snore);
  }

  onConditions(c: Conditions) {
    this.fireflies.visible = c.dark;
    for (const bf of this.butterflies) bf.mesh.visible = c.time !== "night";
    if (this.snore) this.snore.visible = c.time === "night";
  }

  /** Framebuffer pixels per metre at 1 m (GardenScene.resize), for the z's point size. */
  resize(pxPerMetre: number) {
    if (this.snore) this.snore.material.uniforms.uScale.value = pxPerMetre;
  }

  tick(_dt: number, elapsed: number) {
    const motion = this.reducedMotion ? 0 : 1;
    this.fireflies.material.uniforms.uTime.value = elapsed;
    this.fireflies.material.uniforms.uMove.value = motion;
    if (this.snore?.visible) this.snore.material.uniforms.uTime.value = elapsed;
    for (const bf of this.butterflies) {
      const a = elapsed * 0.7 * motion + bf.ph;
      bf.mesh.position.set(bf.cx + Math.cos(a) * bf.r, 0.75 + Math.sin(a * 2.3) * 0.25, bf.cz + Math.sin(a * 1.3) * bf.r);
      bf.mesh.quaternion.copy(this.camera.quaternion);
      bf.tex.offset.x = motion && Math.sin(elapsed * 18 + bf.ph) > 0 ? 0.5 : 0;
    }
  }
}
