// Leave it out in the walk (#351, garden/leave.ts says what happens): the bowl
// by the gate, the little shed with its basket and its three-hook shelf, and,
// after a night, the prints that lead from the bowl to what a guest left. It
// builds their meshes, says what the action button can do where you stand,
// does it, and shows the result. Like the hedge it is not a Part: nothing here
// ticks or reacts to the time of day; GardenScene asks it on a tap, on its
// action button, and when it reports what is in reach.

import * as THREE from "three";
import { basketAt, bowlAt, bowlNow, findAt, FINDS, hang, isFind, leave, onBoard, pickUp, shedAt, type BasketThing, type BowlNow, type Find, type Left, type LeaveWalk, type Outcome } from "./leave";
import { rayBox, type Ray } from "./scenery";
import { sprites, type BuildCtx } from "./sceneSprites";
import * as T from "./textures";
import { collide, wayTo, WALKER, type Layout } from "./world";

/** What you hold: something from the basket, or a kept find. One thing at a time; only the find is kept when the walk closes. */
export type Hand = { from: "basket"; thing: BasketThing } | { from: "shelf"; find: Find };

/** What the action button does here (GardenScene's Reach): take from the basket, leave in the bowl, follow the prints, pick up a find, hang it on the shelf, take a kept thing from the shelf. */
export type LeaveAct = "take" | "leave" | "follow" | "find" | "hang" | "unhang";

/** A thing a tap or the action button acts on. */
export type LeaveTarget = { at: "basket"; i: number } | { at: "bowl" } | { at: "find" } | { at: "hook"; hook: number } | { at: "board"; find: Find };

/** What an action did, for the scene to show and the page to say. */
export type LeaveDone = { did: "take"; hand: Hand } | { did: "hang" } | { did: "leave" } | { did: "find"; find: Find; at: [number, number, number] };

/** Near enough (m) to the bowl, the basket or a find, and to the middle of the shelf, to act on them. */
const REACH = 1.4;
const SHELF_REACH = 1.7;
/** A walk to a thing stops this short of it, so it is still in view. */
export const LEAVE_STAND = 0.9;
/** Metres per atlas cell (32 px) for each kind of sprite: the bowl and basket, a find on the ground, a guest, a thing on a hook or on the board. */
const SIZE = { bowl: 0.9, basket: 0.8, item: 0.55, find: 0.9, hung: 0.6, board: 0.45 };
const GUEST_SIZE = { sparrow: 0.5, mouse: 0.45, hedgehog: 0.7, fox: 1.1 } as const;
/** Prints: their size (m), the step between them along the way, and how far each sits off the middle of the way, left and right. */
const PRINT = { size: 0.14, step: 0.32, side: 0.05 };
/** The shed: its back wall is this tall, the shelf's board and the hooks this high, the hooks this far apart along the wall. */
const SHED = { h: 1.7, half: 0.8, depth: 0.7, step: 0.08, board: 0.92, hook: 1.38, gap: 0.45 };
/** The board has room for every kind of find, in a row: nothing kept is ever out of sight. */
const BOARD_SLOTS = Object.keys(FINDS).length;

type SpriteMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
type XZ = { x: number; z: number };

const dist = (x: number, z: number, p: XZ) => Math.hypot(x - p.x, z - p.z);
const near = (x: number, z: number, p: XZ, r: number) => dist(x, z, p) < r;

/** A board target per kind of find, made once (reachAt allocates nothing). */
const boardTargets = () => Object.fromEntries((Object.keys(FINDS) as Find[]).map((find) => [find, { at: "board", find }])) as Record<Find, LeaveTarget>;

/** A one-thing sprite whose atlas cell can change. */
interface Thing {
  mesh: SpriteMesh;
  uv: THREE.InstancedBufferAttribute;
  x: number;
  y: number;
  z: number;
}

