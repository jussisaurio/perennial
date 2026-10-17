// Two seeds, one pot in the walk (#387; garden/pot.ts says what happens): the
// clay pot by the shed with the seeds on its soil, the creature that hatched
// in it overnight, and the creatures let out, wandering about. A Part, as the
// one place these creatures move; they are drawn from an atlas made for this
// walk (textures.ts potAtlas), in one instanced sprite mesh. Seeds are carried
// as loose things (sceneCarry.ts) and come here when they land in the pot.

import * as THREE from "three";
import { hash01 } from "../lib/seed";
import { letOut, potAt, potNow, sow, takes, traitOf, wandering, WANDER, type Creature, type Pot, type PotKind, type PotNow, type PotWalk } from "./pot";
import { POT_TOP } from "./potArt";
import { rayBox, type Ray } from "./scenery";
import type { Frame, Part } from "./scenePart";
import { sprites } from "./sceneSprites";
import * as T from "./textures";
import { collide, type Layout } from "./world";

/** What the action button does at the pot: let out what hatched. */
export type PotAct = "hatch";

/** A creature let out (`at`: where it was), and the oldest one, which went off over the fence to make room, if any. */
export type PotDone = { did: "hatch"; creature: Creature; at: [number, number, number]; gone: Creature | null };

/** Near enough (m) to the pot to use it; a walk to it stops this short. */
const REACH = 1.0;
export const POT_STAND = 0.6;
/** Metres per atlas cell: the pot, a seed on its soil, a creature (a little one is smaller). */
const SIZE = { pot: 0.8, seed: 0.5, creature: 0.75 };
const LITTLE = 0.65;
/** The pot's soil, where seeds lie and a creature sits (m). */
const SOIL = (POT_TOP / 32) * SIZE.pot;
/** A wanderer walks this fast (m/s), stops this long (s) at each place, and goes round this far (m) from its own spot; one going off over the fence hurries. */
const WALK = { speed: 0.3, rest: 1.6, r: 0.8, away: 0.9 };
/** A winged creature flutters this high (m). */
const FLY = 0.28;

type Slot = {
  c: Creature;
  cell: number;
  /** In the pot, wandering, going off over the fence, or gone. */
  at: "pot" | "wander" | "leaving" | "gone";
  x: number;
  y: number;
  z: number;
  /** Its round of places, and which it heads for. */
  way: [number, number][];
  k: number;
  /** Seconds it still rests before it goes on. */
  rest: number;
};

export class PotPart implements Part {
  /** Their own materials: tinted with the time of day, never swaying in the wind (GardenScene.tint). */
  readonly mats = new Set<THREE.ShaderMaterial>();
  readonly root = new THREE.Group();
  pot: Pot;
  /** The pot today. Changes only when the learner acts. */
  now: PotNow;
  private walk: PotWalk;
  private layout: Layout;
  private reducedMotion: boolean;
  readonly spot: { x: number; z: number };
  /** The pot (0), its two seeds (1, 2), then the creatures, oldest first; the one in the pot last. */
  private slots: Slot[] = [];
  /** Wanderers and the pot's creature drawn so far, for each new one's own spot. */
  private placed = 0;
  private pos!: THREE.InstancedBufferAttribute;
  private uv!: THREE.InstancedBufferAttribute;
  private params!: THREE.InstancedBufferAttribute;
  /** How many cells the walk's atlas has. */
  private cells = 1;

  constructor(layout: Layout, walk: PotWalk, reducedMotion: boolean) {
    this.layout = layout;
    this.walk = walk;
    this.pot = walk.pot;
    this.reducedMotion = reducedMotion;
    this.now = potNow(walk.pot, walk.today);
    this.spot = potAt(layout);
  }

  /** Can a seed go in now (pot.ts takes). */
  takes(): boolean {
    return takes(this.pot);
  }

  /** The creature hatched in the pot, waiting to be let out. */
  get hatched(): Creature | null {
    return this.now.kind === "hatched" ? this.now.creature : null;
  }

