// Today's visitors in the walk-in garden (garden/visitors.ts says who comes):
// where each one sits, how it reacts to you, what you can tap, and its tag.
// The scene (scene.ts) owns the world and calls in: build once, tick every
// frame, pick on a tap, labels with the plant names.

import * as THREE from "three";
import { daily, rareDay } from "../core/day";
import * as T from "./textures";
import { fencePickets, fencePoint, gnomePose, gnomeTag, snailLap, type GnomePose, type VisitorId, type VisitorView } from "./visitors";
import { collide, type Layout } from "./world";

/**
 * Point a visitor's sprite at its texture cell; upload only when it changes (tick runs
 * every frame). The attribute stores float32, so compare with the float32 value.
 */
export function showCell(uv: THREE.BufferAttribute, cell: number) {
  const u = Math.fround(cell / T.VISITOR_CELLS);
  if (uv.getX(0) === u) return;
  uv.setX(0, u);
  uv.needsUpdate = true;
}

/** The moth's loop round its lantern (m), and the height of the middle of the lantern glass. */
const MOTH_R = 0.24;
const LANTERN_GLASS_Y = 1.02;
/** How far away a visitor's tag shows on approach (m). The gnome adds its own rules (gnomeTag). */
const TAG_RANGE: Partial<Record<VisitorId, number>> = { heron: 2.5, gnome: 7 };

type SpriteMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

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
  mesh: SpriteMesh;
  pos: THREE.InstancedBufferAttribute;
  uv: THREE.InstancedBufferAttribute;
}

/** What the visitors need from the scene. */
export interface VisitorWorld {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  layout: Layout;
  reducedMotion: boolean;
  /** Seconds since the garden opened. */
  elapsed: () => number;
  /** A one-instance, camera-facing sprite of `size` metres from `tex`, showing the strip u..u+uw. */
  sprite: (tex: THREE.Texture, x: number, y: number, z: number, u: number, uw: number, size: number) => SpriteMesh;
}

/**
 * Where the bench's notice board stands, from the bench (it turns 0.35 rad toward
 * the bench). Far enough right that its 1.2 m board clears the 1.3 m bench.
 */
export const BENCH_SIGN = { dx: 1.45, dz: -0.05 };

/** Where things are, for placing visitors: the bench, the lily pads and the lantern spots. */
export interface VisitorSpots {
  bench: THREE.Vector3;
  pads: [number, number][];
  lanterns: [number, number][];
}

/** A visitor's tag, or what it says, as the scene shows labels (screen fractions). */
export interface VisitorLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  near: number;
  kind: "visitor" | "say";
  gloss?: string;
  known?: boolean;
}

export class SceneVisitors {
  /** Their own materials, tinted with the time of day but never swaying or selected. */
  readonly mats = new Set<THREE.ShaderMaterial>();
  private sprites: VisitorSprite[] = [];
  private tmp = new THREE.Vector3();
  /** The snail's lap: when it last moved, and the fence length in pickets. */
  private snailTick = 0;
  private snailPickets = 1;
  private tapped: { id: VisitorId; until: number } | null = null;
  /** A visitor's speech bubble (the frog's croak). */
  private saying: { id: VisitorId; text: string; until: number } | null = null;
  private catAwake = false;
  /** The bird hops away when you come close (t: 0..1 while hopping, 1 once gone) and comes back when you walk off. */
  private bird = { t: -1, dx: 0, dz: 0 };
  /** The frog: puffed up until `croak` (elapsed s); asleep all day on about one day in 25. */
  private frog = { croak: 0, puffed: false, asleep: false };
  /** The gnome's pose, when it left / came back into view, its lantern (lit at dusk and night) and the lantern's small glow. */
  private gnome = { pose: "front" as GnomePose, inView: true, changedAt: 0, lit: false, glow: null as THREE.Sprite | null };
  /** The heron: t is 0 at home, 1 one step back; dir is +1 while stepping back, -1 while stepping home. */
  private heron = { t: 0, dir: 0, tx: 0, tz: 0 };
  /** The moth's loop round its lantern: angle, radius, and a bump into the glass every 6 to 9 s. */
  private moth = { cx: 0, cz: 0, a: 0, r: MOTH_R, bump: -1, next: 7, n: 0 };

  private world: VisitorWorld;
  private list: VisitorView[];

