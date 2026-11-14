// The deadpan scenery (#364): a sundial by the bench whose shadow points to
// the real hour, a mouse door at the foot of the hedge with a mat that says
// welcome, and a fish that jumps, once a visit, for someone who walks round
// the pond three times. Small static meshes and one short leap: one Part for
// the garden's quiet jokes, so each new one does not reach into the host.
// The laps and the hour are pure functions in whimsy.ts.

import * as THREE from "three";
import { JOKE_LINES, JOKE_SPOKEN, lapsDone, lapStep, POND_LAPS, sundialAngle, type Laps } from "./whimsy";
import { rayBox, type Ray } from "./scenery";
import { shade, type BuildCtx } from "./sceneSprites";
import type { Conditions } from "./conditions";
import type { Frame, Part } from "./scenePart";
import { MOUSE_DOOR, type MouseMat } from "./mouseDoor";
import type { NotePlace } from "./stile";
import * as T from "./textures";

/** A tap on a joke: the line it says (in the course language), what it means for a screen reader, and where the line shows. */
export interface Joke {
  line: string;
  spoken: string;
  at: [number, number, number];
}

/** The sundial, from the bench's middle (beside it, at the end away from its notice board), and its sizes (m). */
const SUNDIAL = { dx: -1.05, dz: 0, pillar: 0.7, top: 0.36, face: 0.32, shadow: 0.13 };
/** The fish's leap: how long (s), how high (m) and how far (m) it goes, and how long the rings on the water last (s). */
const LEAP = { s: 0.9, high: 0.55, far: 0.9, ripple: 1.2 };
/** With reduced motion the fish shows, still, at the top of its leap, this long (s). */
const STILL = 1.5;
/** The fish jumps only while you face the pond (within this angle's cosine, about 20°) from this near (m): once a visit, so you see it. */
const WATCH = { facing: Math.cos(0.35), near: 8 };