  /** The pot, its seeds and this walk's creatures, in one instanced mesh. Draws no random numbers. */
  build() {
    const out = wandering(this.pot);
    const inPot = this.hatched;
    const creatures = inPot ? [...out, inPot] : out;
    const tex = T.pixelTexture(T.potAtlas(creatures));
    const cells = T.POT_CELL.creature(creatures.length);
    const item = (x: number, y: number, z: number, cell: number, scale: number) => ({ x, y, z, u: cell / cells, v: 0, uw: 1 / cells, vh: 1, phase: 0, droop: 0, scale, index: -8 });
    const { x, z } = this.spot;
    this.slots = creatures.map((c, i) => this.slot(c, T.POT_CELL.creature(i), c === inPot ? "pot" : "wander"));
    const items = [
      item(x, 0, z, T.POT_CELL.pot, 1),
      // A seed's cell is 0.5 m: the pot's are drawn at that size, on its soil.
      item(x - 0.07, SOIL, z, 0, 0),
      item(x + 0.07, SOIL, z + 0.02, 0, 0),
      ...this.slots.map((s) => item(s.x, s.y, s.z, s.cell, this.scaleOf(s))),
    ];
    // Sizes differ: one mesh sized for the creatures, with the pot and seeds scaled to theirs.
    const mesh = sprites(tex, items, SIZE.creature, SIZE.creature);
    mesh.material.uniforms.uSway.value = 0;
    this.mats.add(mesh.material);
    this.root.add(mesh);
    this.pos = mesh.geometry.getAttribute("iPos") as THREE.InstancedBufferAttribute;
    this.uv = mesh.geometry.getAttribute("iUv") as THREE.InstancedBufferAttribute;
    this.params = mesh.geometry.getAttribute("iParams") as THREE.InstancedBufferAttribute;
    this.cells = cells;
    this.refresh();
  }

  private scaleOf(s: Slot): number {
    return s.at === "gone" ? 0 : traitOf(s.c) ? 1 : LITTLE;
  }

  /** A creature's slot: in the pot, or at its own spot (the pond for a fish), with a round of places near it. */
  private slot(c: Creature, cell: number, at: "pot" | "wander"): Slot {
    const s: Slot = { c, cell, at, x: this.spot.x, y: SOIL, z: this.spot.z, way: [], k: 0, rest: 0 };
    if (at === "wander") this.goOut(s);
    return s;
  }

  /** Out of the pot: its own spot and round, worked out once, with hashes of its place in the line (no random numbers). */
  private goOut(s: Slot) {
    const n = this.placed++;
    const L = this.layout;
    const p = L.pond;
    const water = s.c.base === "fish";
    const home = water ? { x: p.x, z: p.z } : collide(L, this.spot.x - 1.2 - (n % 3) * 0.9, this.spot.z + (Math.floor(n / 3) % 3) * 1.2 - 0.6, 0.3);
    s.way = Array.from({ length: 4 }, (_, j) => {
      const a = hash01(`pot:${n}`, j) * Math.PI * 2;
      // A fish keeps to the middle of the pond.
      const r = water ? p.r * 0.5 : WALK.r;
      const q = water ? { x: home.x + Math.cos(a) * r, z: home.z + Math.sin(a) * r } : collide(L, home.x + Math.cos(a) * r, home.z + Math.sin(a) * r, 0.2);
      return [q.x, q.z] as [number, number];
    });
    s.at = "wander";
    [s.x, s.z] = s.way[0];
    s.y = this.restY(s, 0);
    s.k = 1;
    s.rest = hash01(`pot:${n}`, 9) * WALK.rest;
  }

  /** How high it is: a fish at the water, a winged one fluttering, the rest on the ground. */
  private restY(s: Slot, t: number): number {
    if (s.c.base === "fish") return -0.04;
    if (traitOf(s.c) === "wings") return FLY + (this.reducedMotion ? 0 : Math.sin(t * 5 + s.cell) * 0.05);
    return 0;
  }

  /** Point the pot and seeds at what they show now, and every creature where it is. */
  private refresh() {
    const pot = this.now.kind === "hatched" ? T.POT_CELL.hatched : T.POT_CELL.pot;
    this.uv.setX(0, pot / this.cells);
    const seeds = this.now.kind === "seeds" ? this.now.seeds : [];
    for (let j = 0; j < 2; j++) {
      const k = seeds[j];
      if (k) this.uv.setX(1 + j, T.POT_CELL.seed(k) / this.cells);
      // Seeds are a 0.5 m cell's size, in a mesh of creature-sized cells.
      this.params.setZ(1 + j, k ? SIZE.seed / SIZE.creature : 0);
    }
    this.params.setZ(0, SIZE.pot / SIZE.creature);
    this.slots.forEach((_, i) => this.draw(i));
    this.uv.needsUpdate = this.params.needsUpdate = true;
  }

