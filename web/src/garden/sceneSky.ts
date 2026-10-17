// The sky and the pond (#323): the dome, the far hills, the drifting clouds,
// the sun (tonight's real moon at night, #361), the stars that come out over
// the hills once every lantern is out, and the pond with its lily pads. Everything
// here only the time of day tints or moves; nothing is tapped directly (the
// sun, a cloud, the hills and the pond are named through scenery.ts's own hit
// test; picking stays on GardenScene, which reads sunDir/cloudPositions/
// hillProfile below to build that hit test's world).

import * as THREE from "three";
import { sunPath, SUN_AT, type Look } from "./bench";
import type { TimeOfDay } from "./scene";
import { rng } from "../lib/seed";
import type { BuildCtx } from "./sceneSprites";
import type { Conditions } from "./conditions";
import type { Frame, Part } from "./scenePart";
import * as T from "./textures";

/** The far hills: a ring of this radius and height, its middle this high, the texture repeated this often round it. pickScenery (scene.ts) uses it too, for the ring's shape. */
export const HILLS = { radius: 150, height: 34, y: 10, repeat: 4 };
const UP = new THREE.Vector3(0, 1, 0);
/** How far away the sun (or moon) is drawn, along its direction from the eye. */
const SUN_DIST = 200;
/** The clouds' colour at each time of day. */
const CLOUD: Record<TimeOfDay, THREE.Color> = { day: new THREE.Color(0xffffff), dusk: new THREE.Color(0xffd2c0), night: new THREE.Color(0x39406a) };
/** How fast the clouds drift (rad/s), and how much faster for each part of the day a second while time speeds up on the bench (#362), up to `max`. */
const CLOUD_DRIFT = { speed: 0.004, race: 4, max: 0.6 };
/**
 * The stars that come out low over the hills once every lantern is out (#361):
 * how many, how far away, from how high over the horizon to how high
 * (radians), and how long they take to come out or fade (s).
 */
const STARS = { n: 140, dist: 210, low: 0.02, high: 0.5, fade: 2.5 };

// Square pixel stars, each with its own twinkle; with reduced motion they shine still.
const STAR_VERT = /* glsl */ `
  attribute float phase;
  uniform float uTime;
  uniform float uMove;
  uniform float uSize;
  uniform float uFade;
  varying float vA;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (phase > 5.0 ? 2.0 : 1.0);
    vA = uFade * (1.0 - uMove * 0.45 * (0.5 + 0.5 * sin(uTime * (0.8 + fract(phase) * 1.6) + phase * 7.0)));
  }
`;
const STAR_FRAG = /* glsl */ `
  varying float vA;
  void main() {
    if (vA < 0.02) discard;
    gl_FragColor = vec4(vec3(0.85, 0.88, 1.0) * vA, 1.0);
  }
`;

/** What building this part returns for the parts built after it: the lily pads, for the frog and the fish. */
export interface SkySpots {
  pads: [number, number][];
}

/** Show a texture on a material, telling three.js only when it changes (blend runs every frame). */
function show(m: THREE.MeshBasicMaterial | THREE.SpriteMaterial, tex: THREE.Texture) {
  if (m.map === tex) return;
  m.map = tex;
  m.needsUpdate = true;
}