export class LeaveItOut {
  /** Their own materials: tinted with the time of day, never swaying in the wind (GardenScene.tint). */
  readonly mats = new Set<THREE.ShaderMaterial>();
  /** Everything this builds hangs under one group, which the scene adds once. */
  readonly root = new THREE.Group();
  left: Left;
  hand: Hand | null = null;
  /** The bowl today: what is in it, or what came for it. Changes only when the learner acts. */
  now: BowlNow;
  private walk: LeaveWalk;
  private layout: Layout;
  private bowl!: Thing;
  private basket!: Thing;
  private items: Thing[] = [];
  private hooks: Thing[] = [];
  private board: Thing[] = [];
  private find: Thing | null = null;
  private guest: Thing | null = null;
  private prints: THREE.Mesh | null = null;
  private tex!: THREE.Texture;
  /** The kept things on the board, slot by slot, as refresh last laid them out. */
  private lying: Find[] = [];
  /** Where things are: the bowl, the basket, where you stand to use the shelf, and what came (null once found). Worked out once; reachAt runs every frame. */
  private spots: { bowl: XZ; basket: XZ; shelf: XZ; find: XZ | null };
  /** Every target the action button can point at, and what reachAt returns, made once: it allocates nothing. */
  private targets: { find: LeaveTarget; bowl: LeaveTarget; hooks: LeaveTarget[]; basket: LeaveTarget[]; board: Record<Find, LeaveTarget> };
  private reach: { a: LeaveAct; target: LeaveTarget };

  constructor(layout: Layout, walk: LeaveWalk) {
    this.layout = layout;
    this.walk = walk;
    this.left = walk.left;
    this.now = bowlNow(walk.left, walk.today, walk.facts);
    const s = shedAt(layout);
    this.spots = { bowl: bowlAt(layout), basket: basketAt(layout), shelf: { x: s.x - 0.45, z: s.z }, find: this.waiting() };
    this.targets = { find: { at: "find" }, bowl: { at: "bowl" }, hooks: [0, 1, 2].map((hook) => ({ at: "hook", hook })), basket: walk.basket.map((_, i) => ({ at: "basket", i })), board: boardTargets() };
    this.reach = { a: "take", target: this.targets.bowl };
  }

  /** reachAt's answer, in the one object it reuses. */
  private reached(a: LeaveAct, target: LeaveTarget) {
    this.reach.a = a;
    this.reach.target = target;
    return this.reach;
  }

  /** What came for the bowl and is waiting to be found, if anything. */
  get came(): Outcome | null {
    return this.now.kind === "came" ? this.now.outcome : null;
  }

  /** Where what came lies, while it waits to be found. */
  findSpot(): XZ | null {
    return this.spots.find;
  }

  private waiting(): XZ | null {
    const o = this.came;
    return o ? findAt(this.layout, o.row.at) : null;
  }

  /** The bowl, the shed with its basket and shelf, and what came in the night with its prints. Draws no random numbers: the build order's shared sequence is untouched. */
  build(c: BuildCtx) {
    const L = this.layout;
    this.tex = T.pixelTexture(T.leaveAtlas());
    const b = bowlAt(L);
    this.bowl = this.sprite(b.x, 0, b.z, SIZE.bowl);
    this.buildShed(c);
    const k = basketAt(L);
    // On the step (SHED.step high).
    this.basket = this.sprite(k.x, SHED.step, k.z, SIZE.basket);
    // What the basket offers stands in it, side by side.
    this.items = this.walk.basket.map((_, i) => this.sprite(k.x - 0.02, SHED.step + 0.15, k.z + (i - (this.walk.basket.length - 1) / 2) * 0.11, SIZE.item));
    const o = this.came;
    if (o) {
      const at = findAt(L, o.row.at);
      this.find = this.sprite(at.x, 0.01, at.z, SIZE.find);
      // A wild guest waits by what it left; the dog is the garden's own visitor, which the scene moves there (dogAt).
      // The sparrow perches on the fence's top rail (0.53 m), just behind its feather; the others sit beside theirs.
      if (o.row.guest === "sparrow") this.guest = this.sprite(at.x + 0.25, 0.53, L.bounds.maxZ - 0.06, GUEST_SIZE.sparrow);
      else if (o.row.guest !== "dog") this.guest = this.sprite(at.x - 0.3, 0, at.z - 0.15, GUEST_SIZE[o.row.guest]);
      this.prints = this.buildPrints(c, o);
    }
    this.refresh();
  }

  /** Where the dog waits by its find, when the dog came: GardenScene moves the visitor there. */
  dogAt(): [number, number, number] | null {
    const o = this.came;
    if (o?.row.guest !== "dog") return null;
    const at = findAt(this.layout, o.row.at);
    return [at.x - 0.35, 0, at.z - 0.1];
  }