  private draw(i: number) {
    const s = this.slots[i];
    this.pos.setXYZ(3 + i, s.x, s.y, s.z);
    this.params.setZ(3 + i, this.scaleOf(s));
    this.pos.needsUpdate = this.params.needsUpdate = true;
  }

  /** What the action button can do from (x, z) with free hands: let out what hatched. Null when nothing here. */
  reachAt(x: number, z: number): PotAct | null {
    return this.hatched && Math.hypot(x - this.spot.x, z - this.spot.z) < REACH ? "hatch" : null;
  }

  /** Where to walk to the pot, and whether you are near enough already. */
  standFor(x: number, z: number): { x: number; z: number; near: boolean } {
    return { ...this.spot, near: Math.hypot(x - this.spot.x, z - this.spot.z) < REACH };
  }

  /** How far along the ray the pot is, while something waits in it to be let out; Infinity otherwise. */
  pickPot(r: Ray): number {
    if (!this.hatched) return Infinity;
    const { x, z } = this.spot;
    return rayBox(r, [x - 0.25, 0, z - 0.25], [x + 0.25, 0.6, z + 0.25]);
  }

  /** The creature out of the pot a ray meets, and how far along it. */
  pickCreature(r: Ray): { i: number; t: number } | null {
    let best: { i: number; t: number } | null = null;
    this.slots.forEach((s, i) => {
      if (s.at !== "wander") return;
      const t = rayBox(r, [s.x - 0.2, s.y, s.z - 0.2], [s.x + 0.2, s.y + 0.35, s.z + 0.2]);
      if (t < (best?.t ?? Infinity)) best = { i, t };
    });
    return best;
  }

  /** A creature and where its name shows (over it), for a tap's tag. */
  creature(i: number): { c: Creature; at: [number, number, number] } {
    const s = this.slots[i];
    return { c: s.c, at: [s.x, s.y + 0.45, s.z] };
  }

  /** A seed landed in the pot: it is sown today (as the walk's clock says), and saved. */
  sow(kind: PotKind, save: (pot: Pot) => void) {
    this.change(sow(this.pot, kind, this.walk.dayNow()), save);
  }

  /** Let out what hatched: it goes out to wander; with WANDER out already, the oldest goes off over the fence. */
  letOut(save: (pot: Pot) => void): PotDone | null {
    const c = this.hatched;
    const s = this.slots.find((x) => x.at === "pot");
    if (!c || !s) return null;
    const at: [number, number, number] = [s.x, s.y + 0.45, s.z];
    this.change(letOut(this.pot, c), save);
    this.goOut(s);
    const out = this.slots.filter((x) => x.at === "wander");
    const oldest = out.length > WANDER ? out[0] : null;
    if (oldest) this.leave(oldest);
    this.refresh();
    return { did: "hatch", creature: c, at, gone: oldest?.c ?? null };
  }

  /** Off over the nearer side fence; a fish dives and is gone. */
  private leave(s: Slot) {
    const b = this.layout.bounds;
    s.at = s.c.base === "fish" || this.reducedMotion ? "gone" : "leaving";
    s.way = [[s.x < (b.minX + b.maxX) / 2 ? b.minX : b.maxX, s.z]];
    s.k = 0;
    s.rest = 0;
  }

  private change(pot: Pot, save: (pot: Pot) => void) {
    this.pot = pot;
    this.now = potNow(pot, this.walk.today);
    this.refresh();
    save(pot);
  }

  /** The wanderers go round their places, rest, and go on; one leaving walks to the fence and is gone. Allocates nothing. */
  tick(f: Frame) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.at !== "wander" && s.at !== "leaving") continue;
      if (this.reducedMotion && s.at === "wander") continue;
      s.y = this.restY(s, f.elapsed);
      if (s.rest > 0) {
        s.rest -= f.dt;
        this.draw(i);
        continue;
      }
      const [tx, tz] = s.way[s.k];
      const d = Math.hypot(tx - s.x, tz - s.z);
      const step = (s.at === "leaving" ? WALK.away : WALK.speed) * f.dt;
      if (d <= step) {
        [s.x, s.z] = [tx, tz];
        if (s.at === "leaving") s.at = "gone";
        else {
          s.k = (s.k + 1) % s.way.length;
          s.rest = WALK.rest;
        }
      } else {
        s.x += ((tx - s.x) / d) * step;
        s.z += ((tz - s.z) / d) * step;
      }
      this.draw(i);
    }
  }
}
