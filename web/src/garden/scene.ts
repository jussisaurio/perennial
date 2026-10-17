// The walkable word garden, rendered the 90s way: a tiny framebuffer scaled
// up with hard pixels, unlit textures, fog, and flat sprite plants that turn
// to face you. Loaded only when the garden is opened.

import * as THREE from "three";
import { rng } from "../lib/seed";
import { along, benchAt, collide, DOOR_HALF, DOOR_LINES, HEDGE, hedgeSpan, keyAt, lanternSpots, route, sunflowerAt, viewpoint, walk, WALKER, walkStep, wayTo, type KeyHelp, type KeySpot, type Layout, type PlacedPlant, type Trip } from "./world";
import { benchLine, collideTrees, pickTree, placeTrees, treeVisitorSpots, type OrchardTree, type PlacedTree } from "./orchard";
import { buildOrchard, type Orchard } from "./orchardScene";
import { gateHedge, orchardHedge } from "./hedge";
import * as T from "./textures";
import { plantHeight as plantHeightOf } from "../ui/plant";
import { fishSign, pickSigns, sunflowerFaces, type SignLine } from "./whimsy";
import { GATE_HALF, SNAIL_SIGN, visitor, type VisitorId, type VisitorView } from "./visitors";
import { SceneVisitors } from "./sceneVisitors";
import { RAIL, type Spots } from "./spots";
import { conditions } from "./conditions";
import { boardBox, DECOR_KINDS, groundAt, pickScenery, rayBox, rayDisc, spriteBox, SUN_TAG, thingAt, TREE_KINDS, type HitBox, type HitDisc, type Ray, type SceneryHit, type SceneryView, type SceneryViews, type SceneryWorld } from "./scenery";
import { HILLS, SkyWater } from "./sceneSky";
import { Hedge } from "./sceneHedge";
import { Door, DOOR, DOOR_REACH, KEY_REACH } from "./sceneDoor";
import { Critters } from "./sceneCritters";
import { NAME_NEAR, Plants } from "./scenePlants";
import { TAP_PRIORITY, type Frame, type Part, type TapHit } from "./scenePart";
import { LEAVE_STAND, LeaveItOut, type Hand, type LeaveAct, type LeaveDone, type LeaveTarget } from "./sceneLeave";
import { FINDS, type Left, type LeaveWalk } from "./leave";
import { bareNoun, nounView } from "./nouns";
import { plantInReach } from "./shake";
import type { Gender } from "../deck/schema";
import { Jokes, type Joke } from "./sceneJokes";
import { BED_H, FOG_FAR, FOG_NEAR, PLANT_SCALE, plantHeight, signBoard, sprites, SPRITE_H, type BuildCtx, type SpriteItem } from "./sceneSprites";
import { backRate, COMPANY_SPOT, due, glance, GLANCE, GNOME_WORD, lapseLook, lapseRate, settle, type Companion, type Look } from "./bench";
import { inLang } from "./nouns";

export type TimeOfDay = "day" | "dusk" | "night";

/**
 * Where the bench's notice board stands, from the bench (it turns 0.35 rad toward
 * the bench). Far enough right that its 1.2 m board clears the 1.3 m bench.
 */
const BENCH_SIGN = { dx: 1.45, dz: -0.05 };
/** The height of the top of a notice board (m). */
const NOTICE_TOP = 1.19;

/**
 * The door in the hedge (#315): locked; locked with the key hidden somewhere in
 * the garden (its garden word brought it), with the help the world gives once it
 * has waited a while (#334); or open for good.
 */
export type DoorState = "locked" | { key: KeySpot; help: KeyHelp } | "open";
/** What the learner can do at the door: try it while it is locked, pick up the key, or open the door with the key. */
export type DoorAction = "try" | "key" | "open";
/** What the one action button does to the thing in reach (#334): the door's actions, sit on the bench and stand up again, leave it out's (#351), or shake a plant (#357). */
export type Reach = DoorAction | "sit" | "stand" | LeaveAct | "shake";

/** A name over a plant, a visitor's tag (kind "visitor"), a tapped scenery word (kind "scenery") or orchard tree (kind "tree"), what a visitor says (kind "say"), a quiet line in English from the garden itself (kind "line"), or a form falling from a shaken plant (kind "petal", #357; no text: a leaf), in screen fractions. */
export interface Label {
  id: string;
  text: string;
  x: number;
  y: number;
  /** 0 to 1: how close (plant names), or how much of a visitor tag shows. */
  near: number;
  kind?: "visitor" | "scenery" | "tree" | "say" | "line" | "find" | "petal";
  gloss?: string;
  /** A noun plant's gender: the shape of its label's stake (#357). */
  gender?: Gender;
  /** A visitor whose noun the learner knows: plant-label styling with a tiny leaf. */
  known?: boolean;
}

/** Who visits the walk today. */
export interface WalkVisitors {
  list: VisitorView[];
  /** The first word's plant and its stake text, e.g. "casa · 3 Oct" (#61). */
  keepsake?: { id: string; text: string } | null;
  /** The stake in an empty garden, e.g. "Reserved for Spanish words" (#58). */
  reserved?: string | null;
  /** Tonight's sleeping bloom (#62): three z's drift up from it at night. */
  sleeper?: string | null;
  /** Words for the garden itself (#74): shown when you tap the sunflower, a tree, the pond... */
  scenery?: SceneryViews;
  /** The door in the hedge (#315), as the walk opens. */
  door: DoorState;
  /**
   * The orchard behind the door (#315): every tree planted so far, and when the
   * first word was planted, for the bench (null: every word is set aside). Built
   * only once the door is open.
   */
  orchard: { trees: OrchardTree[]; firstPlanted: number | null };
  /** Leave it out (#351): the bowl and the shelf as the walk opens, and what the basket offers. */
  leave: LeaveWalk;
}

export interface SceneCallbacks {
  onSelect: (p: PlacedPlant | null) => void;
  onLabels: (labels: Label[]) => void;
  onProgress: (done: number, total: number) => void;
  /** What the action button does now, for the thing in reach (#334), or null with nothing in reach. */
  onReach: (a: Reach | null) => void;
  /** Leave it out (#351): what you hold changed; something was taken, left, found or hung; the new value, to save. */
  onHand: (h: Hand | null) => void;
  onLeave: (done: LeaveDone) => void;
  onLeft: (left: Left) => void;
  /** A plant was shaken (#357): the forms that fell from it ([]: one leaf). */
  onShake: (p: PlacedPlant, forms: string[]) => void;
  /** The learner opened the door with the key: it stays open (saved with the course). */
  onDoorOpen: () => void;
  /** Sitting on the bench (#362): who just came to sit with you, or null once you stand up. */
  onCompany: (c: Companion | null) => void;
  /** A walk to a tapped spot stalled (#336): a way wayTo should never give. At most once per scene. */
  onStall: () => void;
}

export interface Input {
  /** -1..1 each: forward and right, from keys or the touch stick. */
  move: { x: number; y: number };
  run: boolean;
}

const EYE = 1.05;
const WALK = 3.6;
/** Ground nearer than this (m) is in reach (#336): a tap on it names the path, as before; farther ground is walked to. */
const GROUND_REACH = 1.5;
/** Where a walk to the door stops: on the path in front of it, in reach of it (sceneDoor.ts DOOR_REACH). */
const DOOR_STAND = 1.4;
/** A walk to the key stops this short of it (m), so it is still in view, in reach (KEY_REACH). */
const KEY_STAND = 1;
/** The thing in reach glints (#334): a flash this long (s), this often (s); more often than the key's late help, as it is right there. */
const CUE = { flash: 0.5, every: 1.6 };
/** Near enough to the bench (m, from its middle) to sit on it (#334). */
const BENCH_REACH = 1.6;
/** Sitting on the bench (#334): the eye's height, where you sit along the seat (near its left end: the rest is for company, #362), and how fast you sit down (per second). */
const SEAT = { eye: 0.78, dx: -0.5, speed: 2.5 };
/** How fast the view turns toward where a walk goes: the share of the turn left that it makes per second. */
const TRIP_TURN = 3;
/**
 * Width of the framebuffer, in pixels, for each level of detail. Normal
 * renders at about screen resolution on most screens (the textures keep the
 * pixel-art look). Low uses big pixels, for slow devices.
 */
export const DETAIL = { normal: 2160, low: 760 } as const;
export type Detail = keyof typeof DETAIL;
/** How far away the sun (or moon) is drawn, along its direction from the eye. */
const SUN_DIST = 200;

/** Each time of day's tint for everything unlit, and its fog, made once: the time-lapse on the bench (#362) blends them every frame. */
const LIGHT: Record<TimeOfDay, { tint: THREE.Color; fog: THREE.Color }> = {
  day: { tint: new THREE.Color(...T.SKIES.day.tint), fog: new THREE.Color(T.SKIES.day.fog) },
  dusk: { tint: new THREE.Color(...T.SKIES.dusk.tint), fog: new THREE.Color(T.SKIES.dusk.fog) },
  night: { tint: new THREE.Color(...T.SKIES.night.tint), fog: new THREE.Color(T.SKIES.night.fog) },
};

/** A label's place kept on the screen (a fraction of it), for lines that must be read even when their point is out of view. */
const onScreen = (k: number) => Math.max(0.12, Math.min(0.88, k));

/**
 * The order GardenScene.labels pushes a tag in, when more than one shows at
 * once: a visitor's "say" bubble (the frog's croak) first; then whichever of
 * line/find/scenery/tree is active (GardenScene.clearTaps keeps at most one of
 * those three set); a visitor's approach tag last. One table, like
 * TAP_PRIORITY.
 */
const LABEL_PRIORITY = ["say", "line", "find", "scenery", "tree", "tag"] as const;

/** A wooden bench: a seat facing +z, a back rest behind it, four legs. The one by the pond, and the orchard's (#315). */
function benchModel(c: Pick<BuildCtx, "mat" | "woodTex">): THREE.Group {
  const bench = new THREE.Group();
  const plank = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), c.mat(c.woodTex));
    m.position.set(x, y, z);
    bench.add(m);
  };
  plank(1.3, 0.06, 0.4, 0, 0.42, 0);
  plank(1.3, 0.28, 0.05, 0, 0.66, -0.2);
  for (const sx of [-0.55, 0.55]) for (const sz of [-0.15, 0.15]) plank(0.06, 0.42, 0.06, sx, 0.21, sz);
  return bench;
}

