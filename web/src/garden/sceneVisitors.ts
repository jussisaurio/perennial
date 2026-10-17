// Today's visitors in the walk-in garden (garden/visitors.ts says who comes;
// kinds/ says how each kind looks and acts). This runtime is the same for
// every kind: one sprite each from the shared atlas, drawn from the visitor's
// Body every frame, plus picking, tags and speech bubbles. It never asks
// which kind a visitor is (#324).

import * as THREE from "three";
import * as T from "./textures";
import { visitor, type VisitorId, type VisitorView } from "./visitors";
import { KINDS } from "./kinds";
import type { Body, Home, Visitor, VisitorKind } from "./kinds/kind";
import type { Layout } from "./world";
import type { Spots } from "./spots";
import type { Conditions } from "./conditions";
import type { Frame, Part } from "./scenePart";
import { THIRSTY } from "./plants";

/** Every kind's frames in one atlas, in KINDS order; a kind's frame name gives its cell. */
const ATLAS = Object.values(KINDS).flatMap((k) => Object.values(k.art));
const CELLS: Record<string, Record<string, number>> = {};
{
  let cell = 0;
  for (const k of Object.values(KINDS)) {
    CELLS[k.id] = {};
    for (const f of Object.keys(k.art)) CELLS[k.id][f] = cell++;
  }
}

/** The tint of a lantern's light, for a visitor that is always in it (`lit`). */
const LANTERN_LIGHT = new THREE.Color(0.85, 0.8, 0.7);

/**
 * Point a visitor's sprite at its texture cell; upload only when it changes (tick runs
 * every frame). The attribute stores float32, so compare with the float32 value.
 */
export function showCell(uv: THREE.BufferAttribute, cell: number, cells: number) {
  const u = Math.fround(cell / cells);
  if (uv.getX(0) === u) return;
  uv.setX(0, u);
  uv.needsUpdate = true;
}

type SpriteMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

/** One visitor's sprite, and what was last uploaded from its Body. */
interface VisitorSprite {
  v: VisitorView;
  kind: VisitorKind;
  visitor: Visitor<string>;
  body: Body<string>;
  /** Its cell's size (m), and the kind's hit box and tag height (fractions of the cell). */
  size: number;
  hit: [number, number, number];
  top: number;
  /** Its own spot today: where it goes back to after waiting somewhere else (visit). */
  home: [number, number, number];
  mesh: SpriteMesh;
  pos: THREE.InstancedBufferAttribute;
  uv: THREE.InstancedBufferAttribute;
  /** iParams: y is a lying sprite's heading. */
  params: THREE.InstancedBufferAttribute;
  /** The place and heading last uploaded. */
  drawn: [number, number, number, number];
  glow: THREE.Sprite | null;
}

/** What the visitors need from the scene. */
export interface VisitorWorld {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  layout: Layout;
  reducedMotion: boolean;
  /** The course language, for what a visitor says. */
  lang: string;
  /** Seconds since the garden opened. */
  elapsed: () => number;
  /** The height (metres) of a bed's soil, where a visitor at its plant sits. */
  bedTop: number;
  /** The height (metres) of the top of this plant (its word, growth and genome), standing in its bed. */
  plantTop: (p: { lemma: string; growth: number }) => number;
  /** A one-instance, camera-facing sprite of `size` metres from `tex`, showing the strip u..u+uw. */
  sprite: (tex: THREE.Texture, x: number, y: number, z: number, u: number, uw: number, size: number) => SpriteMesh;
  /** The same, lying flat and centred on x, y, z, showing the bottom `vh` of the strip (size × size·vh metres). Turn it with iParams.y. */
  lying: (tex: THREE.Texture, x: number, y: number, z: number, u: number, uw: number, vh: number, size: number) => SpriteMesh;
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

export class SceneVisitors implements Part {
  private sprites: VisitorSprite[] = [];
  private tmp = new THREE.Vector3();
  private tapped: { id: VisitorId; until: number } | null = null;
  /** A visitor's speech bubble (the frog's croak). */
  private saying: { id: VisitorId; text: string; until: number } | null = null;

