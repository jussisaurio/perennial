// The sky and the pond (#323): the dome, the far hills, the drifting clouds,
// the sun (the moon at night), and the pond with its lily pads. Everything
// here only the time of day tints or moves; nothing is tapped directly (the
// sun, a cloud, the hills and the pond are named through scenery.ts's own hit
// test; picking stays on GardenScene, which reads sunDir/cloudPositions/
// hillProfile below to build that hit test's world).

import * as THREE from "three";
import { sunPath, SUN_AT, type Look } from "./bench";
import type { TimeOfDay } from "./scene";
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
  /** The hill texture's ridge row per column, for pickScenery (which point of the hills a ray meets). */
  hillProfile: number[] = [];
  /** Unit vector toward the sun (or the moon at night): pickScenery and the sunflower's face read it. */
  readonly sunDir = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, reducedMotion: boolean) {
    this.camera = camera;
    this.reducedMotion = reducedMotion;
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
      return { sky, hills, sun: T.pixelTexture(T.sun(time)) };
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
    this.sun.position.copy(this.camera.position).addScaledVector(this.sunDir, SUN_DIST);
  }

  /** Every time of day's sky, hills and sun: the scene's own sweep frees only those on show. */
  dispose() {
    for (const look of Object.values(this.looks)) for (const t of Object.values(look)) t.dispose();
  }
}