export class GardenScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.1, 260);
  private last = performance.now();
  private elapsed = 0;
  private frame = 0;
  private disposed = false;
  private yaw = 0;
  private pitch = -0.2;
  private x = 0;
  private z = 0;
  private bob = 0;
  /** A glide to a plant: along `path` (world.ts route), turning from one yaw and pitch to the other, `t` 0 to 1 over `s` seconds. */
  private glide: { path: [number, number][]; yaw: [number, number]; pitch: [number, number]; t: number; s: number } | null = null;
  /**
   * A walk to a tapped spot (#336, world.ts Trip and walkStep). It turns the
   * view gently toward where it goes while `turn` (never with reduced motion,
   * and no more once the viewer looks round themselves). On arrival it does
   * `then` (a plant's card, the door).
   */
  private trip: (Trip & { then: (() => void) | null; turn: boolean }) | null = null;
  /** Where a walk's frame moves the walker (walkStep fills it in place); and whether a stalled walk was reported this time in the garden. */
  private at = { x: 0, z: 0 };
  private stallReported = false;
  /** The ring on the ground where a walk goes. */
  private spot!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** What the action button does now (#334), and the glint on the thing in reach that shows it can be used. */
  private reach: Reach | null = null;
  /** What the action button acts on when it does leave it out's (#351). */
  private leaveTarget: LeaveTarget | null = null;
  /** The plant the action button shakes, when it shakes one (#357). */
  private shakeTarget: PlacedPlant | null = null;
  /** Leave it out (#351): the bowl, the shed and its shelf, and what came in the night. */
  private leaveIt: LeaveItOut;
  /** A find's word and meaning over where it lay, for a few seconds after it is picked up. */
  private foundTap: { word: string; gloss: string; at: [number, number, number]; until: number } | null = null;
  private cue!: THREE.Sprite;
  /** Sitting on the bench (#334); `seat` goes from 0 (standing) to 1 (sitting) for the eye's height. */
  private seated = false;
  private seat = 0;
  /**
   * Sitting still on the bench (#362): seconds sat; how far time has run on
   * (parts of the day past `time`, bench.ts) and the look on show for it; who
   * came to sit with you; the view you sat down with, and whether you have
   * looked round yourself since; the turn of the head toward who came last;
   * and when the gnome says its word (seconds sat).
   */
  private sat = 0;
  private lapse = 0;
  private readonly lapseNow: Look = { from: "day", to: "day", k: 0 };
  private come = new Set<Companion>();
  private seatView = { yaw: 0, pitch: 0, looked: false };
  private turnTo: { yaw: number; pitch: number; at: number } | null = null;
  private gnomeSays: number | null = null;
  /** Is this visitor here today? Made once: the bench asks every frame while you sit. */
  private readonly here = (id: Companion) => this.guests.has(id);
  private readonly tintNow = new THREE.Color();
  private readonly fogNow = new THREE.Color();
  /** The pond's bench, by its middle (world.ts benchAt), worked out once: reportReach runs every frame. */
  private bench!: { x: number; z: number };
  /** Every sprite material, for time, sway, tint, fog and selection uniforms. */
  private mats = new Set<THREE.ShaderMaterial>();
  private basic: THREE.MeshBasicMaterial[] = [];
  /** The raised beds, the plants in them, and streaming their full-size sprites (#323). */
  private plants: Plants;
  /** The sky, hills, clouds, sun/moon and the pond (#323). */
  private sky: SkyWater;
  /** Fireflies, butterflies and the sleeping bloom's z's (#323). */
  private critters: Critters;
  /** The deadpan scenery (#364): the sundial, the mouse door, and the fish that jumps. */
  private jokes: Jokes;
  private marker!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private lit!: ReturnType<typeof sprites>;
  private unlit!: ReturnType<typeof sprites>;
  private glows: THREE.Object3D[] = [];
  /** The sunflower: where it stands, its sprite's frame and lean, and which side it shows (null: not drawn yet). */
  private flower!: { x: number; z: number; uv: THREE.InstancedBufferAttribute; params: THREE.InstancedBufferAttribute; face: boolean | null };
  private selected: PlacedPlant | null = null;
  /** The time of day chosen (the clock, or the button), and the one on show: they differ while time speeds up on the bench (#362). */
  private time: TimeOfDay = "day";
  private shown: TimeOfDay = "day";
  /** Time is sped up on the bench now, or running back to the time chosen (#362). */
  private lapsing = false;
  private readonly fog = new THREE.Fog(0xffffff, FOG_NEAR, FOG_FAR);
  /** The sprite materials tint() tints itself: the scene's own and leave it out's (the visitors tint their own). */
  private tinted: readonly Set<THREE.ShaderMaterial>[];
  private lastLabels = "";
  private tmp = new THREE.Vector3();
  /** Filled in place every tick: tick allocates nothing (DESIGN.md, Garden code). */
  private readonly tickFrame: Frame = { dt: 0, elapsed: 0, x: 0, z: 0, yaw: 0 };
  /** What a tap can name in the garden itself (#74), built once. The clouds and the sun are read at tap time. */
  private hitBoxes: HitBox[] = [];
  private hitDiscs: HitDisc[] = [];
  /** The tapped scenery word and where its tag sits (it follows the sun or a cloud). */
  private sceneryTap: { view: SceneryView; hit: SceneryHit; until: number } | null = null;
  /** Lantern spots, for the moth. */
  private lanternSpots: [number, number][] = [];
  /** The door in the hedge (#315), and the key (#323: sceneDoor.ts). */
  private door: Door;
  /** The gate's hedge and, once the door opens, the orchard's (#323). Not a Part: nothing to tick, react to conditions, or dispose beyond the scene's own sweep. */
  private hedge = new Hedge();
  /**
   * Every rendering subsystem with its own tick and/or onConditions (#323):
   * ticked and given Conditions in this order, and disposed in it too. Order
   * among them does not matter for correctness (none reads another's tick
   * result in the same frame) but is fixed and documented here regardless.
   */
  private parts: Part[];
  /** The orchard behind the door, once it is open (#315). */
  private orchard: Orchard | null = null;
  /** The orchard tree tapped last and until when its tag shows. */
  private treeTap: { tree: PlacedTree; until: number } | null = null;
  /** What the world is built with, kept for the orchard, which is built when the door opens. */
  private ctx!: BuildCtx;

  /** The help the world gives for a key left waiting (#334), while it still lies in the garden. */
  private get keyHelp(): KeyHelp | null {
    return this.door.state === "key" ? this.door.help : null;
  }

  /** The orchard's trees, for walking round their trunks: none while the door is shut. */
  private get trunks(): readonly PlacedTree[] {
    return this.orchard?.trees ?? [];
  }
  /** A quiet line from the garden (the door's), over a point, until a time. */
  private line: { text: string; at: [number, number, number]; until: number } | null = null;
  readonly input: Input = { move: { x: 0, y: 0 }, run: false };

  private layout: Layout;
  private cb: SceneCallbacks;
  private reducedMotion: boolean;

  /** The course language, for the odd sign written in it. */
  private lang: string;
  private visitors: WalkVisitors;
  /** Today's visitors in the walk (sceneVisitors.ts). */
  private guests: SceneVisitors;

  constructor(canvas: HTMLCanvasElement, layout: Layout, cb: SceneCallbacks, reducedMotion: boolean, lang: string, visitors: WalkVisitors) {
    this.layout = layout;
    this.cb = cb;
    this.reducedMotion = reducedMotion;
    this.lang = lang;
    this.visitors = visitors;
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.x = layout.gate.x;
    // Start inside the gate, close enough that the first bed fills the view.
    const first = layout.beds[0];
    this.z = Math.min(layout.gate.z - 1.2, first.z + first.d / 2 + 3.2);
    this.camera.rotation.order = "YXZ";
    this.sky = new SkyWater(this.camera, reducedMotion);
    this.critters = new Critters(this.camera, reducedMotion);
    this.plants = new Plants(this.renderer, this.camera, layout, (d, total) => this.cb.onProgress(d, total), (x, y, z) => this.behindHedge(x, y, z));
    this.door = new Door(reducedMotion);
    this.leaveIt = new LeaveItOut(layout, visitors.leave);
    this.jokes = new Jokes(this.camera, reducedMotion);
    this.guests = new SceneVisitors(
      {
        scene: this.scene,
        camera: this.camera,
        layout,
        reducedMotion,
        elapsed: () => this.elapsed,
        bedTop: BED_H,
        // The plant's own drawn height (its genome and meaning too), as its sprite shows it.
        plantTop: (p) => BED_H + (plantHeightOf(p.lemma, p.growth, 1) / T.VIEW_H) * SPRITE_H * PLANT_SCALE,
        sprite: (tex, x, y, z, u, uw, size) => {
          const mesh = sprites(tex, [{ x, y, z, u, v: 0, uw, vh: 1, phase: 0, droop: 0, scale: 1, index: -6 }], size, size);
          mesh.material.uniforms.uSway.value = 0;
          return mesh;
        },
        lying: (tex, x, y, z, u, uw, vh, size) => sprites(tex, [{ x, y, z, u, v: 0, uw, vh, phase: 0, droop: 0, scale: 1, index: -6 }], size, size * vh, true),
      },
      visitors.list,
    );
    this.parts = [this.sky, this.door, this.critters, this.plants, this.guests, this.jokes];
    this.tinted = [this.mats, this.leaveIt.mats];
    this.scene.fog = this.fog;
    this.build();
  }

  /**
   * Builds the static world, part by part; the plants follow (they need
   * rasterising). Keep the order: the parts share one random sequence.
   */
  private build() {
    const L = this.layout;
    const b = L.bounds;
    const c: BuildCtx = {
      L,
      b,
      w: b.maxX - b.minX,
      d: b.maxZ - b.minZ,
      cx: (b.minX + b.maxX) / 2,
      cz: (b.minZ + b.maxZ) / 2,
      mat: (tex, opts = {}) => {
        const m = new THREE.MeshBasicMaterial({ map: tex, ...opts });
        this.basic.push(m);
        return m;
      },
      woodTex: T.pixelTexture(T.wood(), true),
      rand: rng(1),
      scene: this.scene,
      hitBoxes: this.hitBoxes,
      hitDiscs: this.hitDiscs,
      mats: this.mats,
      basic: this.basic,
    };
    this.ctx = c;
    this.buildGround(c);
    this.plants.build(c);
    this.buildFence(c);
    this.buildHedge(c);
    const { pads } = this.sky.buildPond(c);
    this.buildTrees(c);
    this.buildLanterns(c);
    const bench = this.buildBench(c);
    const boards = this.buildSigns(c, bench);
    // The mat says the doormat's word as a mat would: the bare word, in capitals.
    const welcome = this.visitors.scenery?.doormat?.word;
    this.jokes.build(c, this.bench, new Date(), welcome ? bareNoun(welcome).toUpperCase() : null);
    this.guests.build(this.spots(pads, boards));
    // After the visitors: the dog, if it came for the bowl in the night (#351), waits by what it left.
    this.leaveIt.build(c);
    this.scene.add(this.leaveIt.root);
    const dog = this.leaveIt.dogAt();
    if (dog) this.guests.visit("dog", dog);
    // A key left waiting a few days (#334): the dog, if it is here today, sits by it.
    if (this.keyHelp?.visitors && this.door.key && !dog) this.guests.visit("dog", [this.door.key.x - 0.4, 0, this.door.key.z + 0.2]);
    // After the visitors: a visitor may sit in the orchard's trees today.
    if (this.visitors.door === "open") this.openDoor();
    this.buildStakes(c);
    this.buildSunflower(c);
    this.buildDecor(c);
    this.sky.buildSkyAndSun(c);
    this.critters.build(c);
    this.buildMarker();
    this.setTime(this.time);
  }

  /** Ground: grass everywhere, a path surface inside the fence. */
  private buildGround(c: BuildCtx) {
    const { w, d, cx, cz, mat } = c;
    const grassTex = T.pixelTexture(T.grass(), true);
    grassTex.repeat.set(200, 200);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(grassTex));
    ground.rotation.x = -Math.PI / 2;
    // Layers of flat ground sit a few cm apart: some GPUs have a 16-bit depth buffer.
    ground.position.y = -0.06;
    this.scene.add(ground);
    const pathTex = T.pixelTexture(T.path(), true);
    pathTex.repeat.set(w / 1.1, d / 1.1);
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(pathTex));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(cx, 0.01, cz);
    this.scene.add(yard);
  }

  /** The picket fence, with a gap on the gate side where the door in the hedge is. */
  private buildFence(c: BuildCtx) {
    const { L, b, mat } = c;
    const fenceTex = T.pixelTexture(T.picket(), true);
    const fence = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.1) return;
      const t = fenceTex.clone();
      t.repeat.set(len / 1.0, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.8), mat(t, { transparent: false, alphaTest: 0.5, side: THREE.DoubleSide }));
      m.position.set((x1 + x2) / 2, 0.4, (z1 + z2) / 2);
      m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      this.scene.add(m);
      this.hitBoxes.push({ id: "fence", min: [Math.min(x1, x2) - 0.05, 0, Math.min(z1, z2) - 0.05], max: [Math.max(x1, x2) + 0.05, 0.8, Math.max(z1, z2) + 0.05], tag: null });
    };
    fence(b.minX, b.minZ, b.maxX, b.minZ);
    fence(b.minX, b.minZ, b.minX, b.maxZ);
    fence(b.maxX, b.minZ, b.maxX, b.maxZ);
    fence(b.minX, b.maxZ, L.gate.x - GATE_HALF, b.maxZ);
    fence(L.gate.x + GATE_HALF, b.maxZ, b.maxX, b.maxZ);
  }

  /**
   * The tall hedge along the gate side, with the old door set into it (#315),
   * and the key hidden in the garden once its word brought it. The hedge is taller than the
   * eye, and nothing is built behind it until the door opens: no angle shows
   * what is there. Through the keyhole there is only a warm light.
   */
  private buildHedge(c: BuildCtx) {
    const { L } = c;
    this.hedge.build(c);
    // Left and right of the door, and over it, closing into an arch.
    this.hedge.addWalls(c, gateHedge(L, DOOR.h), 1);
    // The door frame, its leaf, the keyhole's light, and the key, if this walk has it.
    this.door.build(c, L, this.visitors.door);
  }

  /** Opens the door for good: the swing (none with reduced motion), and what lies behind it is built now. */
  private openDoor(swing = false) {
    const d = this.door;
    d.state = "open";
    d.keyhole.hole.visible = d.keyhole.glow.visible = false;
    if (swing && !this.reducedMotion) d.swing = 0;
    else d.leaf.rotation.y = DOOR.open;
    // The orchard's own hedge, round the far sides, so it is a walled garden.
    const o = this.layout.orchard;
    this.hedge.addWalls(this.ctx, orchardHedge(this.layout), 4);
    const { trees, firstPlanted } = this.visitors.orchard;
    const orchard = buildOrchard(
      {
        parent: this.scene,
        sprites,
        bench: () => benchModel(this.ctx),
        mat: this.ctx.mat,
        plaque: firstPlanted === null ? null : benchLine(firstPlanted),
      },
      o,
      trees,
    );
    this.orchard = orchard;
    for (const m of orchard.mats) this.mats.add(m);
    this.hitBoxes.push(...orchard.scenery);
    // Built after setTime when the door opens in this walk: give it the time of day now.
    this.tint();
  }

  /**
   * Where visitors can sit today (spots.ts), from the world built so far: the
   * pond's pads, the lanterns, the bench, the notice boards and the fence's
   * rail, and, when the walk starts with the door open, the orchard's trees.
   */
  private spots(pads: [number, number][], boards: [number, number, number][]): Spots {
    const L = this.layout;
    const b = L.bounds;
    const first = L.beds[0];
    // After the back fence's board: the first bed's sign (scenePlants.ts) and the fence's rail on either side.
    const perches: [number, number, number][] = [
      boards[0],
      [first.x - first.w / 2 - 0.3, 0.93, first.z + first.d / 2 + 0.3],
      [b.maxX - 0.06, RAIL, (b.maxZ + first.z) / 2],
      [b.minX + 0.06, RAIL, first.z - 1],
      ...boards.slice(1),
    ];
    // Only when the walk starts with the door open: a visitor the learner may be looking at
    // does not vanish from the garden as the door opens. Visitors that came another way
    // (the gnome, the moth...) have no garden word and never sit in the trees.
    const brought = new Set(this.visitors.list.flatMap((v) => visitor(v.id).garden ?? []));
    const trees = this.visitors.door === "open" ? treeVisitorSpots(placeTrees(L.orchard, this.visitors.orchard.trees), brought, new Date()) : [];
    return { bench: this.bench, pads, lanterns: this.lanternSpots, perches, trees };
  }

  /** The ray from the eye through a point on the canvas (CSS pixels). */
  private ray(cssX: number, cssY: number, cssW: number, cssH: number): Ray {
    const c = this.camera;
    const d = this.tmp.set((cssX / cssW) * 2 - 1, -(cssY / cssH) * 2 + 1, 0.5).unproject(c).sub(c.position).normalize();
    return { ox: c.position.x, oy: c.position.y, oz: c.position.z, dx: d.x, dy: d.y, dz: d.z };
  }

  /** What a tap does at the door, if it meets the key or the shut door (CSS pixels). Ask after the plants and visitors, before the scenery. */
  pickDoor(cssX: number, cssY: number, cssW: number, cssH: number): DoorAction | null {
    const d = this.door;
    if (d.state === "open") return null;
    const r = this.ray(cssX, cssY, cssW, cssH);
    const L = this.layout;
    const z0 = L.bounds.maxZ + HEDGE.gap;
    const toDoor = rayBox(r, [L.gate.x - DOOR_HALF, 0, z0 - 0.05], [L.gate.x + DOOR_HALF, DOOR.h, z0 + DOOR.thick + 0.05]);
    // A small thing on the ground: a generous disc round it, so a finger finds it.
    // From farther than its reach too: a tap there walks to it first (tapDoor, #336). There, whatever
    // stands in front of it (a lantern, the sunflower) is what the tap meets; in reach the key comes first, as it did.
    const disc = d.key && d.state === "key" ? rayDisc(r, d.key.x, 0.03, d.key.z, 0.3) : Infinity;
    const toKey = disc < Infinity && !this.inReach("key") && thingAt(r, this.sceneryWorld()) < disc ? Infinity : disc;
    if (Math.min(toDoor, toKey) > FOG_FAR) return null;
    if (toKey <= toDoor) return "key";
    return d.state === "held" ? "open" : "try";
  }

  /** Is the viewer near enough to the key (for "key") or the door (the rest) to act on it? */
  private inReach(a: DoorAction): boolean {
    const k = this.door.key;
    if (a === "key") return !!k && Math.hypot(this.x - k.x, this.z - k.z) < KEY_REACH;
    return Math.hypot(this.x - this.layout.gate.x, this.z - this.layout.bounds.maxZ) < DOOR_REACH;
  }

  /** The action button (#334): do what it shows to the thing in reach. Anything else no longer applies and does nothing. */
  act(a: Reach) {
    if (a === "sit" && !this.seated) this.sit();
    else if (a === "stand") this.standUp();
    else if (a === "try" || a === "key" || a === "open") this.doorAct(a);
    else if (a === "shake" && this.reach === "shake" && this.shakeTarget) this.shakeNow(this.shakeTarget);
    else if (a !== "sit" && a === this.reach && this.leaveTarget) this.doLeave(this.leaveTarget);
  }

  /** A long press on a plant (#357): shake it where it stands when its name shows; from farther away, walk to it first. */
  shake(p: PlacedPlant) {
    if (Math.hypot(p.x - this.x, p.z - this.z) < NAME_NEAR) return this.shakeNow(p);
    const v = viewpoint(this.layout, p);
    this.goTo(v.x, v.z, 0, () => this.shakeNow(p));
  }

  private shakeNow(p: PlacedPlant) {
    this.cb.onShake(p, this.plants.shake(p, this.elapsed, this.reducedMotion));
  }

  /** The bowl, a thing in the basket, a hook or the shelf's board, or what came in the night, under a point on the canvas (CSS pixels). Ask after the door. */
  pickLeave(cssX: number, cssY: number, cssW: number, cssH: number): LeaveTarget | null {
    const r = this.ray(cssX, cssY, cssW, cssH);
    const got = this.leaveIt.pick(r);
    if (!got || got.t > FOG_FAR || this.hedgeAt(r) < got.t) return null;
    // From afar a tap walks there first: whatever stands in front of it is what the tap meets. In reach it comes first.
    const near = this.leaveIt.standFor(got.target, this.x, this.z).near;
    return near || thingAt(r, this.sceneryWorld()) >= got.t ? got.target : null;
  }

  /** A tap on the bowl, the basket, the shelf or a find (#351): act on it in reach; from farther away, walk up to it first. */
  tapLeave(t: LeaveTarget) {
    const at = this.leaveIt.standFor(t, this.x, this.z);
    if (at.near) return this.doLeave(t);
    this.goTo(at.x, at.z, LEAVE_STAND, () => this.doLeave(t));
  }

  /** Walk up to the bowl, and stop there (#335: the walk opened from what waits in Today's strip). */
  walkToBowl() {
    const at = this.leaveIt.standFor({ at: "bowl" }, this.x, this.z);
    this.goTo(at.x, at.z, LEAVE_STAND, null);
  }

  /**
   * Do leave it out's action on a thing in reach: take, leave, pick up, hang;
   * at the bowl, once something came in the night, follow its prints to what it
   * left. Anything that no longer applies does nothing.
   */
  private doLeave(t: LeaveTarget) {
    const spot = this.leaveIt.findSpot();
    if (t.at === "bowl" && spot) return this.goTo(spot.x, spot.z, LEAVE_STAND, null);
    const came = this.leaveIt.came;
    const done = this.leaveIt.act(t, (left) => this.cb.onLeft(left));
    if (!done) return;
    this.cb.onHand(this.leaveIt.hand);
    if (done.did === "find") {
      // The dog that brought it goes home.
      if (came?.row.guest === "dog") this.guests.visit("dog", null);
      const v = nounView(FINDS[done.find], this.lang);
      // A course with no word for it shows only its meaning.
      this.foundTap = { word: v.word ?? v.gloss, gloss: v.gloss, at: done.at, until: this.elapsed + 4 };
      this.clearTaps({ scenery: true, tree: true, line: true, visitor: true });
    }
    this.cb.onLeave(done);
  }

  /** Sit on the bench, facing the pond: a cut to the seat, and the eye sinks (at once, with reduced motion). Any move stands you up. */
  private sit() {
    const b = this.bench;
    this.endTrip();
    this.glide = null;
    // The bench faces +z, toward the pond; forward is -z at yaw 0.
    [this.x, this.z, this.yaw, this.pitch] = [b.x + SEAT.dx, b.z + 0.05, Math.PI, 0.1];
    this.seated = true;
    this.sat = 0;
    this.seatView = { yaw: this.yaw, pitch: this.pitch, looked: false };
  }

  /** Stand up (any move does): who came to sit with you goes back to their own places, and time runs back to now (#362). Called every frame you move: nothing to do unless you sat. */
  private standUp() {
    if (!this.seated) return;
    this.seated = false;
    this.turnTo = null;
    this.gnomeSays = null;
    for (const id of this.come) this.guests.visit(id, null);
    const bird = this.come.has("bird");
    this.come.clear();
    // The bird may have been waiting by a key before it came.
    if (bird) this.birdByKey();
    this.cb.onCompany(null);
  }

  /**
   * One frame of sitting on the bench (#362), before the camera moves: time
   * speeds up after a while (bench.ts), and visitors here today come to sit
   * with you, each once its place is out of view, so you never see one come.
   * The head turns to whoever came (not with reduced motion, nor once you have
   * looked round yourself). Standing up, time runs back to the time chosen.
   */
  private onBench(dt: number) {
    let race = 0;
    if (this.seated) {
      this.sat += dt;
      race = lapseRate(this.sat);
      this.lapse += race * dt;
      const who = due(this.sat, this.here, this.come);
      if (who && !this.inView(who)) this.sitBeside(who);
      if (this.gnomeSays !== null && this.sat >= this.gnomeSays) {
        this.gnomeSays = null;
        // lang is a deck language here, so a word for it is always there.
        this.guests.say("gnome", inLang(GNOME_WORD, this.lang)!);
      }
      const t = this.turnTo;
      if (t) {
        const w = glance(this.sat - t.at);
        const v = this.seatView;
        this.yaw = v.yaw + (t.yaw - v.yaw) * w;
        this.pitch = v.pitch + (t.pitch - v.pitch) * w;
        if (w === 0 && this.sat > t.at) this.turnTo = null;
      }
    } else if (this.lapse) {
      race = backRate(this.lapse);
      this.lapse = settle(this.lapse, dt);
    }
    if (!this.lapse) {
      if (!this.lapsing) return;
      // Back to the time chosen.
      this.lapsing = false;
      this.sky.blend(null, 0);
      return this.showTime(this.time);
    }
    this.lapsing = true;
    const look = lapseLook(this.time, this.lapse, this.lapseNow);
    // What is lit or awake changes half way; the sky, the light and the fog fade.
    const now = look.k < 0.5 ? look.from : look.to;
    if (now !== this.shown) this.showTime(now);
    this.sky.blend(look, race);
    this.tintNow.copy(LIGHT[look.from].tint).lerp(LIGHT[look.to].tint, look.k);
    this.fogNow.copy(LIGHT[look.from].fog).lerp(LIGHT[look.to].fog, look.k);
    this.tint();
  }

  /** Is a visitor's place on the bench in view now? */
  private inView(who: Companion): boolean {
    const [dx, dy, dz] = COMPANY_SPOT[who];
    const p = this.tmp.set(this.bench.x + dx, dy + 0.15, this.bench.z + dz).project(this.camera);
    return p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1;
  }

  /** A visitor comes to sit with you on the bench (#362), and the head turns to it. The gnome says its word once you see it. */
  private sitBeside(who: Companion) {
    const [dx, dy, dz] = COMPANY_SPOT[who];
    const at: [number, number, number] = [this.bench.x + dx, dy, this.bench.z + dz];
    this.guests.visit(who, at, true);
    this.come.add(who);
    this.cb.onCompany(who);
    const turn = !this.reducedMotion && !this.seatView.looked;
    if (who === "gnome") this.gnomeSays = this.sat + (turn ? GLANCE.turn : 0);
    if (!turn) return;
    // Forward is -z at yaw 0; turn the short way round. Look at its middle, a little above where it sits.
    const v = this.seatView;
    let yaw = Math.atan2(-(at[0] - this.x), -(at[2] - this.z));
    yaw -= Math.round((yaw - v.yaw) / (Math.PI * 2)) * Math.PI * 2;
    const pitch = Math.max(-0.75, Math.atan2(at[1] + 0.2 - SEAT.eye, Math.hypot(at[0] - this.x, at[2] - this.z)));
    this.turnTo = { yaw, pitch, at: this.sat };
  }

  /** A tap on the key or the door (#336): act on it in reach; from farther away, walk up to it first. */
  tapDoor(a: DoorAction) {
    if (this.inReach(a)) return this.doorAct(a);
    const k = this.door.key;
    if (a === "key" && k) this.goTo(k.x, k.z, KEY_STAND, () => this.doorAct(a));
    else this.goTo(this.layout.gate.x, this.layout.bounds.maxZ - DOOR_STAND, 0, () => this.doorAct(a));
  }

  /** Try the door, pick up the key, or open the door with it: from a tap in reach, or the door's button. Anything else no longer applies and does nothing. */
  doorAct(a: DoorAction) {
    const d = this.door;
    const L = this.layout;
    const z0 = L.bounds.maxZ + HEDGE.gap;
    if (a === "key" && d.state === "key" && d.key) {
      d.state = "held";
      d.key.mesh.visible = d.key.glint.visible = false;
      // Whoever waited by it goes home.
      this.guests.visit("dog", null);
      this.guests.visit("bird", null);
      this.showLine(DOOR_LINES.found, [d.key.x, 0.45, d.key.z]);
    } else if (a === "open" && d.state === "held") {
      this.openDoor(true);
      this.clearTaps({ line: true });
      this.cb.onDoorOpen();
    } else if (a === "try" && d.state !== "open") this.showLine(DOOR_LINES.locked, [L.gate.x, 1.5, z0]);
  }

  /** Show a quiet line over a point for a few seconds. One tag at a time: a tapped scenery or visitor tag goes. */
  private showLine(text: string, at: [number, number, number]) {
    this.line = { text, at, until: this.elapsed + 4 };
    this.clearTaps({ scenery: true, tree: true, visitor: true, find: true });
  }

  /**
   * A scenery word, an orchard tree, the door's quiet line, a find's word
   * (#351) and a visitor's tag take turns showing: setting one clears
   * whichever of the rest is named here. One place for the rule this file's
   * own select/tapVisitor/tapTree/tapScenery/showLine used to half-repeat,
   * each inline (#323).
   */
  private clearTaps(which: { scenery?: boolean; tree?: boolean; line?: boolean; visitor?: boolean; find?: boolean }) {
    if (which.scenery) this.sceneryTap = null;
    if (which.tree) this.treeTap = null;
    if (which.line) this.line = null;
    if (which.visitor) this.guests.untap();
    if (which.find) this.foundTap = null;
  }

  /** The mouse door, or the sundial at night (#364), under a point on the canvas (CSS pixels), with nothing in front of it. Ask after leave it out's things. */
  pickJoke(cssX: number, cssY: number, cssW: number, cssH: number): Joke | null {
    const r = this.ray(cssX, cssY, cssW, cssH);
    const got = this.jokes.pick(r);
    if (!got || got.t > FOG_FAR || thingAt(r, this.sceneryWorld()) < got.t) return null;
    return { line: got.line, at: got.at };
  }

  /** A joke's quiet line, over it for a few seconds (after a tap). */
  tapJoke(j: Joke) {
    this.showLine(j.line, j.at);
  }

  /** How far along the ray the nearest hedge is, or Infinity: what lies past it is hidden. */
  private hedgeAt(r: Ray): number {
    let t = Infinity;
    for (const b of this.hitBoxes) if (b.id === "hedge") t = Math.min(t, rayBox(r, b.min, b.max));
    return t;
  }

  /** The orchard tree under a point on the canvas (CSS pixels), unless the hedge is in front of it (#315). Ask after the plants and visitors. */
  pickTree(cssX: number, cssY: number, cssW: number, cssH: number): PlacedTree | null {
    if (!this.orchard) return null;
    const r = this.ray(cssX, cssY, cssW, cssH);
    const got = pickTree(r, this.orchard.hits);
    if (!got || got.t > FOG_FAR || this.hedgeAt(r) < got.t) return null;
    return this.orchard.trees.find((t) => t.id === got.hit.id)!;
  }

  /** Show a tree's word and meaning over it for a few seconds (after a tap). One tag at a time. */
  tapTree(tree: PlacedTree) {
    this.treeTap = { tree, until: this.elapsed + 4 };
    this.clearTaps({ scenery: true, line: true, visitor: true, find: true });
  }

  /** Trees and bushes outside the fence. */
  private buildTrees(c: BuildCtx) {
    const { L, b, w, d, rand } = c;
    const hedge = hedgeSpan(L);
    const treeTex = T.pixelTexture(T.trees());
    const trees: SpriteItem[] = [];
    const perimeter = 2 * (w + d);
    const count = Math.round(perimeter / 2.2);
    for (let i = 0; i < count; i++) {
      const t = (i / count) * perimeter;
      let x: number, z: number;
      if (t < w) [x, z] = [b.minX + t, b.minZ];
      else if (t < w + d) [x, z] = [b.maxX, b.minZ + (t - w)];
      else if (t < 2 * w + d) [x, z] = [b.maxX - (t - w - d), b.maxZ];
      else [x, z] = [b.minX, b.maxZ - (t - 2 * w - d)];
      const nx = x < b.minX + 0.01 ? -1 : x > b.maxX - 0.01 ? 1 : 0;
      const nz = z < b.minZ + 0.01 ? -1 : z > b.maxZ - 0.01 ? 1 : 0;
      if (nz === 1) continue; // nothing grows behind the hedge: it stays a mystery until the door opens (#315)
      const out = 1.2 + rand() * 5;
      const kind = rand() < 0.3 ? 3 : Math.floor(rand() * 3);
      const tree = {
        x: x + nx * out + (rand() - 0.5),
        y: 0,
        z: z + nz * out + (rand() - 0.5),
        u: kind * 0.25,
        v: 0,
        uw: 0.25,
        vh: 1,
        phase: rand() * 6,
        droop: 0,
        scale: kind === 3 ? 1.1 : 2.4 + rand() * 1.6,
        index: -2,
      };
      // Nor in the hedge's ends, where the orchard is wider than the garden.
      if (tree.z > b.maxZ - 1.5 && tree.x > hedge[0] - 1.5 && tree.x < hedge[1] + 1.5) continue;
      trees.push(tree);
    }
    for (const t of trees) {
      const k = TREE_KINDS[Math.round(t.u * 4)];
      this.hitBoxes.push(spriteBox(k.id, t.x, 0, t.z, k.half * t.scale, k.top * t.scale));
    }
    const treeMesh = sprites(treeTex, trees);
    this.mats.add(treeMesh.material);
    this.scene.add(treeMesh);
  }

  /** Lanterns where paths cross, and two by the door. Lit at dusk and night. */
  private buildLanterns(c: BuildCtx) {
    this.lanternSpots = lanternSpots(c.L);
    for (const [x, z] of this.lanternSpots) this.hitBoxes.push(spriteBox("lantern", x, 0, z, 0.13, 1.26));
    const lanternTex = T.pixelTexture(T.lantern());
    const lanternItems = (u: number): SpriteItem[] => this.lanternSpots.map(([x, z]) => ({ x, y: 0, z, u, v: 0, uw: 0.5, vh: 1, phase: 0, droop: 0, scale: 1, index: -3 }));
    this.unlit = sprites(lanternTex, lanternItems(0), 0.42, 1.26);
    this.lit = sprites(lanternTex, lanternItems(0.5), 0.42, 1.26);
    for (const m of [this.unlit, this.lit]) {
      this.mats.add(m.material);
      this.scene.add(m);
    }
    const glowTex = T.pixelTexture(T.glow());
    const additive = { map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false } as const;
    for (const [x, z] of this.lanternSpots) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ ...additive }));
      halo.scale.set(1.1, 1.1, 1);
      halo.position.set(x, 1.12, z);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ ...additive, opacity: 0.55 }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.06, z);
      this.glows.push(halo, pool);
      this.scene.add(halo, pool);
    }
  }

  /** A bench by the pond, for sitting and admiring. Returns where it stands. */
  private buildBench(c: BuildCtx): THREE.Group {
    const bench = benchModel(c);
    const at = benchAt(c.L);
    this.bench = at;
    bench.position.set(at.x, 0, at.z);
    this.scene.add(bench);
    {
      const { x, z } = bench.position;
      this.hitBoxes.push({ id: "bench", min: [x - 0.68, 0, z - 0.25], max: [x + 0.68, 0.8, z + 0.22], tag: [x, 0.88, z] });
    }
    return bench;
  }

  /**
   * Notice boards: two whose text changes each day, and the snail's. Returns the
   * board tops a bird can sit on: the back fence's, and the bench's unless it
   * says the cat has taken the bench.
   */
  private buildSigns(c: BuildCtx, bench: THREE.Group): [number, number, number][] {
    const { L, b, mat, woodTex } = c;
    // Two notice boards whose text changes each day: one on the back fence, one by the bench.
    const signs = pickSigns(this.lang);
    const taken = this.visitors.list.some((v) => v.id === "cat");
    if (taken) signs.bench = { text: "Bench: taken" };
    // The fish swims in the pond (#209): "No fish." is put right by hand (#364).
    const fish = this.visitors.list.some((v) => v.id === "fish");
    signs.fence = fishSign(signs.fence, fish);
    signs.bench = fishSign(signs.bench, fish);
    const noticeBoard = (line: SignLine, x: number, z: number, turn: number) => {
      const g = new THREE.Group();
      const board = signBoard(c, T.pixelTexture(line.fix ? T.fixedNotice(line.text, line.fix.strike, line.fix.write) : T.notice(line.text)), 1.2, 0.48);
      board.position.y = 0.95;
      if (line.upsideDown) board.rotation.z = Math.PI;
      g.add(board);
      for (const sx of [-0.45, 0.45]) {
        // Behind the board with a gap: a post in the board's plane fights it and shows through the text.
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.86, 0.06), mat(woodTex));
        post.position.set(sx, 0.43, -0.06);
        g.add(post);
      }
      g.position.set(x, 0, z);
      g.rotation.y = turn;
      this.scene.add(g);
      this.hitBoxes.push(boardBox(x, z, 1.2, NOTICE_TOP, turn));
    };
    noticeBoard(signs.fence, L.gate.x, b.minZ + 0.25, 0);
    noticeBoard(signs.bench, bench.position.x + BENCH_SIGN.dx, bench.position.z + BENCH_SIGN.dz, 0.35);
    const tops: [number, number, number][] = [[L.gate.x, NOTICE_TOP, b.minZ + 0.25]];
    if (!taken) tops.push([bench.position.x + BENCH_SIGN.dx, NOTICE_TOP, bench.position.z + BENCH_SIGN.dz]);
    // The snail's finish line (where it set off), on a small board just inside the gate, facing the garden.
    if (this.visitors.list.some((v) => v.id === "snail")) {
      const g = new THREE.Group();
      const board = signBoard(c, T.pixelTexture(T.notice(SNAIL_SIGN)), 1.0, 0.4);
      board.position.y = 0.62;
      g.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), mat(woodTex));
      post.position.set(0, 0.25, -0.05);
      g.add(post);
      g.position.set(L.gate.x + GATE_HALF + 1.7, 0, b.maxZ - 0.3);
      g.rotation.y = Math.PI - 0.25;
      this.scene.add(g);
      this.hitBoxes.push(boardBox(g.position.x, g.position.z, 1.0, 0.82, g.rotation.y));
    }
    return tops;
  }

  /** Small stakes, and the sleeping bloom's z's. */
  private buildStakes(c: BuildCtx) {
    const { L, mat, woodTex } = c;
    // Small stakes (#58, #61): one in an empty garden, and the first word's, forever, in front of its plant.
    const stake = (text: string, x: number, z: number, w: number, y: number, turn = 0) => {
      const g = new THREE.Group();
      const board = signBoard(c, T.pixelTexture(T.notice(text)), w, w * 0.4);
      board.position.y = y;
      g.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, y, 0.04), mat(woodTex));
      post.position.set(0, y / 2, -0.03);
      g.add(post);
      g.position.set(x, 0, z);
      g.rotation.y = turn;
      this.scene.add(g);
      this.hitBoxes.push(boardBox(x, z, w, y + w * 0.2, turn));
    };
    const first = L.beds[0];
    // Front right of the empty bed, where the card in the middle does not hide it.
    if (this.visitors.reserved && !L.plants.length) stake(this.visitors.reserved, first.x + first.w / 2 - 0.32, first.z + first.d / 2 - 0.3, 0.64, 0.56, -0.3);
    const keepsake = this.visitors.keepsake;
    const kept = keepsake ? L.plants.find((p) => p.id === keepsake.id) : undefined;
    if (keepsake && kept) {
      const bed = L.beds[kept.bed];
      stake(keepsake.text, kept.x, bed.z + bed.d / 2 + 0.16, 0.5, 0.36);
    }
    const sleeper = this.visitors.sleeper ? L.plants.find((p) => p.id === this.visitors.sleeper) : undefined;
    this.critters.buildSnore(c, sleeper, plantHeight);
  }

  /** The sunflower that turns its back on you. */
  private buildSunflower(c: BuildCtx) {
    // One sunflower in the far right corner, by the back fence. Unlike every other
    // sprite, it does not look at you: from the garden you see the back of its head,
    // and only from the back path, with the sun behind you, its face.
    const { x, z } = sunflowerAt(c.L);
    const flowerMesh = sprites(T.pixelTexture(T.sunflower()), [{ x, y: 0, z, u: 0.5, v: 0, uw: 0.5, vh: 1, phase: 1.3, droop: 0, scale: 1, index: -5 }], 0.85, 1.7);
    this.hitBoxes.push(spriteBox("sunflower", x, 0, z, 0.24, 1.62));
    const geo = flowerMesh.geometry;
    this.flower = { x, z, uv: geo.getAttribute("iUv") as THREE.InstancedBufferAttribute, params: geo.getAttribute("iParams") as THREE.InstancedBufferAttribute, face: null };
    this.mats.add(flowerMesh.material);
    this.scene.add(flowerMesh);
  }

  /** Wild bits: tufts, flowers, mushrooms, stones. Thick outside, a few by the fence and pond. */
  private buildDecor(c: BuildCtx) {
    const { L, b, w, d, cx, cz, rand } = c;
    const hedge = hedgeSpan(L);
    const decorTex = T.pixelTexture(T.decor());
    const decor: SpriteItem[] = [];
    const put = (x: number, z: number, kind: number, scale = 0.42, y = 0.01) => decor.push({ x, y, z, u: kind * 0.25, v: 0, uw: 0.25, vh: 1, phase: rand() * 6, droop: 0, scale, index: -4 });
    for (let i = 0; i < 420; i++) {
      const a = rand() * Math.PI * 2;
      const rad = Math.max(w, d) / 2 + 0.6 + rand() * 22;
      const x = cx + Math.cos(a) * rad;
      const z = cz + Math.sin(a) * rad;
      if (x > b.minX - 0.3 && x < b.maxX + 0.3 && z > b.minZ - 0.3 && z < b.maxZ + 0.3) continue;
      // Nothing behind the hedge either (#315).
      if (z > b.maxZ && x > hedge[0] && x < hedge[1]) continue;
      put(x, z, rand() < 0.62 ? 0 : rand() < 0.75 ? 1 : rand() < 0.5 ? 2 : 3, 0.42, -0.06);
    }
    for (let i = 0; i < Math.round((w + d) * 1.2); i++) {
      const t = rand();
      const side = Math.floor(rand() * 3);
      const [x, z] = side === 0 ? [b.minX + 0.25, b.minZ + t * d] : side === 1 ? [b.maxX - 0.25, b.minZ + t * d] : [b.minX + t * w, b.minZ + 0.25];
      put(x, z, rand() < 0.6 ? 0 : 1, 0.36);
    }
    for (let i = 0; i < 12; i++) {
      const a = rand() * Math.PI * 2;
      put(L.pond.x + Math.cos(a) * (L.pond.r + 0.3), L.pond.z + Math.sin(a) * (L.pond.r + 0.3), [3, 3, 0, 2][i % 4], 0.38);
    }
    // Two stones at the pond's edge by the fence, where the key may hide (#315). Always there, so they give nothing away.
    // A fixed phase, not rand(): the sky and critters after this keep their random sequence.
    const stones = keyAt(L, "pond");
    for (const [dz, scale] of [[-0.32, 0.4], [0.3, 0.32]]) decor.push({ x: stones.x + 0.05, y: 0.01, z: stones.z + dz, u: 0.75, v: 0, uw: 0.25, vh: 1, phase: 0, droop: 0, scale, index: -4 });
    for (const it of decor) {
      const k = DECOR_KINDS[Math.round(it.u * 4)];
      if (k) this.hitBoxes.push(spriteBox(k.id, it.x, Math.max(0, it.y), it.z, k.half * it.scale, k.top * it.scale));
    }
    const decorMesh = sprites(decorTex, decor);
    this.mats.add(decorMesh.material);
    this.scene.add(decorMesh);
  }

  /** The marker over the selected plant, always on top of the hills and clouds; the ring on the ground where a walk goes; the glint on the thing in reach. */
  private buildMarker() {
    // Always on top: no depth test, and in the transparent pass with the highest
    // renderOrder, because the far hills and clouds draw in that pass after the
    // opaque one (and a mesh without a depth test writes no depth to stop them).
    this.marker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.28),
      new THREE.MeshBasicMaterial({ map: T.pixelTexture(T.marker()), alphaTest: 0.5, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    this.scene.add(this.marker);
    // Where a walk goes (#336): flat on the ground, a little above the path so it never flickers into it.
    this.spot = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: T.pixelTexture(T.spot()), alphaTest: 0.5, transparent: true, depthWrite: false }));
    this.spot.rotation.x = -Math.PI / 2;
    this.spot.visible = false;
    this.scene.add(this.spot);
    // The glint on the thing in reach (#334): not tinted or fogged, as a glint is bright at dusk too.
    this.cue = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.pixelTexture(T.glint()), transparent: true, depthWrite: false, fog: false }));
    this.cue.visible = false;
    this.scene.add(this.cue);
  }

  /** The visitor under a point on the canvas (CSS pixels), if any. */
  pickVisitor(cssX: number, cssY: number, cssW: number, cssH: number): VisitorView | null {
    // The hedge hides the visitors on its other side (#315): a bird in the orchard from the garden, the garden's from the orchard.
    return this.guests.pick(cssX, cssY, cssW, cssH, (x, y, z) => this.behindHedge(x, y, z));
  }

  /** Show a visitor's tag for a few seconds (after a tap). */
  tapVisitor(id: VisitorId) {
    this.guests.tap(id);
    this.clearTaps({ scenery: true, tree: true, line: true, find: true });
  }

  /**
   * The scenery under a point on the canvas (CSS pixels), with its word, or
   * null. Ask only after the plants and visitors: they come first. One ray
   * through volumes built with the garden; it runs on a tap, not every frame.
   */
  pickScenery(cssX: number, cssY: number, cssW: number, cssH: number): { view: SceneryView; hit: SceneryHit } | null {
    const words = this.visitors.scenery;
    if (!words) return null;
    const hit = pickScenery(this.ray(cssX, cssY, cssW, cssH), this.sceneryWorld(), (id) => !!words[id]);
    return hit ? { view: words[hit.id]!, hit } : null;
  }

  /**
   * Open ground a tap walks to (#336), out of reach, inside the fence or the
   * open orchard, with nothing in front of it; else null. Ask after the
   * plants, visitors, trees and door, before the scenery: the ground in reach
   * and the grass outside the fence still name themselves.
   */
  pickGround(cssX: number, cssY: number, cssW: number, cssH: number): { x: number; z: number } | null {
    const g = groundAt(this.ray(cssX, cssY, cssW, cssH), this.sceneryWorld());
    if (!g || Math.hypot(g.x - this.x, g.z - this.z) < GROUND_REACH) return null;
    const b = this.layout.bounds;
    const o = this.layout.orchard;
    const inGarden = g.x > b.minX && g.x < b.maxX && g.z > b.minZ && g.z < b.maxZ;
    const inOrchard = !!this.orchard && Math.abs(g.x - o.x) < o.w / 2 && Math.abs(g.z - o.z) < o.d / 2;
    return inGarden || inOrchard ? g : null;
  }

  /** Everything a tap can meet in the garden itself, as it stands now (the clouds and the sun move). */
  private sceneryWorld(): SceneryWorld {
    return {
      boxes: this.hitBoxes,
      discs: this.hitDiscs,
      bounds: this.layout.bounds,
      far: FOG_FAR,
      hills: { radius: HILLS.radius, bottom: HILLS.y - HILLS.height / 2, top: HILLS.y + HILLS.height / 2, profile: this.sky.hillProfile, rows: T.HILL_ROWS, repeat: HILLS.repeat },
      sunDir: this.sky.sunDir,
      night: this.shown === "night",
      sunRadius: 0.045,
      clouds: this.sky.cloudPositions,
      cloudHalf: [8.8, 5],
    };
  }

  /** Show a scenery word's tag for a few seconds (after a tap). One tag at a time: a visitor's tapped tag goes. */
  tapScenery(s: { view: SceneryView; hit: SceneryHit }) {
    this.sceneryTap = { ...s, until: this.elapsed + 4 };
    this.clearTaps({ tree: true, line: true, visitor: true, find: true });
  }

  frogAwake(): boolean {
    return this.guests.frogAwake();
  }

  /** A visitor says something in a small bubble for a few seconds (the frog's croak). */
  say(id: VisitorId, text: string) {
    this.guests.say(id, text);
    this.clearTaps({ line: true });
  }

  /** Rasterises every plant's sprite, then builds the streaming pool (#323: scenePlants.ts). */
  async loadPlants(): Promise<void> {
    await this.plants.loadPlants({ scene: this.scene, mats: this.mats });
    // The walk may have been left (and disposed) while the sprites rasterised: nothing to tint then.
    if (this.disposed) return;
    const total = this.layout.plants.length;
    // Nothing to tint, stream or report in an empty garden: loadPlants above already returned at once.
    if (!total) return;
    // The new plants take the time of day on show; while time speeds up on the bench, the next frame blends them too.
    this.showTime(this.shown);
    this.cb.onProgress(total, total);
  }

  setTime(t: TimeOfDay) {
    this.time = t;
    // Time sped up on the bench (#362) runs on from the time chosen now.
    this.lapse = 0;
    this.lapsing = false;
    this.sky.blend(null, 0);
    this.showTime(t);
  }

  /** Show a time of day: the sky, what is lit, who is awake, the tint and the fog. The one chosen, or one on the way while time speeds up on the bench (#362). */
  private showTime(t: TimeOfDay) {
    this.shown = t;
    const c = conditions(t);
    for (const part of this.parts) part.onConditions?.(c);
    this.tintNow.copy(LIGHT[t].tint);
    this.fogNow.copy(LIGHT[t].fog);
    this.tint();
    this.lit.visible = c.dark;
    this.unlit.visible = !c.dark;
    for (const g of this.glows) g.visible = c.dark;
    this.birdByKey();
    // The sunflower droops a little at dusk.
    this.flower.params.setY(0, t === "dusk" ? 0.14 : 0);
    this.flower.params.needsUpdate = true;
  }

  /** A key left waiting a few days (#334): at dusk and night the bird, if it is here today, lands by it; not while it sits with you on the bench (#362). */
  private birdByKey() {
    const help = this.keyHelp;
    if (help?.visitors && this.door.key && !this.come.has("bird")) this.guests.visit("bird", this.shown !== "day" ? [this.door.key.x + 0.2, 0, this.door.key.z - 0.1] : null);
  }

  /** Tint everything unlit and every sprite with tintNow, and fog them with fogNow. Allocates nothing: the time-lapse on the bench (#362) calls it every frame. */
  private tint() {
    const tint = this.tintNow;
    const fog = this.fogNow;
    this.fog.color.copy(fog);
    for (const m of this.basic) m.color.copy(tint);
    for (const mats of this.tinted)
      for (const mat of mats) {
        mat.uniforms.uTint.value.copy(tint);
        mat.uniforms.uFog.value.copy(fog);
      }
    this.guests.tint(tint, fog);
  }

  private detail: Detail = "normal";
  private size: [number, number] = [1, 1];

  setDetail(d: Detail) {
    this.detail = d;
    this.resize(...this.size);
  }

  resize(cssW: number, cssH: number) {
    this.size = [cssW, cssH];
    // A small framebuffer scaled up by CSS with hard pixels. A whole number of
    // device pixels per game pixel keeps every pixel the same size.
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.round((cssW * dpr) / DETAIL[this.detail]));
    this.renderer.setSize(Math.round((cssW * dpr) / scale), Math.round((cssH * dpr) / scale), false);
    this.camera.aspect = cssW / cssH;
    this.camera.updateProjectionMatrix();
    // Framebuffer pixels per metre at 1 m, for the z's point size.
    this.critters.resize(Math.round((cssH * dpr) / scale) / (2 * Math.tan((this.camera.fov * Math.PI) / 360)));
  }

  /**
   * The plant hears its name (#60): it perks up for a moment. On about one
   * listen in 30 its nearest neighbour perks up too, a little late, as if it
   * thought you called it. Nothing moves with reduced motion.
   */
  nod(p: PlacedPlant) {
    this.plants.nod(p, this.elapsed, this.reducedMotion);
  }

  look(dx: number, dy: number) {
    this.glide = null;
    this.lookedRound();
    // A walk goes on, but the viewer looks where they like now.
    if (this.trip) this.trip.turn = false;
    this.yaw -= dx * 0.0055;
    this.pitch = Math.max(-0.75, Math.min(0.5, this.pitch - dy * 0.004));
  }

  /** The viewer looks where they like now: on the bench (#362), the head no longer turns to who comes. */
  private lookedRound() {
    this.seatView.looked = true;
    this.turnTo = null;
  }

  /** Walk straight ahead (or back, if negative) by `metres`. */
  step(metres: number) {
    this.glide = null;
    this.endTrip();
    this.standUp();
    ({ x: this.x, z: this.z } = walk(this.layout, this.x, this.z, this.x - Math.sin(this.yaw) * metres, this.z - Math.cos(this.yaw) * metres, this.door.state === "open", this.trunks));
  }

  turn(amount: number) {
    this.glide = null;
    this.lookedRound();
    if (this.trip) this.trip.turn = false;
    this.yaw += amount;
  }

  /** Walk to open ground (#336, a tap on it). */
  walkTo(x: number, z: number) {
    this.goTo(x, z, 0, null);
  }

  /** A tap on a plant (#336): its card opens where you stand when its name shows; from farther away, you walk to it first. */
  tapPlant(p: PlacedPlant) {
    if (Math.hypot(p.x - this.x, p.z - this.z) < NAME_NEAR) {
      // A walk under way stops: the viewer is looking at this plant now.
      this.endTrip();
      return this.select(p);
    }
    this.select(null);
    const v = viewpoint(this.layout, p);
    // On arrival, the short glide that faces the plant, as Next plant does, and its card.
    this.goTo(v.x, v.z, 0, () => this.select(p, true));
  }

  /** Walk round whatever is in the way to (x, z), or as near as a walker may stand, then stop `stop` m short and do `then`. */
  private goTo(x: number, z: number, stop: number, then: (() => void) | null) {
    const open = this.door.state === "open";
    const free = (px: number, pz: number) => {
      const p = collide(this.layout, px, pz, WALKER, open);
      return collideTrees(this.trunks, p.x, p.z, WALKER);
    };
    // A glide (Next plant) passes over beds; a tap during one starts from where a walker would stand.
    ({ x: this.x, z: this.z } = free(this.x, this.z));
    this.standUp();
    const to = free(x, z);
    this.glide = null;
    this.trip = { way: wayTo(this.layout, this.x, this.z, to.x, to.z, open, this.trunks), leg: 1, stop, then, turn: !this.reducedMotion, stuck: 0 };
    this.spot.position.set(to.x, 0.03, to.z);
    this.spot.visible = true;
  }

  private endTrip() {
    this.trip = null;
    this.spot.visible = false;
  }

  /**
   * One frame of a walk (#336): toward the next corner at walking speed (world.ts walkStep).
   * The view turns gently toward where it goes; with reduced motion it keeps still, and the walk moves at an even pace.
   */
  private walkOn(dt: number) {
    const g = this.trip!;
    this.at.x = this.x;
    this.at.z = this.z;
    const now = walkStep(this.layout, g, this.at, WALK * dt, dt, this.door.state === "open", this.trunks);
    this.x = this.at.x;
    this.z = this.at.z;
    if (now === "arrived") {
      const then = g.then;
      this.endTrip();
      return then?.();
    }
    if (now === "stalled") {
      this.endTrip();
      // Once per walk in the garden: a broken way is worth one report, not one a tap.
      if (!this.stallReported) this.cb.onStall();
      this.stallReported = true;
      return;
    }
    this.bob += dt * WALK * 3.2;
    const [cx, cz] = g.way[g.leg];
    if (g.turn && g.stuck === 0) {
      // Forward is -z at yaw 0; turn the short way round.
      let d = Math.atan2(-(cx - this.x), -(cz - this.z)) - this.yaw;
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      this.yaw += d * Math.min(1, dt * TRIP_TURN);
    }
  }

  /** Select the plant under a point on the canvas (CSS pixels), if any. */
  pick(cssX: number, cssY: number, cssW: number, cssH: number): PlacedPlant | null {
    return this.plants.pick(cssX, cssY, cssW, cssH);
  }

  /** Is the hedge between the eye and this point? */
  private behindHedge(x: number, y: number, z: number): boolean {
    const c = this.camera.position;
    const d = Math.hypot(x - c.x, y - c.y, z - c.z);
    return this.hedgeAt({ ox: c.x, oy: c.y, oz: c.z, dx: (x - c.x) / d, dy: (y - c.y) / d, dz: (z - c.z) / d }) < d;
  }

  /**
   * One tap (CSS pixels): the visitor, plant, orchard tree, door or key, the bowl and its things (#351),
   * a joke (#364), open ground to walk to (#336), or scenery word it meets, in that order —
   * the chain GardenWalk.tsx used to run itself as sequential if-returns
   * (#323). Every pick here is pure (no side effects), so asking all of them
   * and keeping the first match in TAP_PRIORITY is exactly that chain's
   * short-circuit, as one table instead.
   */
  pickAny(cssX: number, cssY: number, cssW: number, cssH: number): TapHit | null {
    const hits: Partial<Record<TapHit["kind"], TapHit>> = {};
    const v = this.pickVisitor(cssX, cssY, cssW, cssH);
    if (v) hits.visitor = { kind: "visitor", v };
    const p = this.pick(cssX, cssY, cssW, cssH);
    if (p) hits.plant = { kind: "plant", p };
    const t = this.pickTree(cssX, cssY, cssW, cssH);
    if (t) hits.tree = { kind: "tree", t };
    const d = this.pickDoor(cssX, cssY, cssW, cssH);
    if (d) hits.door = { kind: "door", a: d };
    const l = this.pickLeave(cssX, cssY, cssW, cssH);
    if (l) hits.bowl = { kind: "bowl", t: l };
    const j = this.pickJoke(cssX, cssY, cssW, cssH);
    if (j) hits.joke = { kind: "joke", j };
    const g = this.pickGround(cssX, cssY, cssW, cssH);
    if (g) hits.walk = { kind: "walk", ...g };
    const s = this.pickScenery(cssX, cssY, cssW, cssH);
    if (s) hits.scenery = { kind: "scenery", s };
    for (const kind of TAP_PRIORITY) {
      const hit = hits[kind];
      if (hit) return hit;
    }
    return null;
  }

  select(p: PlacedPlant | null, walkTo = false) {
    this.selected = p;
    if (p) this.clearTaps({ scenery: true, tree: true, find: true });
    const index = p ? this.layout.plants.indexOf(p) : -1;
    for (const mat of this.mats) mat.uniforms.uSelected.value = index;
    this.marker.visible = !!p;
    if (p && walkTo) {
      this.endTrip();
      this.standUp();
      const v = viewpoint(this.layout, p);
      // Turn the short way round.
      let yaw = v.yaw;
      while (yaw - this.yaw > Math.PI) yaw -= Math.PI * 2;
      while (yaw - this.yaw < -Math.PI) yaw += Math.PI * 2;
      // Look at the flower head, not the stem, so the view stays nearly level
      // and the plant sits above the card at the bottom of the screen.
      const top = BED_H + plantHeight(p.growth);
      const pitch = Math.max(-0.18, Math.min(0.05, Math.atan2(top - EYE, Math.hypot(p.x - v.x, p.z - v.z))));
      if (this.reducedMotion) {
        [this.x, this.z, this.yaw, this.pitch] = [v.x, v.z, yaw, pitch];
      } else {
        // From the orchard, out through the door (#315): a longer way, so a little longer.
        const path = route(this.layout, this.x, this.z, v.x, v.z);
        this.glide = { path, yaw: [this.yaw, yaw], pitch: [this.pitch, pitch], t: 0, s: path.length > 2 ? 1.8 : 0.9 };
      }
    }
    this.cb.onSelect(p);
  }

  start() {
    const loop = () => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.elapsed += dt;
      this.tick(dt);
    };
    loop();
  }

  private tick(dt: number) {
    const t = this.elapsed;
    const motion = this.reducedMotion ? 0 : 1;

    // Walking: forward is -z at yaw 0.
    const { move, run } = this.input;
    const len = Math.hypot(move.x, move.y);
    if (len > 0.01) {
      this.glide = null;
      if (this.trip) this.endTrip();
      this.standUp();
      const speed = WALK * (run ? 2 : 1) * Math.min(1, len);
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const nx = this.x + ((fx * move.y + -fz * move.x) / Math.max(1, len)) * speed * dt;
      const nz = this.z + ((fz * move.y + fx * move.x) / Math.max(1, len)) * speed * dt;
      ({ x: this.x, z: this.z } = walk(this.layout, this.x, this.z, nx, nz, this.door.state === "open", this.trunks));
      this.bob += dt * speed * 3.2;
    }
    if (this.trip) this.walkOn(dt);
    if (this.glide) {
      const g = this.glide;
      g.t = Math.min(1, g.t + dt / g.s);
      const e = g.t < 0.5 ? 2 * g.t * g.t : 1 - (-2 * g.t + 2) ** 2 / 2;
      ({ x: this.x, z: this.z } = along(g.path, e));
      this.yaw = g.yaw[0] + (g.yaw[1] - g.yaw[0]) * e;
      this.pitch = g.pitch[0] + (g.pitch[1] - g.pitch[0]) * e;
      if (g.t >= 1) this.glide = null;
    }

    this.onBench(dt);
    // Sitting down or standing up: the eye sinks or rises over a moment (at once, with reduced motion).
    const sat = this.seated ? 1 : 0;
    this.seat = this.reducedMotion ? sat : this.seat + Math.max(-dt * SEAT.speed, Math.min(dt * SEAT.speed, sat - this.seat));
    this.camera.position.set(this.x, EYE - (EYE - SEAT.eye) * this.seat + Math.sin(this.bob) * 0.035 * motion, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.updateMatrixWorld();

    for (const mat of this.mats) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uSway.value = motion;
    }
    // One frame, ticked into every part in the fixed order `parts` documents:
    // sky (clouds, water, the sun), the door (its swing and the key's glint),
    // critters (fireflies, butterflies, the sleeping bloom's z's), plants
    // (chunk culling — beds outside the fog are skipped — streaming the
    // plants nearest you, and the perk uniform), then the visitors.
    const frame = this.tickFrame;
    frame.dt = dt;
    frame.elapsed = t;
    frame.x = this.x;
    frame.z = this.z;
    frame.yaw = this.yaw;
    for (const part of this.parts) part.tick?.(frame);
    // The thing in reach glints now and then (#334); with reduced motion, a still glint.
    if (this.cue.visible) {
      const k = t % CUE.every;
      this.cue.scale.setScalar(this.reducedMotion ? 0.12 : k < CUE.flash ? 0.04 + 0.16 * Math.sin((Math.PI * k) / CUE.flash) : 0);
    }
    if (this.selected) {
      const p = this.selected;
      this.marker.position.set(p.x, BED_H + plantHeight(p.growth) + 0.32 + Math.sin(t * 3) * 0.05 * motion, p.z);
      this.marker.quaternion.copy(this.camera.quaternion);
    }

    // The sunflower shows its face only to someone standing in its sun (and never at night).
    const fl = this.flower;
    const face = sunflowerFaces(fl.x, fl.z, this.x, this.z, this.sky.sunDir.x, this.sky.sunDir.z, this.shown === "night");
    if (face !== fl.face) {
      fl.face = face;
      fl.uv.setX(0, face ? 0 : 0.5);
      fl.uv.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
    this.labels();
  }

  /** Names over the nearest plants, as DOM text so they stay crisp and readable. */
  private labels() {
    const v = this.tmp;
    const out: Label[] = this.plants.labelsNear(this.x, this.z, v);
    out.push(...this.plants.petals(this.elapsed, v));
    const tags: Partial<Record<(typeof LABEL_PRIORITY)[number], Label>> = {};

    // A tapped scenery word (#74) is the one tag while it shows: no visitor tag beside it.
    const st = this.sceneryTap;
    if (st && this.elapsed > st.until) this.sceneryTap = null;
    else if (st) {
      const h = st.hit;
      if (h.follow === "sun") v.copy(this.camera.position).addScaledVector(this.sky.sunDir, SUN_DIST).y += SUN_DIST * SUN_TAG;
      else if (h.follow) {
        const cloud = this.sky.cloudPosition(h.follow.cloud);
        v.set(cloud.x, h.y, cloud.z);
      }
      else v.set(h.x, h.y, h.z);
      v.project(this.camera);
      if (v.z <= 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1)
        tags.scenery = { id: `scenery:${st.view.id}`, text: st.view.word, gloss: st.view.gloss, known: st.view.known, kind: "scenery", x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: 1 };
    }
    // The door's quiet line (#315), while it shows.
    const ln = this.line;
    if (ln && this.elapsed > ln.until) this.line = null;
    else if (ln) {
      v.set(...ln.at).project(this.camera);
      // Kept on the screen: standing right at the door, its top is above the view, and the line must still be read.
      if (v.z <= 1) tags.line = { id: "line", text: ln.text, kind: "line", x: onScreen((v.x + 1) / 2), y: onScreen((1 - v.y) / 2), near: 1 };
    }
    // A tapped orchard tree's word (#315), over its crown; kept on the screen, as a tall tree's top is often above the view.
    const tt = this.treeTap;
    if (tt && this.elapsed > tt.until) this.treeTap = null;
    else if (tt) {
      v.set(tt.tree.x, tt.tree.height + 0.08, tt.tree.z).project(this.camera);
      if (v.z <= 1) tags.tree = { id: `tree:${tt.tree.id}`, text: tt.tree.lemma, gloss: tt.tree.gloss, kind: "tree", x: onScreen((v.x + 1) / 2), y: onScreen((1 - v.y) / 2), near: 1 };
    }
    // A find's word and meaning (#351), over where it lay; kept on the screen.
    const ft = this.foundTap;
    if (ft && this.elapsed > ft.until) this.foundTap = null;
    else if (ft) {
      v.set(...ft.at).project(this.camera);
      if (v.z <= 1) tags.find = { id: "find", text: ft.word, gloss: ft.gloss, kind: "find", x: onScreen((v.x + 1) / 2), y: onScreen((1 - v.y) / 2), near: 1 };
    }
    // A visitor's approach tag shows only while none of line/find/scenery/tree is active (clearTaps keeps at most one of those set at a time).
    const exclusiveActive = !!(this.sceneryTap || this.treeTap || this.line || this.foundTap);
    const { say, tag } = this.guests.labels(this.x, this.z, !exclusiveActive);
    if (say) tags.say = say;
    if (tag) tags.tag = tag;
    // One table for what shows over what: say (a visitor's bubble) always; then whichever of line/scenery/tree is active; last, a visitor's tag.
    for (const kind of LABEL_PRIORITY) {
      const l = tags[kind];
      if (l) out.push(l);
    }
    this.reportReach();
    const key = out.map((l) => `${l.id}${l.text}${l.x.toFixed(3)}${l.y.toFixed(3)}${l.near.toFixed(2)}`).join();
    if (key !== this.lastLabels) {
      this.lastLabels = key;
      this.cb.onLabels(out);
    }
  }

  /**
   * Tell the page what the action button does now (#334): stand up from the
   * bench, pick up the key, pick up a find (#351), open or try the door, the
   * rest of leave it out's (leave or follow at the bowl, hang on the shelf,
   * take from the basket or the shelf), sit on the bench, or shake the plant
   * ahead of you (#357), for whichever is in reach (in that order); or nothing.
   * The thing in reach glints (the cue).
   */
  private reportReach() {
    const d = this.door;
    const b = this.bench;
    const nearKey = d.state === "key" && this.inReach("key");
    const nearDoor = d.state !== "open" && this.inReach("try");
    const nearBench = Math.hypot(this.x - b.x, this.z - b.z) < BENCH_REACH;
    // A find at your feet comes before the door: the gate post's feather lies in the door's reach.
    const leave = this.seated || nearKey ? null : this.leaveIt.reachAt(this.x, this.z);
    const mine = leave && (leave.a === "find" || !nearDoor) ? leave : null;
    const before: Reach | null = this.seated ? "stand" : nearKey ? "key" : mine?.a === "find" ? "find" : nearDoor ? (d.state === "held" ? "open" : "try") : mine ? mine.a : nearBench ? "sit" : null;
    const plant = before ? null : plantInReach(this.layout.plants, this.x, this.z, this.yaw);
    const a: Reach | null = plant ? "shake" : before;
    const target = mine?.target ?? null;
    // Targets are made once (LeaveItOut.reachAt), so the same target is the same object.
    if (a === this.reach && target === this.leaveTarget && plant === this.shakeTarget) return;
    this.reach = a;
    this.leaveTarget = target;
    this.shakeTarget = plant;
    const at = a === "key" && d.key ? [d.key.x + 0.08, 0.1, d.key.z] : a === "try" || a === "open" ? d.handle : target ? this.leaveIt.cueAt(target) : a === "sit" ? [b.x, 0.55, b.z + 0.1] : plant ? [plant.x, BED_H + plantHeight(plant.growth) * 0.6, plant.z] : null;
    this.cue.visible = !!at;
    if (at) this.cue.position.set(at[0], at[1], at[2]);
    this.cb.onReach(a);
  }

  dispose() {
    this.disposed = true;
    for (const part of this.parts) part.dispose?.();
    cancelAnimationFrame(this.frame);
    this.orchard?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        if (mat instanceof THREE.ShaderMaterial) for (const u of Object.values(mat.uniforms)) if (u.value instanceof THREE.Texture) u.value.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    // getContext can throw instead of returning null in some browsers: either way, no WebGL.
    return false;
  }
}