  private world: VisitorWorld;
  private list: VisitorView[];

  constructor(world: VisitorWorld, list: VisitorView[]) {
    this.world = world;
    this.list = list;
  }

  /** Is this visitor here today? No allocation: the bench asks every frame while you sit (#362). */
  has(id: VisitorId): boolean {
    for (const s of this.sprites) if (s.v.id === id) return true;
    return false;
  }

  /**
   * Today's visitors, each where its kind says (kinds/). One small texture for
   * all of them; each is a one-instance sprite mesh (a lying kind's lies flat).
   * `now`: the moment the walk opened, for the kinds' daily picks.
   */
  build(spots: Spots, now: Date) {
    if (!this.list.length) return;
    const w = this.world;
    const L = w.layout;
    const tex = T.pixelTexture(T.visitors(ATLAS));
    const cellU = 1 / ATLAS.length;
    for (const v of this.list) {
      const kind = KINDS[v.id];
      // A garden-word visitor (#209) lives at its word's plant (#235), if it is in the garden.
      const g = visitor(v.id).garden;
      const plant = g ? L.plants.find((p) => p.garden === g) : undefined;
      const home: Home | null = plant ? { x: plant.x, z: plant.z, soil: w.bedTop, top: w.plantTop(plant), thirsty: plant.r < THIRSTY } : null;
      const it = kind.arrive({ spots, layout: L, home, now, reducedMotion: w.reducedMotion });
      if (!it) continue;
      const { body, size } = it;
      const u = CELLS[v.id][body.frame] * cellU;
      const first = Object.values(kind.art)[0];
      const mesh = kind.lying ? w.lying(tex, body.x, body.y, body.z, u, cellU, first.rows.length / 32, size) : w.sprite(tex, body.x, body.y, body.z, u, cellU, size);
      const params = mesh.geometry.getAttribute("iParams") as THREE.InstancedBufferAttribute;
      if (kind.lying) params.setY(0, body.turn);
      w.scene.add(mesh);
      let glow: THREE.Sprite | null = null;
      if (kind.glow) {
        glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.pixelTexture(T.glow()), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        glow.scale.set(kind.glow.size, kind.glow.size, 1);
        glow.visible = false;
        w.scene.add(glow);
      }
      this.sprites.push({
        v,
        kind,
        visitor: it,
        body,
        size,
        // The defaults: the drawn part is the lower half of the cell, and the tag sits just above it.
        hit: kind.hit ?? [0.2, 0.4, 0.3],
        top: kind.top ?? 0.55,
        home: [body.at.x, body.at.y, body.at.z],
        mesh,
        pos: mesh.geometry.getAttribute("iPos") as THREE.InstancedBufferAttribute,
        uv: mesh.geometry.getAttribute("iUv") as THREE.InstancedBufferAttribute,
        params,
        drawn: [body.x, body.y, body.z, body.turn],
        glow,
      });
    }
  }

  /** Uploads what changed in a visitor's Body: its cell, place, heading, visibility and glow. */
  private draw(s: VisitorSprite) {
    const b = s.body;
    const d = s.drawn;
    s.mesh.visible = b.visible;
    showCell(s.uv, CELLS[s.v.id][b.frame], ATLAS.length);
    if (b.x !== d[0] || b.y !== d[1] || b.z !== d[2]) {
      d[0] = b.x;
      d[1] = b.y;
      d[2] = b.z;
      s.pos.setXYZ(0, b.x, b.y, b.z);
      s.pos.needsUpdate = true;
    }
    if (b.turn !== d[3]) {
      d[3] = b.turn;
      s.params.setY(0, b.turn);
      s.params.needsUpdate = true;
    }
    const glow = s.glow;
    const at = s.kind.glow;
    if (!glow || !at) return;
    glow.visible = b.glow;
    if (!b.glow) return;
    // On the side of its cell facing the camera: the camera's right, in the world.
    const e = this.world.camera.matrixWorldInverse.elements;
    const k = 1 / Math.max(1e-6, Math.hypot(e[0], e[8]));
    const off = at.dx * s.size;
    glow.position.set(b.x + e[0] * k * off, b.y + at.dy * s.size, b.z + e[8] * k * off);
  }