export class SkyWater implements Part {
  private camera: THREE.PerspectiveCamera;
  private reducedMotion: boolean;
  private skyMat!: THREE.MeshBasicMaterial;
  /** The next part of the day's sky, faded in over this one while time speeds up on the bench (#362). */
  private nextSky!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private hillMat!: THREE.MeshBasicMaterial;
  /** Each time of day's sky, hills and sun, drawn once: the time-lapse on the bench swaps them as it goes, and a frame makes nothing. */
  private looks!: Record<TimeOfDay, { sky: THREE.Texture; hills: THREE.Texture; sun: THREE.Texture }>;
  /** How fast the clouds drift now (rad/s). */
  private drift = CLOUD_DRIFT.speed;
  private sunAt: [number, number, number] = [0, 0, 0];
  private clouds: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private sun!: THREE.Sprite;
  private water!: THREE.Texture;
  /** Tonight's moon (moon.ts moonPhase), worked out as the walk opens. */
  private moonPhase: number;
  private stars!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Whether the stars over the hills are out (every lantern is), and how far they have come out, 0 to 1. */
  private starsOut = false;
  private starFade = 0;
  /** The hill texture's ridge row per column, for pickScenery (which point of the hills a ray meets). */
  hillProfile: number[] = [];
  /** Unit vector toward the sun (or the moon at night): pickScenery and the sunflower's face read it. */
  readonly sunDir = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, reducedMotion: boolean, moonPhase: number) {
    this.camera = camera;
    this.reducedMotion = reducedMotion;
    this.moonPhase = moonPhase;
  }

  /** The clouds' current positions, for pickScenery (a tap can meet one). Builds one array; called once per tap, never from tick. */
  get cloudPositions(): THREE.Vector3[] {
    return this.clouds.map((c) => c.position);
  }

  /** One cloud's current position, by the index pickScenery gave its hit. No allocation: labels() reads this every frame while a cloud's tag shows. */
  cloudPosition(i: number): THREE.Vector3 {
    return this.clouds[i].position;
  }

  /**
   * Sky dome, far hills, clouds, and the sun. Built late (GardenScene.build),
   * after the ground's own things: it has no tap targets of its own, so it
   * does not matter to anything but the random sequence, which this keeps.
   */
  buildSkyAndSun(ctx: BuildCtx) {
    this.buildSky(ctx);
    this.buildSun(ctx);
    this.buildStars(ctx);
  }

  /**
   * The stars that come out over the hills (#361), hidden until every lantern
   * is out. Their own random sequence, not the world's: the parts built after
   * the sky keep theirs. Drawn just after the dome, before the clouds and the
   * hills, so both stand in front of them.
   */
  private buildStars(c: BuildCtx) {
    const r = rng(23);
    const pos = new Float32Array(STARS.n * 3);
    const phase = new Float32Array(STARS.n);
    for (let i = 0; i < STARS.n; i++) {
      const a = r() * Math.PI * 2;
      // More of them low down, where the lantern light hid them.
      const up = STARS.low + (STARS.high - STARS.low) * r() * r();
      pos.set([Math.cos(a) * Math.cos(up) * STARS.dist, Math.sin(up) * STARS.dist, Math.sin(a) * Math.cos(up) * STARS.dist], i * 3);
      // One in six is a big one (phase > 5).
      phase[i] = r() * 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
    this.stars = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uMove: { value: this.reducedMotion ? 0 : 1 }, uSize: { value: 1 }, uFade: { value: 0 } },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.stars.renderOrder = -1.5;
    this.stars.frustumCulled = false;
    this.stars.visible = false;
    c.scene.add(this.stars);
  }

  /** Every lantern is out (#361): the stars come out over the hills; one lit again, and they fade. */
  setStars(out: boolean) {
    this.starsOut = out;
  }

  /** The framebuffer's height in pixels (GardenScene.resize): a star is a pixel or two of the garden's own big pixels. */
  resize(height: number) {
    this.stars.material.uniforms.uSize.value = Math.max(1, Math.round(height / 260));
  }

  /** Sky dome, far hills, clouds. */
  private buildSky(c: BuildCtx) {
    const { rand } = c;
    this.skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(240, 16, 12), this.skyMat);
    dome.renderOrder = -2;
    c.scene.add(dome);
    // Just inside the dome, so it draws over it.
    this.nextSky = new THREE.Mesh(new THREE.SphereGeometry(238, 16, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false, transparent: true }));
    this.nextSky.renderOrder = -2;
    this.nextSky.visible = false;
    c.scene.add(this.nextSky);
    this.hillMat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, side: THREE.BackSide, fog: false, depthWrite: false });
    const hillRing = new THREE.Mesh(new THREE.CylinderGeometry(HILLS.radius, HILLS.radius, HILLS.height, 32, 1, true), this.hillMat);
    hillRing.position.y = HILLS.y;
    hillRing.renderOrder = -1;
    c.scene.add(hillRing);
    this.hillProfile = T.hillProfile();
    const cloudTex = T.pixelTexture(T.cloud());
    for (let i = 0; i < 9; i++) {
      const cloud = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: cloudTex, alphaTest: 0.5, fog: false, depthWrite: false }));
      const a = (i / 9) * Math.PI * 2 + rand();
      cloud.position.set(Math.cos(a) * 130, 42 + rand() * 22, Math.sin(a) * 130);
      cloud.lookAt(0, cloud.position.y, 0);
      cloud.renderOrder = -1;
      this.clouds.push(cloud);
      c.scene.add(cloud);
    }
  }

  /** The sun (or moon), always on top of the sky and hills. */
  private buildSun(c: BuildCtx) {
    const look = (time: TimeOfDay) => {
      const sky = T.pixelTexture(T.sky(T.SKIES[time], time === "night"));
      // The gradient covers the upper half of the dome; below the horizon it clamps.
      sky.repeat.set(1, 2);
      sky.offset.set(0, -1);
      const hills = T.pixelTexture(T.hills(time === "night"), true);
      hills.repeat.set(HILLS.repeat, 1);
      return { sky, hills, sun: T.pixelTexture(time === "night" ? T.moon(this.moonPhase) : T.sun(time)) };
    };
    this.looks = { day: look("day"), dusk: look("dusk"), night: look("night") };
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, depthWrite: false, transparent: true, alphaTest: 0.5 }));
    this.sun.scale.set(16, 16, 1);
    this.sun.renderOrder = -1;
    c.scene.add(this.sun);
  }

  /**
   * The pond by the gate, with lily pads. Built early (GardenScene.build),
   * right after the hedge: the frog and the fish (SceneVisitors.build) need
   * its pads, and the random sequence must not move it later.
   */
  buildPond(c: BuildCtx): SkySpots {
    return { pads: this.placePond(c) };
  }

  private placePond(c: BuildCtx): [number, number][] {
    const { L, mat } = c;
    this.water = T.pixelTexture(T.water(), true);
    this.water.repeat.set(2, 2);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(L.pond.r, 20), mat(this.water));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(L.pond.x, 0.04, L.pond.z);
    c.scene.add(pond);
    c.hitDiscs.push({ id: "pond", x: L.pond.x, y: 0.045, z: L.pond.z, r: L.pond.r + 0.18, tagY: 0.3 });
    const rim = new THREE.Mesh(new THREE.RingGeometry(L.pond.r, L.pond.r + 0.18, 20), mat(T.pixelTexture(T.path(), true), { color: 0xb0aaa0 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(L.pond.x, 0.045, L.pond.z);
    c.scene.add(rim);
    const padTex = T.pixelTexture(T.lilypad());
    const pads: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
      const a = i * 1.9 + 0.4;
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), mat(padTex, { alphaTest: 0.5 }));
      pad.rotation.set(-Math.PI / 2, 0, a);
      pad.position.set(L.pond.x + Math.cos(a) * L.pond.r * 0.55, 0.07, L.pond.z + Math.sin(a) * L.pond.r * 0.55);
      pads.push([pad.position.x, pad.position.z]);
      c.hitDiscs.push({ id: "lily", x: pad.position.x, y: 0.07, z: pad.position.z, r: 0.2, tagY: 0.14 });
      c.scene.add(pad);
    }
    return pads;
  }

  onConditions(c: Conditions) {
    const look = this.looks[c.time];
    show(this.skyMat, look.sky);
    show(this.hillMat, look.hills);
    for (const cloud of this.clouds) cloud.material.color.copy(CLOUD[c.time]);
    show(this.sun.material, look.sun);
    const [x, y, z] = SUN_AT[c.time];
    this.sunDir.set(x, y, z).normalize();
  }

  /**
   * Time speeding up on the bench (#362), after onConditions for the time of
   * day nearer now: the next sky fades in over this one, the clouds change
   * colour and race (`race`: parts of the day a second, negative while it runs
   * back), and the sun or moon moves. With reduced motion, only the fade: the
   * clouds and the sun stay still. Null: time runs as usual again.
   */
  blend(look: Look | null, race: number) {
    this.drift = CLOUD_DRIFT.speed + Math.max(-CLOUD_DRIFT.max, Math.min(CLOUD_DRIFT.max, race * CLOUD_DRIFT.race));
    this.nextSky.visible = !!look && look.k > 0;
    if (!look) return;
    show(this.skyMat, this.looks[look.from].sky);
    show(this.nextSky.material, this.looks[look.to].sky);
    this.nextSky.material.opacity = look.k;
    for (const cloud of this.clouds) cloud.material.color.copy(CLOUD[look.from]).lerp(CLOUD[look.to], look.k);
    if (this.reducedMotion) return;
    const at = sunPath(look, this.sunAt);
    this.sunDir.set(at[0], at[1], at[2]).normalize();
  }

  tick(f: Frame) {
    if (!this.reducedMotion) {
      this.water.offset.set((f.elapsed * 0.02) % 1, Math.sin(f.elapsed * 0.3) * 0.03);
      for (const cloud of this.clouds) cloud.position.applyAxisAngle(UP, f.dt * this.drift);
    }
    // The stars come out, or fade, over a moment.
    const step = f.dt / STARS.fade;
    this.starFade = this.starsOut ? Math.min(1, this.starFade + step) : Math.max(0, this.starFade - step);
    this.stars.visible = this.starFade > 0;
    const u = this.stars.material.uniforms;
    u.uFade.value = this.starFade;
    u.uTime.value = f.elapsed;
    this.sun.position.copy(this.camera.position).addScaledVector(this.sunDir, SUN_DIST);
  }

  /** Every time of day's sky, hills and sun: the scene's own sweep frees only those on show. */
  dispose() {
    for (const look of Object.values(this.looks)) for (const t of Object.values(look)) t.dispose();
  }
}