  constructor(world: VisitorWorld, list: VisitorView[]) {
    this.world = world;
    this.list = list;
  }

  /** Is anyone here today? */
  get any(): boolean {
    return this.sprites.length > 0;
  }

  /**
   * Today's visitors (garden/visitors.ts): the snail on the fence rail, the cat
   * on the bench, a toadstool by a bed, a bird on a sign or the fence, the gnome
   * at a bed corner, the frog on a lily pad, the heron at the pond's edge, the
   * moth at a lantern. One small texture for all of them; each is a
   * one-instance sprite mesh.
   */
  build({ bench, pads, lanterns }: VisitorSpots) {
    if (!this.list.length) return;
    const L = this.world.layout;
    const b = L.bounds;
    const tex = T.pixelTexture(T.visitors());
    const RAIL = 0.53; // the top of the fence's upper rail
    const cellU = 1 / T.VISITOR_CELLS;
    // The frog's pad: the one nearest the gate, where you come in.
    const pad = pads.reduce((a, p) => (Math.hypot(p[0] - L.gate.x, p[1] - L.gate.z) < Math.hypot(a[0] - L.gate.x, a[1] - L.gate.z) ? p : a), pads[0]);
    for (const v of this.list) {
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
        this.world.scene.add(glow);
      } else if (v.id === "heron") {
        // On the stones at the pond's edge, a little round from the frog's pad, looking at it.
        const a = Math.atan2(pad[1] - L.pond.z, pad[0] - L.pond.x) - 0.6;
        [x, y, z] = [L.pond.x + Math.cos(a) * (L.pond.r + 0.12), 0.0, L.pond.z + Math.sin(a) * (L.pond.r + 0.12)];
        [cell, size, hit, top] = [T.VISITOR_CELL.heron, 1.05, [0.44, 0.22, 0.44], 0.92];
      } else if (v.id === "moth") {
        const [lx, lz] = daily(lanterns, "visitor-moth-lantern");
        [this.moth.cx, this.moth.cz] = [lx, lz];
        // With reduced motion it sits on the lantern's roof; otherwise tick() moves it.
        [x, y, z] = [lx, 1.235, lz];
        [cell, size, hit, top] = [this.world.reducedMotion ? T.VISITOR_CELL.mothClosed : T.VISITOR_CELL.mothOpen, 0.36, [0.1, 0.3, 0.2], 0.3];
      } else if (v.id === "snail") {
        this.snailPickets = fencePickets(L);
        const p = fencePoint(L, snailLap() * this.snailPickets);
        // A few centimetres inside the fence, so it sits on the rail and not in it.
        [x, y, z] = [p.x + p.dz * 0.06, RAIL, p.z - p.dx * 0.06];
        [cell, size] = [T.VISITOR_CELL.snail, 0.7];
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
        if (!this.list.some((o) => o.id === "cat")) spots.push([bench.x + BENCH_SIGN.dx, 1.19, bench.z + BENCH_SIGN.dz]);
        [x, y, z] = daily(spots, "visitor-bird-spot");
        [cell, size] = [T.VISITOR_CELL.bird, 0.5];
      }
      const mesh = this.world.sprite(tex, x, y, z, cell * cellU, cellU, size);
      this.mats.add(mesh.material);
      this.world.scene.add(mesh);
      const pos = mesh.geometry.getAttribute("iPos") as THREE.InstancedBufferAttribute;
      const uv = mesh.geometry.getAttribute("iUv") as THREE.InstancedBufferAttribute;
      this.sprites.push({ v, x, y, z, w: size, h: size, hit, top, mesh, pos, uv });
    }
  }

  private setCell(s: VisitorSprite, cell: number) {
    showCell(s.uv, cell);
  }

  private gnomeCell(s: VisitorSprite) {
    const g = this.gnome;
    this.setCell(s, (g.lit ? T.VISITOR_CELL.gnomeFrontLit : T.VISITOR_CELL.gnomeFront) + (g.pose === "side" ? 1 : 0));
  }

  /** The frog and the moth come out at dusk; the gnome lights its lantern when the others come on. */
  setDark(dark: boolean) {
    this.gnome.lit = dark;
    for (const s of this.sprites) {
      if (s.v.id === "frog" || s.v.id === "moth") s.mesh.visible = dark;
      // The moth is always in its lantern's light.
      if (s.v.id === "moth") s.mesh.material.uniforms.uTint.value.setRGB(0.85, 0.8, 0.7);
      if (s.v.id === "gnome") this.gnomeCell(s);
    }
    if (this.gnome.glow) this.gnome.glow.visible = dark;
    if (!dark && this.saying?.id === "frog") this.saying = null;
  }

  /** The visitor under a point on the canvas (CSS pixels), if any. */
  pick(cssX: number, cssY: number, cssW: number, cssH: number): VisitorView | null {
    const camera = this.world.camera;
    const nx = (cssX / cssW) * 2 - 1;
    const ny = -(cssY / cssH) * 2 + 1;
    const ty = Math.tan((camera.fov * Math.PI) / 360);
    const tx = ty * camera.aspect;
    let best: VisitorView | null = null;
    let bestDepth = Infinity;
    for (const s of this.sprites) {
      if (!s.mesh.visible) continue;
      const [cy, hx, hy] = s.hit;
      this.tmp.set(s.pos.getX(0), s.pos.getY(0) + s.h * cy, s.pos.getZ(0)).applyMatrix4(camera.matrixWorldInverse);
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
  tap(id: VisitorId) {
    this.tapped = { id, until: this.world.elapsed() + 4 };
  }

  /** No tapped tag (a scenery word took its place). */
  untap() {
    this.tapped = null;
  }

  /** A visitor says something in a small bubble for a few seconds (the frog's croak). */
  say(id: VisitorId, text: string) {
    const now = this.world.elapsed();
    this.saying = { id, text, until: now + 3.2 };
    if (this.tapped?.id === id) this.tapped = null;
    if (id !== "frog" || this.frog.asleep) return;
    // Its throat puffs up while it croaks.
    this.frog.croak = now + 0.7;
    this.frog.puffed = true;
    const s = this.sprites.find((o) => o.v.id === "frog");
    if (s) this.setCell(s, T.VISITOR_CELL.frogCroak);
  }

  /**
   * Visitors react to you (standing at x, z): the cat opens one eye, the bird
   * hops away, the gnome looks away when you do, the heron steps back. The moth
   * goes round its lantern. No allocations here: it runs every frame.
   */
  tick(dt: number, x: number, z: number) {
    const { camera, layout, reducedMotion } = this.world;
    const elapsed = this.world.elapsed();
    for (const s of this.sprites) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (s.v.id === "gnome") {
        const g = this.gnome;
        // In view: in front of the camera and inside the screen (a little margin).
        const p = this.tmp.set(s.x, s.y, s.z).project(camera);
        const inView = p.z < 1 && Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95;
        if (inView !== g.inView) [g.inView, g.changedAt] = [inView, elapsed];
        const since = elapsed - g.changedAt;
        const pose = gnomePose(g.pose, inView, inView ? 0 : since, inView ? since : 0);
        if (pose !== g.pose) {
          g.pose = pose;
          this.gnomeCell(s);
        }
        if (g.glow?.visible) {
          // The lantern hangs 7.5 px right of the middle and 4.5 px up in its cell, on the side facing the camera.
          const e = camera.matrixWorldInverse.elements;
          const k = 1 / Math.max(1e-6, Math.hypot(e[0], e[8]));
          const off = (7.5 / 32) * s.w;
          g.glow.position.set(s.x + e[0] * k * off, s.y + (4.5 / 32) * s.h, s.z + e[8] * k * off);
        }
      } else if (s.v.id === "frog") {
        if (this.frog.puffed && elapsed > this.frog.croak) {
          this.frog.puffed = false;
          this.setCell(s, T.VISITOR_CELL.frog);
        }
      } else if (s.v.id === "snail") {
        // One lap a day: recompute its place twice a second (it moves about a millimetre in that time).
        if (elapsed - this.snailTick < 0.5) continue;
        this.snailTick = elapsed;
        const p = fencePoint(layout, snailLap() * this.snailPickets);
        [s.x, s.z] = [p.x + p.dz * 0.06, p.z - p.dx * 0.06];
        s.pos.setXYZ(0, s.x, s.y, s.z);
        s.pos.needsUpdate = true;
      } else if (s.v.id === "heron") {
        // One slow step back when you come within 1.5 m; back home once you are well away. With reduced motion it just stays.
        const hr = this.heron;
        if (reducedMotion) continue;
        if (hr.dir === 0 && hr.t === 0 && d < 1.5) {
          const k = 0.5 / Math.max(d, 0.01);
          ({ x: hr.tx, z: hr.tz } = collide(layout, s.x + (s.x - x) * k, s.z + (s.z - z) * k, 0.12));
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
        if (!s.mesh.visible || reducedMotion) continue;
        const m = this.moth;
        let resting = false;
        if (m.bump < 0) {
          m.a += dt * 2.4;
          m.r += (MOTH_R - m.r) * Math.min(1, dt * 3);
          if (elapsed > m.next) m.bump = 0;
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
            m.next = elapsed + 6 + 3 * (f - Math.floor(f));
          }
        }
        s.pos.setXYZ(0, m.cx + Math.cos(m.a) * m.r, LANTERN_GLASS_Y - 0.03 + Math.sin(m.a * 2.3) * 0.05, m.cz + Math.sin(m.a) * m.r);
        s.pos.needsUpdate = true;
        this.setCell(s, !resting && Math.sin(elapsed * 28) > 0 ? T.VISITOR_CELL.mothOpen : T.VISITOR_CELL.mothClosed);
      } else if (s.v.id === "cat") {
        const awake = d < 2.4;
        if (awake !== this.catAwake) {
          this.catAwake = awake;
          this.setCell(s, awake ? T.VISITOR_CELL.catAwake : T.VISITOR_CELL.catAsleep);
        }
      } else if (s.v.id === "bird") {
        const bd = this.bird;
        if (bd.t < 0 && d < 1) {
          // Away from you, a little to the side.
          const k = 1 / Math.max(d, 0.01);
          bd.dx = (s.x - x) * k;
          bd.dz = (s.z - z) * k;
          bd.t = reducedMotion ? 1 : 0;
          if (this.tapped?.id === "bird") this.tapped = null;
          this.setCell(s, T.VISITOR_CELL.birdHop);
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
          this.setCell(s, T.VISITOR_CELL.bird);
          s.mesh.visible = true;
        }
      }
    }
    if (this.tapped && elapsed > this.tapped.until) this.tapped = null;
    if (this.saying && elapsed > this.saying.until) this.saying = null;
  }

  /** Projects the point just above a visitor's drawn part into `tmp`. False when it is out of view. */
  private projectTag(s: VisitorSprite): boolean {
    const v = this.tmp.set(s.pos.getX(0), s.pos.getY(0) + s.h * s.top, s.pos.getZ(0)).project(this.world.camera);
    return v.z <= 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1;
  }

  /**
   * What a visitor says (the frog's croak), which takes the place of its tag,
   * and one visitor tag at most: the one you tapped, or the nearest in view that
   * shows its name on approach (within 1.5 m; the heron 2.5 m; the gnome up to
   * 7 m, while it faces you). `tags`: false while a scenery word shows.
   */
  labels(x: number, z: number, tags: boolean): { say: VisitorLabel | null; tag: VisitorLabel | null } {
    const v = this.tmp;
    let say: VisitorLabel | null = null;
    const saying = this.saying;
    let sayer: VisitorSprite | null = null;
    if (saying) for (const s of this.sprites) if (s.v.id === saying.id && s.mesh.visible) sayer = s;
    if (saying && sayer && this.projectTag(sayer)) say = { id: `say:${saying.id}`, text: saying.text, kind: "say", x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: 1 };
    let tag: VisitorSprite | null = null;
    let tagShow = 1;
    let nearD = Infinity;
    for (const s of this.sprites) {
      if (!tags) break;
      if (!s.v.word || !s.mesh.visible || s === sayer) continue;
      if (this.tapped?.id === s.v.id) {
        if (this.projectTag(s)) [tag, tagShow] = [s, 1];
        break;
      }
      if (s.v.tag !== "approach") continue;
      const d = Math.hypot(s.x - x, s.z - z);
      const show = s.v.id === "gnome" ? gnomeTag(this.gnome.pose) : 1;
      if (show > 0 && d < (TAG_RANGE[s.v.id] ?? 1.5) && d < nearD && this.projectTag(s)) [tag, tagShow, nearD] = [s, show, d];
    }
    const label = tag && this.projectTag(tag) ? { id: `visitor:${tag.v.id}`, text: tag.v.word!, gloss: tag.v.gloss, known: tag.v.known, kind: "visitor" as const, x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: tagShow } : null;
    return { say, tag: label };
  }
}