  onConditions(c: Conditions) {
    for (const s of this.sprites) {
      s.visitor.onConditions?.(c);
      this.draw(s);
      // What it said goes once it cannot talk (the frog falls asleep).
      if (this.saying?.id === s.v.id && s.body.mute) this.saying = null;
    }
  }

  /** Tint and fog every visitor for the time of day; one that is `lit` stays in its lantern's light. */
  tint(tint: THREE.Color, fog: THREE.Color) {
    for (const s of this.sprites) {
      const u = s.mesh.material.uniforms;
      u.uTint.value.copy(s.kind.lit ? LANTERN_LIGHT : tint);
      u.uFog.value.copy(fog);
    }
  }

  /** The visitor under a point on the canvas (CSS pixels), if any. `hidden`: something (the hedge) is between the eye and this point. */
  pick(cssX: number, cssY: number, cssW: number, cssH: number, hidden: (x: number, y: number, z: number) => boolean): VisitorView | null {
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
      this.tmp.set(s.pos.getX(0), s.pos.getY(0) + s.size * cy, s.pos.getZ(0)).applyMatrix4(camera.matrixWorldInverse);
      const depth = -this.tmp.z;
      if (depth < 0.2 || depth > 14) continue;
      const rw = Math.max(0.04, (s.size * hx) / depth / tx);
      const rh = Math.max(0.05, (s.size * hy) / depth / ty);
      if (Math.abs(nx - this.tmp.x / depth / tx) < rw && Math.abs(ny - this.tmp.y / depth / ty) < rh && depth < bestDepth && !hidden(s.pos.getX(0), s.pos.getY(0) + s.size * cy, s.pos.getZ(0))) {
        best = s.v;
        bestDepth = depth;
      }
    }
    return best;
  }

  /**
   * A tap on a visitor. One with a word in this course may answer (the awake
   * frog croaks one of your known words): it says that in a bubble for a few
   * seconds, and this returns it. Otherwise its tag shows for a few seconds.
   */
  tap(id: VisitorId, known: readonly string[]): string | null {
    const s = this.sprites.find((o) => o.v.id === id);
    const elapsed = this.world.elapsed();
    const said = s?.v.word && s.visitor.onTap ? s.visitor.onTap({ elapsed, known, lang: this.world.lang }) : null;
    if (said === null) {
      this.tapped = { id, until: elapsed + 4 };
      return null;
    }
    this.say(id, said);
    // Its answer's frame (the frog's puffed throat) shows at once.
    if (s) this.draw(s);
    return said;
  }

  /** A visitor says something in a small bubble for a few seconds, in place of its tag. */
  say(id: VisitorId, text: string) {
    this.saying = { id, text, until: this.world.elapsed() + 3.2 };
    if (this.tapped?.id === id) this.tapped = null;
  }

  /** No tapped tag (a scenery word took its place). */
  untap() {
    this.tapped = null;
  }

  /**
   * A visitor waits somewhere else for now (#334: by a key left waiting), or
   * (null) goes back to its own spot. A visitor not here today: nothing to move.
   * `settled`: it sits with you on the bench (#362), and does not mind you there.
   */
  visit(id: VisitorId, at: [number, number, number] | null, settled = false) {
    const s = this.sprites.find((o) => o.v.id === id);
    if (!s) return;
    const b = s.body;
    [b.at.x, b.at.y, b.at.z] = at ?? s.home;
    [b.x, b.y, b.z] = [b.at.x, b.at.y, b.at.z];
    s.visitor.onVisit?.(settled);
    this.draw(s);
  }