  private sprite(x: number, y: number, z: number, size: number): Thing {
    const mesh = sprites(this.tex, [{ x, y, z, u: 0, v: 0, uw: 1 / T.LEAVE_CELLS, vh: 1, phase: 0, droop: 0, scale: 1, index: -8 }], size, size) as SpriteMesh;
    mesh.material.uniforms.uSway.value = 0;
    this.mats.add(mesh.material);
    this.root.add(mesh);
    return { mesh, uv: mesh.geometry.getAttribute("iUv") as THREE.InstancedBufferAttribute, x, y, z };
  }

  /** A small open shed against the fence: a back wall with the shelf's board and three hooks, two sides, a roof, and a step for the basket. */
  private buildShed(c: BuildCtx) {
    const s = shedAt(this.layout);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), c.mat(c.woodTex));
      m.position.set(x, y, z);
      this.root.add(m);
      return m;
    };
    const { h, half, depth } = SHED;
    box(0.06, h, half * 2, s.x, h / 2, s.z);
    for (const sz of [-1, 1]) box(depth, h, 0.05, s.x - depth / 2, h / 2, s.z + sz * half);
    const roof = box(depth + 0.25, 0.05, half * 2 + 0.2, s.x - depth / 2, h + 0.06, s.z);
    roof.rotation.z = -0.18;
    box(0.4, SHED.step, half * 2, s.x - depth - 0.1, SHED.step / 2, s.z);
    box(0.18, 0.04, half * 2 - 0.2, s.x - 0.12, SHED.board, s.z);
    for (let i = 0; i < 3; i++) {
      const z = this.hookZ(i);
      box(0.12, 0.025, 0.025, s.x - 0.08, SHED.hook, z);
      // What hangs on it, just under the peg.
      this.hooks.push(this.sprite(s.x - 0.14, SHED.hook - 0.36, z, SIZE.hung));
    }
    for (let i = 0; i < BOARD_SLOTS; i++) this.board.push(this.sprite(s.x - 0.14, SHED.board + 0.02, s.z - 0.55 + (i * 1.1) / (BOARD_SLOTS - 1), SIZE.board));
  }

  private hookZ(i: number): number {
    return shedAt(this.layout).z + (i - 1) * SHED.gap;
  }

  /** The guest's prints, from the bowl along the way a walker would take to the find, stopping short of it. */
  private buildPrints(c: BuildCtx, o: Outcome): THREE.Mesh {
    const L = this.layout;
    const free = (p: { x: number; z: number }) => collide(L, p.x, p.z, WALKER, false);
    const from = free(bowlAt(L));
    const to = free(findAt(L, o.row.at));
    const way = wayTo(L, from.x, from.z, to.x, to.z, false, []);
    const items: Parameters<typeof sprites>[1] = [];
    const cell = T.PRINT_GUESTS.indexOf(o.row.guest);
    let n = 0;
    for (let i = 1; i < way.length; i++) {
      const [ax, az] = way[i - 1];
      const [bx, bz] = way[i];
      const len = Math.hypot(bx - ax, bz - az);
      const [dx, dz] = [(bx - ax) / len, (bz - az) / len];
      // The last leg stops short of the find: it lies where the prints end.
      const end = i === way.length - 1 ? len - 0.35 : len;
      for (let d = 0.3; d < end; d += PRINT.step, n++) {
        const side = n % 2 ? PRINT.side : -PRINT.side;
        // Toes along the way (textures.ts prints: toes up), turned by the heading (sceneSprites.ts LYING_VERT).
        items.push({ x: ax + dx * d - dz * side, y: 0.025, z: az + dz * d + dx * side, u: cell / T.PRINT_GUESTS.length, v: 0, uw: 1 / T.PRINT_GUESTS.length, vh: 1, phase: 0, droop: Math.atan2(dx, -dz), scale: 1, index: -8 });
      }
    }
    const mesh = sprites(T.pixelTexture(T.prints()), items, PRINT.size, PRINT.size, true);
    c.mats.add(mesh.material);
    this.root.add(mesh);
    return mesh;
  }

  /** Point every sprite at what it shows now, and hide what is not there: after the build and after each action. */
  private refresh() {
    const L = T.LEAVE_CELL;
    const now = this.now;
    const thing = now.kind === "holds" ? now.thing : null;
    const fruit = thing ? this.walk.fruitOf(thing) : null;
    show(this.bowl, thing === null ? L.bowl : fruit ? L.bowlFruit(fruit) : L.bowlCrumbs);
    // The basket offers only while the bowl is empty: one thing at a time, and what came waits to be found.
    const open = now.kind === "empty";
    show(this.basket, L.basket);
    this.walk.basket.forEach((t, i) => {
      const held = this.hand?.from === "basket" && this.hand.thing === t;
      show(this.items[i], "kind" in t ? L.fruit(t.kind) : L.bag, open && !held);
    });
    const held = this.hand?.from === "shelf" ? this.hand.find : null;
    this.left.hooks.forEach((k, i) => show(this.hooks[i], k && isFind(k) ? L.find(k) : 0, !!k && isFind(k) && k !== held));
    const lying = onBoard(this.left).filter((f) => f !== held);
    this.lying = lying;
    this.board.forEach((t, i) => show(t, lying[i] ? L.find(lying[i]) : 0, i < lying.length));
    const o = this.came;
    if (this.find && o) show(this.find, L.find(o.find), true);
    else if (this.find) this.find.mesh.visible = false;
    if (this.guest && o && o.row.guest !== "dog") show(this.guest, L.guest(o.row.guest), true);
    else if (this.guest) this.guest.mesh.visible = false;
    if (this.prints) this.prints.visible = !!o;
  }

  /**
   * What the action button can do from (x, z), and on what: pick up a find in
   * reach; at the bowl, leave what you hold from the basket, or follow the
   * prints; at the shelf, hang the find you hold; at the basket, take a thing
   * (the next one, if you hold one already). Null when nothing here.
   */
  reachAt(x: number, z: number): { a: LeaveAct; target: LeaveTarget } | null {
    const { bowl, basket, shelf, find } = this.spots;
    const hand = this.hand;
    if (find && near(x, z, find, REACH)) return this.reached("find", this.targets.find);
    if (near(x, z, bowl, REACH)) {
      if (this.came) return this.reached("follow", this.targets.bowl);
      if (this.now.kind === "empty" && hand?.from === "basket") return this.reached("leave", this.targets.bowl);
    }
    if (hand?.from === "shelf" && near(x, z, shelf, SHELF_REACH)) {
      const free = this.left.hooks.indexOf(null);
      return this.reached("hang", this.targets.hooks[free < 0 ? 0 : free]);
    }
    const items = this.walk.basket;
    // Holding the only thing the basket has: nothing new to take.
    const fromBasket = this.now.kind === "empty" && near(x, z, basket, REACH) && !(hand?.from === "basket" && items.length === 1);
    // Empty-handed at the shelf: take a kept thing, from the board first, then from a hook, so keys and screen readers can rearrange it too.
    const hung = this.left.hooks.findIndex((k) => k !== null && isFind(k));
    const fromShelf = !hand && near(x, z, shelf, SHELF_REACH) ? (this.lying.length ? this.targets.board[this.lying[0]] : hung >= 0 ? this.targets.hooks[hung] : null) : null;
    // The basket stands on the shed's step, in the shelf's reach: whichever you stand nearer to.
    if (fromBasket && !(fromShelf && dist(x, z, shelf) < dist(x, z, basket))) {
      // The next thing, round to the first again.
      const i = hand?.from === "basket" ? (items.indexOf(hand.thing) + 1) % items.length : 0;
      return this.reached("take", this.targets.basket[i]);
    }
    if (fromShelf) return this.reached("unhang", fromShelf);
    return null;
  }

  /** Where the glint shows for a target in reach. */
  cueAt(t: LeaveTarget): [number, number, number] {
    switch (t.at) {
      case "basket":
        return [this.basket.x, 0.32, this.basket.z];
      case "bowl":
        return [this.bowl.x, 0.24, this.bowl.z];
      case "find": {
        const f = this.findSpot()!;
        return [f.x, 0.2, f.z];
      }
      case "hook":
        return [this.hooks[t.hook].x - 0.05, SHED.hook, this.hooks[t.hook].z];
      case "board":
        return [this.board[0].x - 0.05, SHED.board + 0.15, shedAt(this.layout).z];
    }
  }

  /** Where to walk to act on a target from afar, and whether you are near enough already. */
  standFor(t: LeaveTarget, x: number, z: number): { x: number; z: number; near: boolean } {
    const s = this.spots;
    const at = t.at === "basket" ? s.basket : t.at === "bowl" ? s.bowl : t.at === "find" ? s.find! : s.shelf;
    const r = t.at === "hook" || t.at === "board" ? SHELF_REACH : REACH;
    return { x: at.x, z: at.z, near: near(x, z, at, r) };
  }

  /**
   * The thing a ray meets, and how far along it: the basket's things, the
   * bowl, a find, a hook or a thing on the shelf's board. Only what can be
   * used now: the basket while it is open, a hook with something on it or
   * while you hold a find.
   */
  pick(r: Ray): { target: LeaveTarget; t: number } | null {
    let best: { target: LeaveTarget; t: number } | null = null;
    const meet = (target: LeaveTarget, x: number, y: number, z: number, half: number, h: number) => {
      const t = rayBox(r, [x - half, y, z - half], [x + half, y + h, z + half]);
      if (t < (best?.t ?? Infinity)) best = { target, t };
    };
    if (this.now.kind === "empty") this.items.forEach((it, i) => it.mesh.visible && meet({ at: "basket", i }, it.x, it.y, it.z, 0.08, 0.18));
    meet({ at: "bowl" }, this.bowl.x, 0, this.bowl.z, 0.2, 0.2);
    const f = this.findSpot();
    if (f) meet({ at: "find" }, f.x, 0, f.z, 0.25, 0.25);
    const holding = this.hand?.from === "shelf";
    this.hooks.forEach((h, i) => (holding || h.mesh.visible) && meet({ at: "hook", hook: i }, h.x, h.y, h.z, 0.12, 0.45));
    this.board.forEach((b, i) => b.mesh.visible && meet({ at: "board", find: this.lying[i] }, b.x, b.y, b.z, 0.08, 0.2));
    return best;
  }

  /**
   * Act on a target, standing in reach of it: what a tap does, and the action
   * button. Only what makes sense now; anything else does nothing (null).
   * `save` gets the new value whenever it changes.
   */
  act(t: LeaveTarget, save: (left: Left) => void): LeaveDone | null {
    const hand = this.hand;
    const change = (left: Left) => {
      this.left = left;
      this.now = bowlNow(left, this.walk.today, this.walk.facts);
      this.spots.find = this.waiting();
      save(left);
    };
    let done: LeaveDone | null = null;
    switch (t.at) {
      case "basket":
        if (this.now.kind !== "empty") return null;
        this.hand = { from: "basket", thing: this.walk.basket[t.i] };
        done = { did: "take", hand: this.hand };
        break;
      case "bowl":
        if (this.now.kind !== "empty" || hand?.from !== "basket") return null;
        change(leave(this.left, hand.thing.id, this.walk.dayNow()));
        this.hand = null;
        done = { did: "leave" };
        break;
      case "find": {
        const o = this.came;
        if (!o) return null;
        const f = this.findSpot()!;
        change(pickUp(this.left, o.find));
        // In your hand now, to hang on the shelf; kept already, so it is never lost.
        this.hand = { from: "shelf", find: o.find };
        done = { did: "find", find: o.find, at: [f.x, 0.4, f.z] };
        break;
      }
      case "hook": {
        const on = this.left.hooks[t.hook];
        if (hand?.from === "shelf") {
          // Hung over something: that one goes back on the board.
          change(hang(this.left, t.hook, hand.find));
          this.hand = null;
        } else if (on && isFind(on)) {
          // Taken down, into your hand: to hang on another hook, or to leave on the board.
          change(hang(this.left, t.hook, null));
          this.hand = { from: "shelf", find: on };
        } else return null;
        done = { did: "hang" };
        break;
      }
      case "board":
        this.hand = { from: "shelf", find: t.find };
        done = { did: "take", hand: this.hand };
        break;
    }
    this.refresh();
    return done;
  }
}

/** Show a sprite at an atlas cell (upload only when it changes), or hide it. */
function show(t: Thing, cell: number, visible = true) {
  t.mesh.visible = visible;
  if (!visible) return;
  const u = Math.fround(cell / T.LEAVE_CELLS);
  if (t.uv.getX(0) === u) return;
  t.uv.setX(0, u);
  t.uv.needsUpdate = true;
}
