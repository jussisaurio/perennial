// The sky and the pond (#323): the dome, the far hills, the drifting clouds,
// the sun (the moon at night), and the pond with its lily pads. Everything
// here only the time of day tints or moves; nothing is tapped directly (the
// sun, a cloud, the hills and the pond are named through scenery.ts's own hit
// test; picking stays on GardenScene, which reads sunDir/cloudPositions/
// hillProfile below to build that hit test's world).

import * as THREE from "three";
import type { BuildCtx } from "./sceneSprites";
import type { Conditions, Frame, Part } from "./scenePart";
import * as T from "./textures";

/** The far hills: a ring of this radius and height, its middle this high, the texture repeated this often round it. pickScenery (scene.ts) uses it too, for the ring's shape. */
export const HILLS = { radius: 150, height: 34, y: 10, repeat: 4 };
const UP = new THREE.Vector3(0, 1, 0);
/** How far away the sun (or moon) is drawn, along its direction from the eye. */
const SUN_DIST = 200;

/** What building this part returns for the parts built after it: the lily pads, for the frog and the fish. */
export interface SkySpots {
  pads: [number, number][];
}

export class SkyWater implements Part {
  private camera: THREE.PerspectiveCamera;
  private reducedMotion: boolean;
  private skyMat!: THREE.MeshBasicMaterial;
  private hillMat!: THREE.MeshBasicMaterial;
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

  /** The clouds' current positions, for pickScenery (a tap can meet one). */
  get cloudPositions(): THREE.Vector3[] {
    return this.clouds.map((c) => c.position);
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
    const s = T.SKIES[c.time];
    this.skyMat.map?.dispose();
    const skyTex = T.pixelTexture(T.sky(s, c.time === "night"));
    // The gradient covers the upper half of the dome; below the horizon it clamps.
    skyTex.repeat.set(1, 2);
    skyTex.offset.set(0, -1);
    this.skyMat.map = skyTex;
    this.skyMat.needsUpdate = true;
    this.hillMat.map?.dispose();
    const hills = T.pixelTexture(T.hills(c.time === "night"), true);
    hills.repeat.set(HILLS.repeat, 1);
    this.hillMat.map = hills;
    this.hillMat.needsUpdate = true;
    for (const cloud of this.clouds) cloud.material.color.set(c.time === "night" ? 0x39406a : c.time === "dusk" ? 0xffd2c0 : 0xffffff);
    this.sun.material.map?.dispose();
    this.sun.material.map = T.pixelTexture(T.sun(c.time));
    this.sun.material.needsUpdate = true;
    // High in the south-west by day, low in the west at dusk, the moon in the east at night.
    const [sx, sy, sz] = c.time === "day" ? [-0.5, 0.55, -0.7] : c.time === "dusk" ? [-0.95, 0.12, -0.3] : [0.6, 0.45, -0.65];
    this.sunDir.set(sx, sy, sz).normalize();
  }

  tick(f: Frame) {
    if (!this.reducedMotion) {
      this.water.offset.set((f.elapsed * 0.02) % 1, Math.sin(f.elapsed * 0.3) * 0.03);
      for (const cloud of this.clouds) cloud.position.applyAxisAngle(UP, f.dt * 0.004);
    }
    this.sun.position.copy(this.camera.position).addScaledVector(this.sunDir, SUN_DIST);
  }
}