  /** Is this visitor here, and in sight, now? */
  here(id: VisitorId): boolean {
    return this.sprites.some((o) => o.v.id === id && o.mesh.visible);
  }

  /** Where a visitor sits now, on the ground; null when it is not here today. */
  where(id: VisitorId): { x: number; z: number } | null {
    const s = this.sprites.find((o) => o.v.id === id);
    return s ? { x: s.body.at.x, z: s.body.at.z } : null;
  }

  /**
   * A visitor here today that something carries (#360: the frog on the paper
   * boat): where it sits now, and a move that makes nothing, as it runs every
   * frame. Null when it is not here today.
   */
  carried(id: VisitorId): { home: Readonly<{ x: number; z: number }>; to: (x: number, y: number, z: number) => void } | null {
    const s = this.sprites.find((o) => o.v.id === id);
    if (!s) return null;
    const b = s.body;
    const to = (x: number, y: number, z: number) => {
      b.at.x = b.x = x;
      b.at.y = b.y = y;
      b.at.z = b.z = z;
      this.draw(s);
    };
    // Read when asked: a pebble in the pond moves the frog to another pad (#358).
    return { home: b.at, to };
  }

  /** Something lands in the pond (#358): each visitor that minds it answers (the frog on a pad hops to the next). True when one did. */
  splash(): boolean {
    let answered = false;
    for (const s of this.sprites) {
      if (!s.visitor.onSplash?.()) continue;
      answered = true;
      // Where it went is its own spot now.
      s.home = [s.body.at.x, s.body.at.y, s.body.at.z];
      this.draw(s);
    }
    return answered;
  }

  /** A lantern was blown out or lit again (#361): each visitor that minds it answers, and may say so (the moth leaves its dark lantern). */
  lanternsLit(on: readonly boolean[]) {
    for (const s of this.sprites) {
      const said = s.visitor.onLanterns?.(on);
      if (said === undefined) continue;
      if (said !== null) this.say(s.v.id, said);
      this.draw(s);
    }
  }

  /** Visitors react to you and move: each kind's step, then its Body drawn. No allocations here: it runs every frame. */
  tick(f: Frame) {
    const camera = this.world.camera;
    for (const s of this.sprites) {
      if (s.visitor.step) {
        // On screen: in front of the camera and inside it (a little margin).
        const p = this.tmp.set(s.body.at.x, s.body.at.y, s.body.at.z).project(camera);
        const seen = p.z < 1 && Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95;
        if (s.visitor.step(f, seen) === "startled" && this.tapped?.id === s.v.id) this.tapped = null;
      }
      this.draw(s);
    }
    if (this.tapped && f.elapsed > this.tapped.until) this.tapped = null;
    if (this.saying && f.elapsed > this.saying.until) this.saying = null;
  }

  /** Projects the point just above a visitor's drawn part into `tmp`. False when it is out of view. */
  private projectTag(s: VisitorSprite): boolean {
    const v = this.tmp.set(s.pos.getX(0), s.pos.getY(0) + s.size * s.top, s.pos.getZ(0)).project(this.world.camera);
    return v.z <= 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1;
  }

  /**
   * What a visitor says (the frog's croak), which takes the place of its tag,
   * and one visitor tag at most: the one you tapped, or the nearest in view that
   * shows its name on approach (within its kind's tagRange, and as much as its
   * Body's tag lets it). `tags`: false while a scenery word shows.
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
      const d = Math.hypot(s.body.at.x - x, s.body.at.z - z);
      const show = s.body.tag;
      // 1.5 m unless the kind says otherwise: near enough to read a small thing's name.
      if (show > 0 && d < (s.kind.tagRange ?? 1.5) && d < nearD && this.projectTag(s)) [tag, tagShow, nearD] = [s, show, d];
    }
    const label = tag && this.projectTag(tag) ? { id: `visitor:${tag.v.id}`, text: tag.v.word!, gloss: tag.v.gloss, known: tag.v.known, kind: "visitor" as const, x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: tagShow } : null;
    return { say, tag: label };
  }
}