export class Jokes implements Part {
  private camera: THREE.Camera;
  private reducedMotion: boolean;
  private shadow!: THREE.Group;
  /** What a tap can meet that says a line: the mouse door always, the sundial only at night. */
  private door!: { min: [number, number, number]; max: [number, number, number]; joke: Joke };
  private dial!: { min: [number, number, number]; max: [number, number, number]; joke: Joke };
  private night = false;
  /** The last note (#882) on the mat of the open mouse door; null while the door is shut. */
  private lastNote: { note: NotePlace; paper: THREE.Mesh; readPaper: THREE.Material; glow: THREE.Sprite; box: { min: [number, number, number]; max: [number, number, number] } } | null = null;
  private pond!: { x: number; z: number };
  private laps: Laps = { turned: 0, last: null };
  /** When the fish leapt (s since the walk opened; null: not yet), and the view's right as it did: it leaps across your view. */
  leapt: number | null = null;
  private right = { x: 1, z: 0 };
  private fish!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private rings: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];

  private mouse: MouseMat;

  constructor(camera: THREE.Camera, reducedMotion: boolean, mouse: MouseMat) {
    this.camera = camera;
    this.reducedMotion = reducedMotion;
    this.mouse = mouse;
  }

  /**
   * The sundial by the bench, its shadow at the hour `now`; the mouse door
   * and its mat (`word`: what the mat says, null for a course without one),
   * open with the last note on the mat once there is one (#882);
   * the fish, out of sight until it leaps. Draws no random numbers.
   */
  build(c: BuildCtx, bench: { x: number; z: number }, now: Date, word: string | null) {
    const { L, mat } = c;
    const stone = mat(T.paperTexture(T.stone(), true), { vertexColors: true });

    // The sundial: a stone pillar, a cap, the bronze face, its gnomon and shadow.
    const [x, z] = [bench.x + SUNDIAL.dx, bench.z + SUNDIAL.dz];
    const pillarGeo = new THREE.BoxGeometry(0.2, SUNDIAL.pillar, 0.2);
    shade(pillarGeo);
    const pillar = new THREE.Mesh(pillarGeo, stone);
    pillar.position.set(x, SUNDIAL.pillar / 2, z);
    const capGeo = new THREE.BoxGeometry(SUNDIAL.top, 0.05, SUNDIAL.top);
    shade(capGeo);
    const cap = new THREE.Mesh(capGeo, stone);
    cap.position.set(x, SUNDIAL.pillar + 0.025, z);
    const y = SUNDIAL.pillar + 0.05;
    const faceTex = T.paperTexture(T.sundialFace());
    // A round mesh, so the disc's edge is the mesh's, crisp, with no alpha to test.
    const face = new THREE.Mesh(new THREE.CircleGeometry(SUNDIAL.face / 2, 48), mat(faceTex));
    // Flat, its top (noon) toward the back fence (-z).
    face.rotation.x = -Math.PI / 2;
    face.position.set(x, y + 0.003, z);
    // The gnomon: a thin blade on the noon line, rising from the middle toward noon (-z). It is the rim's dark
    // bronze: all its texture coordinates are in the face's corner, which the disc never shows.
    const blade = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.1, 0), new THREE.Vector2(0.1, 0.06)]);
    const gnomonGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: false });
    gnomonGeo.translate(0, 0, -0.006);
    // The blade's length (its x) along -z.
    gnomonGeo.rotateY(Math.PI / 2);
    gnomonGeo.getAttribute("uv").array.fill(0.02);
    shade(gnomonGeo);
    const gnomon = new THREE.Mesh(gnomonGeo, mat(faceTex, { vertexColors: true }));
    gnomon.position.set(x, y, z);
    // The shadow starts at the middle and points away from the sun: toward the hour on the face.
    const geo = new THREE.PlaneGeometry(0.022, SUNDIAL.shadow);
    geo.translate(0, SUNDIAL.shadow / 2, 0);
    // Not tinted for the time of day (ctx.mat would be): a shadow is dark whatever the light.
    const shadow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x2a1c0c, transparent: true, opacity: 0.5, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    this.shadow = new THREE.Group();
    this.shadow.add(shadow);
    this.shadow.position.set(x, y + 0.006, z);
    // Turning the shadow by -angle about the vertical takes it from noon (-z) toward +x (east) after noon.
    this.shadow.rotation.y = -sundialAngle(now);
    // Two small letters cut high in the pillar, on its garden side (-z): seen only up close (#869, what the sundial's line names).
    const letters = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.05), mat(T.pixelTexture(T.carvedLetters()), { alphaTest: 0.5 }));
    letters.name = "carved letters";
    letters.rotation.y = Math.PI;
    letters.position.set(x, SUNDIAL.pillar - 0.12, z - 0.101);
    c.scene.add(pillar, cap, face, gnomon, this.shadow, letters);
    const top = y + 0.07;
    // By day a tap names it (scenery); at night the same box says its line.
    const box = { min: [x - SUNDIAL.top / 2, 0, z - SUNDIAL.top / 2] as [number, number, number], max: [x + SUNDIAL.top / 2, top, z + SUNDIAL.top / 2] as [number, number, number] };
    c.hitBoxes.push({ id: "sundial", ...box, tag: [x, top + 0.1, z] });
    this.dial = { ...box, joke: { line: JOKE_LINES[c.lang].sundial, spoken: JOKE_SPOKEN.sundial, at: [x, top + 0.3, z] } };

    // The mouse door, flat on the hedge's face, low and small; its mat on the ground in front.
    const { z0, x: mx, z: mz, note } = this.mouse;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(MOUSE_DOOR.w, MOUSE_DOOR.h), mat(T.pixelTexture(T.mouseDoor(note ? "way" : "shut")), { alphaTest: 0.5 }));
    // Facing the garden (-z), a hair in front of the hedge's leaves.
    door.rotation.y = Math.PI;
    door.position.set(mx, MOUSE_DOOR.h / 2, z0 - 0.015);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.07), mat(T.pixelTexture(T.doormat(word))));
    // Flat, and turned to read from the garden side.
    rug.rotation.set(-Math.PI / 2, 0, Math.PI);
    rug.position.set(mx, 0.02, mz);
    c.scene.add(door, rug);
    c.hitBoxes.push({ id: "doormat", min: [mx - 0.13, 0, mz - 0.045], max: [mx + 0.13, 0.03, mz + 0.045], tag: [mx, 0.25, mz] });
    const doorBox = { min: [mx - 0.08, 0.03, z0 - 0.04] as [number, number, number], max: [mx + 0.08, MOUSE_DOOR.h + 0.02, z0] as [number, number, number] };
    this.door = { ...doorBox, joke: { line: JOKE_LINES[c.lang].mouseDoor, spoken: JOKE_SPOKEN.mouseDoor, at: [mx, 0.5, z0] } };
    if (note) this.openMouseDoor(c, note, doorBox, z0);

    // The fish, and the rings where it goes in and comes out: hidden until it leaps.
    this.pond = L.pond;
    this.fish = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), mat(T.pixelTexture(T.leapingFish()), { alphaTest: 0.5, side: THREE.DoubleSide }));
    this.fish.visible = false;
    c.scene.add(this.fish);
    const ring = T.pixelTexture(T.ripple());
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), mat(ring, { transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.rings.push(m);
      c.scene.add(m);
    }
  }

  /**
   * The open mouse door (#882): its wooden door swung out into the garden on
   * its hinge, a dark doorway with a warm light in it at dusk and night, and
   * the last note lying half out of it, on the mat.
   */
  private openMouseDoor(c: BuildCtx, note: NotePlace, doorway: { min: [number, number, number]; max: [number, number, number] }, z0: number) {
    const { mat } = c;
    const { x: mx, z: mz } = this.mouse;
    const hinge = new THREE.Group();
    hinge.position.set(mx - MOUSE_DOOR.w / 2, 0, z0 - 0.015);
    hinge.rotation.y = MOUSE_DOOR.swing;
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(MOUSE_DOOR.w, MOUSE_DOOR.h), mat(T.pixelTexture(T.mouseDoor("leaf")), { alphaTest: 0.5, side: THREE.DoubleSide }));
    leaf.rotation.y = Math.PI;
    leaf.position.set(MOUSE_DOOR.w / 2, MOUSE_DOOR.h / 2, 0);
    hinge.add(leaf);
    // As the big door's keyhole (sceneDoor.ts): not tinted, and seen only at dusk and night (onConditions).
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.set(0.3, 0.3, 1);
    glow.position.set(mx, MOUSE_DOOR.h * 0.45, z0 - 0.03);
    const paperMat = (unread: boolean) => mat(T.paperTexture(T.notePaper(unread)), { alphaTest: 0.5 });
    const readPaper = paperMat(false);
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(MOUSE_DOOR.paper.w, MOUSE_DOOR.paper.h), note.unread ? paperMat(true) : readPaper);
    // Flat on the mat, a little askew, its far end still in the doorway.
    paper.rotation.set(-Math.PI / 2, 0.25, 0, "YXZ");
    paper.position.set(mx + 0.01, 0.025, mz + 0.02);
    c.scene.add(hinge, glow, paper);
    const p = MOUSE_DOOR.paper.h / 2;
    // A tap on the paper or the doorway: both are the note.
    const box = { min: [Math.min(mx - p, doorway.min[0]), 0, mz - p] as [number, number, number], max: [Math.max(mx + p, doorway.max[0]), doorway.max[1], doorway.max[2]] as [number, number, number] };
    this.lastNote = { note, paper, readPaper, glow, box };
  }

  /** The joke a ray meets first, and how far along it (the host checks nothing stands in front). The sundial says its line only at night, and the mouse door only while it is shut. */
  pick(r: Ray): (Joke & { t: number }) | null {
    const d = this.lastNote ? Infinity : rayBox(r, this.door.min, this.door.max);
    const s = this.night ? rayBox(r, this.dial.min, this.dial.max) : Infinity;
    if (d === Infinity && s === Infinity) return null;
    return d <= s ? { ...this.door.joke, t: d } : { ...this.dial.joke, t: s };
  }

  /** The last note, or the open mouse door it lies in, under a ray, and how far along it; null while the door is shut. */
  pickNote(r: Ray): { id: string; t: number } | null {
    const n = this.lastNote;
    if (!n) return null;
    const t = rayBox(r, n.box.min, n.box.max);
    return t === Infinity ? null : { id: n.note.id, t };
  }

  /** The last note as it is now: once read, it lies on the paper of a read one. */
  showNote() {
    const n = this.lastNote;
    // While the door is shut there is no note to show.
    if (n && !n.note.unread) n.paper.material = n.readPaper;
  }

  /** No sun at night, so no shadow, and the sundial is closed. A light shows in the open mouse door at dusk and night. */
  onConditions(c: Conditions) {
    this.night = c.night;
    this.shadow.visible = !this.night;
    if (this.lastNote) this.lastNote.glow.visible = c.dark;
  }

  /** Count the laps round the pond; once there are enough, and you face it, the fish leaps. */
  tick(f: Frame) {
    if (this.leapt === null) {
      lapStep(this.laps, f.x, f.z, this.pond);
      if (lapsDone(this.laps) < POND_LAPS.jump) return;
      const dx = this.pond.x - f.x;
      const dz = this.pond.z - f.z;
      const d = Math.hypot(dx, dz);
      // Forward is -z at yaw 0.
      if (d > WATCH.near || (-Math.sin(f.yaw) * dx - Math.cos(f.yaw) * dz) / d < WATCH.facing) return;
      this.leapt = f.elapsed;
      this.right.x = Math.cos(f.yaw);
      this.right.z = -Math.sin(f.yaw);
    }
    const t = f.elapsed - this.leapt;
    if (this.reducedMotion) return this.still(t);
    const k = t / LEAP.s;
    this.fish.visible = k < 1;
    if (k < 1) {
      const s = (k - 0.5) * LEAP.far;
      this.fish.position.set(this.pond.x + this.right.x * s, 0.04 + LEAP.high * 4 * k * (1 - k), this.pond.z + this.right.z * s);
      this.fish.quaternion.copy(this.camera.quaternion);
      // Nose up as it leaves the water, down as it goes back in: along its arc.
      this.fish.rotateZ(Math.atan((LEAP.high * 4 * (1 - 2 * k)) / LEAP.far));
    }
    this.ring(0, t, -0.5);
    this.ring(1, t - LEAP.s, 0.5);
  }

  /** A ring on the water where the fish went in or came out (`side`: along its leap), `t` s after it did: it grows and fades. */
  private ring(i: number, t: number, side: number) {
    const m = this.rings[i];
    m.visible = t >= 0 && t < LEAP.ripple;
    if (!m.visible) return;
    const k = t / LEAP.ripple;
    m.position.set(this.pond.x + this.right.x * side * LEAP.far, 0.05, this.pond.z + this.right.z * side * LEAP.far);
    m.scale.setScalar(0.4 + k * 0.8);
    m.material.opacity = 1 - k;
  }

  /** With reduced motion: the fish, still, at the top of its leap, over two still rings, for a moment. */
  private still(t: number) {
    const on = t < STILL;
    this.fish.visible = on;
    this.fish.position.set(this.pond.x, 0.04 + LEAP.high, this.pond.z);
    this.fish.quaternion.copy(this.camera.quaternion);
    for (let i = 0; i < this.rings.length; i++) {
      const m = this.rings[i];
      m.visible = on;
      m.position.set(this.pond.x + this.right.x * (i - 0.5) * LEAP.far, 0.05, this.pond.z + this.right.z * (i - 0.5) * LEAP.far);
    }
  }
}
