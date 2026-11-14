// The walkable word garden, a paper diorama: unlit textures, fog, and flat
// sprite plants that turn to face you. Loaded only when the garden is opened. The game itself (its
// state and rules) is game.ts: this scene feeds it the input and the taps,
// steps it each frame, and draws what it holds (#975).

import * as THREE from "three";
import { rng } from "../lib/seed";
import { yieldToBrowser } from "../lib/yield";
import { BED_H, BENCH, collide, DOOR_HALF, HEDGE, hedgeSpan, keyAt, sunflowerAt, WALKER, type Layout, type PlacedPlant } from "./world";
import * as R from "./reachCore";
import * as W from "./walker";
import { benchLine, pickTree, treeVisitorSpots } from "./orchard";
import { buildOrchard, type Orchard } from "./orchardScene";
import { gateHedge, orchardHedge } from "./hedge";
import * as T from "./textures";
import { plantHeight as plantHeightOf } from "../ui/plant";
import { fishSign, keepsakeLabel, pickSigns, SIGNS, sunflowerFaces, type SignLine } from "./whimsy";
import { GATE_HALF, SNAIL_SIGN, visitor, type FrogWords, type VisitorId } from "./visitors";
import { SceneVisitors, type Hider } from "./sceneVisitors";
import { RAIL, type Ledge, type Spots } from "./spots";
import { conditions } from "./conditions";
import { DETAIL, DetailPicker, type Detail } from "./detail";
import { boardBox, DECOR_KINDS, groundAt, pickScenery, rayBox, rayDisc, spriteBox, SUN_TAG, thingAt, TREE_KINDS, type HitBox, type HitDisc, type Ray, type SceneryWorld } from "./scenery";
import { HILLS, SKY_R, SkyWater } from "./sceneSky";
import { Hedge } from "./sceneHedge";
import { Door, DOOR } from "./sceneDoor";
import { Critters } from "./sceneCritters";
import { Plants } from "./scenePlants";
import { Lanterns } from "./sceneLanterns";
import { HILLTOP_R, hillY } from "./lookout";
import { LookoutThings } from "./sceneLookout";
import { stileAt } from "./stile";
import { StileScene } from "./sceneStile";
import { FULL_MOON } from "./moon";
import { TAP_PRIORITY, type Frame, type Part, type TapAt, type TapHit, type Tapper } from "./scenePart";
import { shedRoof, shedStep } from "./shed";
import { buildShed, ShedNotes } from "./sceneNotes";
import { Carry } from "./sceneCarry";
import type { CarryDone } from "./carry";
import { Toys } from "./sceneToys";
import type { ToyDone } from "./toys";
import { bareNoun } from "./nouns";
import { petalForms } from "./shake";
import type { Gender } from "../deck/schema";
import type { DeckLang } from "../deck/langs";
import { Jokes } from "./sceneJokes";
import { thingsInView, type SceneState } from "./sceneState";
import { WalkInto } from "./sceneWalkInto";
import { leafPiles, type Fell } from "./walkInto";
import { FOG_FAR, FOG_NEAR, PLANT_SCALE, plantHeight, signBoard, sprites, SPRITE_H, still, woodBox, type BuildCtx, type SpriteItem } from "./sceneSprites";
import type { Companion } from "./bench";
import { RESERVED } from "../content/voice";
import { dayNumber } from "../core/day";
import type { Hideout, Reply } from "./kinds/kind";
import { EYE, Game, SCENERY_TAG, type GameHooks, type TimeOfDay, type WalkVisitors } from "./game";

/**
 * Where the bench's notice board stands, from the bench (it turns 0.35 rad toward
 * the bench). Far enough right that its 1.2 m board clears the 1.3 m bench.
 */
const BENCH_SIGN = { dx: 1.45, dz: -0.05 };
/** The height of the top of a notice board (m). */
const NOTICE_TOP = 1.19;
/** The height of the top of the bench's back (m). */
const BENCH_BACK = 0.8;
/** The height of the top of the bench's seat (m). */
const BENCH_SEAT = 0.45;

/** Walk into things (#359): a plant brushed past plays its word's note (a bloom's clear, a younger plant's soft); a tree walked into let something fall; a leaf pile burst. */
export type WalkIntoEvent = { did: "brush"; word: string; clear: boolean } | { did: "bump"; fell: Fell; word: string } | { did: "pile" };

/** A name over a plant, a visitor's tag (kind "visitor"), a tapped scenery word (kind "scenery") or orchard tree (kind "tree"), what a visitor says (kind "say"), a quiet line from the garden itself over a thing in it (kind "line"; English, or a joke's in the course language) or over no thing (kind "far", the far light's answer, #858), a form falling from a shaken plant (kind "petal", #357; no text: a leaf), or the well's echo (kind "echo", #335 S6: the word, and the day it was met as its gloss), in screen fractions. */
export interface Label {
  id: string;
  text: string;
  x: number;
  y: number;
  /** 0 to 1: how close (plant names), or how much of a visitor tag shows. */
  near: number;
  kind?: "visitor" | "scenery" | "tree" | "say" | "line" | "far" | "petal" | "fruit" | "echo";
  gloss?: string;
  /** A noun plant's gender: the shape of its label's stake (#357). */
  gender?: Gender;
  /** A visitor whose noun the learner knows: plant-label styling with a tiny leaf. */
  known?: boolean;
  /** Where a visitor hid today, once it is found (#379): said after its word. */
  where?: Hideout;
  /** What a tapped scenery thing makes you think (#864), in the course language: shown under its word. */
  thought?: string;
}

export interface SceneCallbacks {
  onSelect: (p: PlacedPlant | null) => void;
  onLabels: (labels: Label[]) => void;
  onProgress: (done: number, total: number) => void;
  /** What the action button does now, for the thing in reach (#334); null with nothing in reach (no button, #835). */
  onReach: (a: R.Reach | null) => void;
  /** You picked up a pebble, or let it go (#358). */
  onHand: (holding: boolean) => void;
  /** A plant was shaken (#357): the forms that fell from it ([]: one leaf). */
  onShake: (p: PlacedPlant, forms: string[]) => void;
  /** Carry (#358): a loose thing was picked up or put down, or it landed. */
  onCarry: (done: CarryDone) => void;
  /** A dandelion clock was blown (#360). */
  onToy: (done: ToyDone) => void;
  /** The learner opened the door with the key: it stays open (saved with the course). */
  onDoorOpen: () => void;
  /** A gardener's note was opened (#654), by its id. */
  onNote: (id: string) => void;
  /** Sitting on the bench (#362): who just came to sit with you, or null once you stand up. */
  onCompany: (c: Companion | null) => void;
  /** What a screen reader hears about the visitors now (#376: a goat up high, a mole caught), or null. */
  onVisitorStatus: (line: string | null) => void;
  /** A walk to a tapped spot stalled (#336): a way wayTo should never give. At most once per scene. */
  onStall: () => void;
  /** Even the lowest detail cannot keep up (#677): the median frame, in ms. Once per walk. */
  onTooSlow: (medianMs: number, detail: Detail) => void;
  /** The walker brushed a plant, bumped a tree or burst a leaf pile (#359). */
  onWalkInto: (e: WalkIntoEvent) => void;
  /** Every lantern is out and the stars are out over the hills, or no longer (#361). */
  onStars: (out: boolean) => void;
}

/**
 * The longest frame the garden runs in full (s). Down to 10 frames a second
 * the garden runs in real time: a walk is as fast and a visitor's wait as long
 * (#790; at 0.05, CI's software WebGL ran it at a third of its speed). Below
 * that it runs slower, so a walk still moves in steps short enough to see the
 * stile's top board, and a gap (a hidden tab, a stalled load) is not one jump.
 */
const MAX_FRAME = 0.1;
/** A tap past the back fence counts this near (m) to where a walker may stand (#770): at a bramble's foot, say. */
const TAP_SLACK = 0.5;
/** How far a ray goes between looks for the ground, on the hill (m). */
const GROUND_STEP = 0.1;
/** Ground nearer than this (m) is in reach (#336): a tap on it names the path, as before; farther ground is walked to. */
const GROUND_REACH = 1.5;
/** The view's height (degrees), and on the lookout's stool (#858) a little narrower: the far house and its lantern nearer the middle. */
const FOV = 62;
const STOOL_FOV = 50;
/** A line over no point in the garden (the far light's answer, #858): how far down the view, above the action button. */
const LOW_LINE = 0.72;
/** No tree outside the back fence within this far (m) either side of the stile (#714): the old path is seen from its top board. */
const STILE_VIEW = 2.5;
/** How far away the sun (or moon) is drawn, along its direction from the eye. */
const SUN_DIST = 200;

/** Each time of day's tint for everything unlit, and its fog, made once: the time-lapse on the bench (#362) blends them every frame. */
const LIGHT: Record<TimeOfDay, { tint: THREE.Color; fog: THREE.Color }> = {
  day: { tint: new THREE.Color(...T.SKIES.day.tint), fog: new THREE.Color(T.SKIES.day.fog) },
  dusk: { tint: new THREE.Color(...T.SKIES.dusk.tint), fog: new THREE.Color(T.SKIES.dusk.fog) },
  night: { tint: new THREE.Color(...T.SKIES.night.tint), fog: new THREE.Color(T.SKIES.night.fog) },
};

/** A label's place kept on the screen (a fraction of it), for lines that must be read even when their point is out of view. `edge`: how far in from each side its middle stays. */
const onScreen = (k: number, edge = 0.12) => Math.max(edge, Math.min(1 - edge, k));

/** How far in from each side a thought's tag stays: half of its widest (index.css .gw-thought, 15rem), on a phone 412 px wide. */
const THOUGHT_EDGE = 0.3;
/** The highest a thought's point goes: its tag is drawn above the point, and two or three lines tall it would go under the top pill. */
const THOUGHT_TOP = 0.24;

/**
 * The order GardenScene.labels pushes a tag in, when more than one shows at
 * once: a visitor's "say" bubble (the frog's croak) first; the well's echo; then whichever of
 * line/fruit/scenery/tree is active (game.ts clearTaps keeps at most one of
 * those three set); a visitor's approach tag last. One table, like
 * TAP_PRIORITY.
 */
const LABEL_PRIORITY = ["say", "echo", "line", "fruit", "scenery", "tree", "tag"] as const;

/** A wooden bench: a seat facing +z, a back rest behind it, four legs. The one by the pond, and the orchard's (#315). */
function benchModel(c: Pick<BuildCtx, "mat" | "woodTex">): THREE.Group {
  const bench = new THREE.Group();
  const wood = c.mat(c.woodTex, { vertexColors: true });
  const plank = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(woodBox(w, h, d), wood);
    m.position.set(x, y, z);
    bench.add(m);
  };
  plank(1.3, 0.06, 0.4, 0, BENCH_SEAT - 0.03, 0);
  plank(1.3, 0.28, 0.05, 0, BENCH_BACK - 0.14, -0.2);
  for (const sx of [-0.55, 0.55]) for (const sz of [-0.15, 0.15]) plank(0.06, 0.42, 0.06, sx, 0.21, sz);
  return bench;
}

export class GardenScene {
  private renderer: THREE.WebGLRenderer;
  // The scene itself never moves. three recomposes a moving object's matrix on every frame, and then remakes the
  // world matrix of everything under it: with the scene's own on, that was every object, still() ones too (#571).
  private scene = Object.assign(new THREE.Scene(), { matrixAutoUpdate: false });
  // Far enough to see the sky dome from anywhere inside the hills: a big garden's far corner is well off the world's middle (#641).
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, SKY_R + HILLS.radius);
  private last = performance.now();
  private frame = 0;
  private disposed = false;
  /** The garden's state and rules (#975): this scene feeds it, steps it and draws it. */
  readonly game: Game;
  /** The one clock read (DESIGN.md, Garden code): when the walk opened. The game and the build both take it from here. */
  private readonly opened = new Date();
  /** The ring on the ground where a walk goes. */
  private spot!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** Carry (#358): the pebbles as drawn. */
  private carry: Carry;
  /** Walking into things (#359): bumping orchard trees and bursting leaf piles. */
  private walkInto: WalkInto;
  /** The lawn toys (#360): the dandelion clocks. */
  private toys: Toys;
  /** The gardener's notes in the shed (#654). */
  private notes: ShedNotes;
  /** The way out of the back fence (#714, #749): the thicket, and the stile once the hill's note is unlocked. */
  private stile: StileScene | null = null;
  /** The stool and the diary on the hill's top (#858), null with the hill. */
  private readonly lookoutThings: LookoutThings | null;
  private readonly tintNow = new THREE.Color();
  private readonly fogNow = new THREE.Color();
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
  /** The sunflower: where it stands, its sprite's frame and lean, and which side it shows (null: not drawn yet). */
  private flower!: { x: number; z: number; uv: THREE.InstancedBufferAttribute; params: THREE.InstancedBufferAttribute; face: boolean | null };
  private readonly fog = new THREE.Fog(0xffffff, FOG_NEAR, FOG_FAR);
  /** The sprite materials tint() tints itself (the visitors tint their own). */
  private tinted: readonly Set<THREE.ShaderMaterial>[];
  private lastLabels = "";
  /** What a screen reader last heard about the visitors (#376). */
  private lastHeard: string | null = null;
  private tmp = new THREE.Vector3();
  /** Filled in place every tick: tick allocates nothing (DESIGN.md, Garden code). */
  private readonly tickFrame: Frame = { dt: 0, elapsed: 0, x: 0, z: 0, yaw: 0, speed: 0 };
  /** What a tap can name in the garden itself (#74), built once. The clouds and the sun are read at tap time. */
  private hitBoxes: HitBox[] = [];
  private hitDiscs: HitDisc[] = [];
  /** The lanterns where paths cross (#361), as drawn. */
  private lanterns: Lanterns;
  /** The door in the hedge (#315), and the key (#323: sceneDoor.ts). */
  private door: Door;
  /** The gate's hedge and, once the door opens, the orchard's (#323). Not a Part: nothing to tick, react to conditions, or dispose. */
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
  /** What the world is built with, kept for the orchard, which is built when the door opens. */
  private ctx!: BuildCtx;
  /** The orchard's tree atlas, painted in a worker during the build (#571), for when the door opens. */
  private orchardAtlas!: THREE.Texture;
  readonly input: W.Input = { move: { x: 0, y: 0 }, run: false };

  private layout: Layout;
  private cb: SceneCallbacks;
  private reducedMotion: boolean;

  /** The course language: the signs and everything else written in the world are in it (#650). */
  private lang: DeckLang;
  private visitors: WalkVisitors;
  /** Today's visitors in the walk (sceneVisitors.ts). */
  private guests: SceneVisitors;

  /** @param msaa Smooth the edges of shapes (#1106). The WebGL context keeps it for its whole life. */
  constructor(canvas: HTMLCanvasElement, layout: Layout, cb: SceneCallbacks, reducedMotion: boolean, lang: DeckLang, visitors: WalkVisitors, msaa: boolean) {
    this.layout = layout;
    this.cb = cb;
    this.reducedMotion = reducedMotion;
    this.lang = lang;
    this.visitors = visitors;
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: msaa, powerPreference: "low-power" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    // Reading the shader logs on a program's first use waits for the GPU: ~10 ms of a first draw at CPU 10× (#571).
    // Dev and the e2e tests still read them, so a broken shader fails there.
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.camera.rotation.order = "YXZ";
    this.plants = new Plants(
      this.renderer,
      this.camera,
      layout,
      (d, total) => this.cb.onProgress(d, total),
      (x, y, z) => this.behindHedge(x, y, z),
      (p) => this.cb.onWalkInto({ did: "brush", word: p.lemma, clear: p.stage === "bloom" }),
      visitors.moon === FULL_MOON,
    );
    this.guests = new SceneVisitors(
      {
        scene: this.scene,
        camera: this.camera,
        layout,
        // The visitors stay in the garden: they are drawn on flat ground, not on the stile or the hill (#770).
        // The door and the trees are read when asked: the door opens during a walk.
        ground: { layout, doorOpen: () => this.game.door.state === "open", trees: () => this.game.trunks, back: null },
        reducedMotion,
        lang,
        elapsed: () => this.game.elapsed,
        bedTop: BED_H,
        // The plant's own drawn height (its genome and meaning too), as its sprite shows it.
        plantTop: (p) => BED_H + (plantHeightOf(p.lemma, p.growth, 1) / T.VIEW_H) * SPRITE_H * PLANT_SCALE,
        sprite: (tex, x, y, z, u, v, uw, vh, size) => {
          const mesh = sprites(tex, [{ x, y, z, u, v, uw, vh, phase: 0, droop: 0, scale: 1, index: -6 }], size, size);
          mesh.material.uniforms.uSway.value = 0;
          return mesh;
        },
        lying: (tex, x, y, z, u, v, uw, vh, lying, size) => sprites(tex, [{ x, y, z, u, v, uw, vh, phase: 0, droop: 0, scale: 1, index: -6 }], size, size * lying, true),
      },
      visitors.list,
    );
    const game = new Game(layout, lang, visitors, reducedMotion, this.opened.getTime(), this.hooks(), this.guests);
    this.game = game;
    this.sky = new SkyWater(this.camera, reducedMotion, game.lookout);
    this.critters = new Critters(this.camera, reducedMotion);
    this.door = new Door(reducedMotion, game.door);
    this.jokes = new Jokes(this.camera, reducedMotion, game.mouse);
    this.walkInto = new WalkInto(
      reducedMotion,
      (tree, fell, fruit) => {
        if (fruit) game.fruitFell(tree, fruit);
        this.cb.onWalkInto({ did: "bump", fell, word: tree.lemma });
      },
      () => this.cb.onWalkInto({ did: "pile" }),
    );
    this.carry = new Carry(layout, reducedMotion, game.pebbles);
    this.toys = new Toys(game.clocks, reducedMotion);
    this.notes = new ShedNotes(game.shed);
    this.lanterns = new Lanterns(game.lamps);
    this.lookoutThings = game.hill ? new LookoutThings(game.hill, game.diary) : null;
    this.parts = [this.sky, this.door, this.critters, this.plants, this.guests, this.jokes, this.walkInto, this.carry, this.toys, this.lanterns];
    this.tinted = [this.mats, this.walkInto.mats, this.carry.mats];
    this.scene.fog = this.fog;
  }

  /** When the current slice of build or warm work began (performance.now ms). */
  private sliceFrom = 0;

  /**
   * Between steps of the build and the warm-up: lets the browser paint and take
   * input once this slice has run SLICE_MS (#459: in one task, the build blocked
   * the page for most of a second on a slow laptop). True if the walk was left meanwhile.
   */
  private async stopped(): Promise<boolean> {
    if (performance.now() - this.sliceFrom < SLICE_MS) return this.disposed;
    await yieldToBrowser();
    this.sliceFrom = performance.now();
    return this.disposed;
  }

  /**
   * Builds the static world, part by part, a slice at a time; the plants
   * follow (they need rasterising). Keep the order: the parts share one random sequence.
   */
  async build(): Promise<void> {
    this.sliceFrom = performance.now();
    // Painted in workers while the steps before the trees, and the door, run.
    const far = T.paintFar(this.visitors.moon);
    const orchardAtlas = T.paintOrchard();
    const fonts = T.loadBoardFonts();
    const L = this.layout;
    const b = L.bounds;
    const c: BuildCtx = {
      L,
      lang: this.lang,
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
      woodTex: T.paperTexture(T.wood(), true),
      rand: rng(1),
      scene: this.scene,
      hitBoxes: this.hitBoxes,
      hitDiscs: this.hitDiscs,
      mats: this.mats,
      basic: this.basic,
    };
    this.ctx = c;
    this.buildGround(c);
    if (await this.stopped()) return;
    // The bed signs are the first boards drawn.
    await fonts;
    for (const _bed of this.plants.build(c)) if (await this.stopped()) return;
    this.buildFence(c);
    if (await this.stopped()) return;
    this.buildHedge(c);
    if (await this.stopped()) return;
    const { pads } = this.sky.buildPond(c);
    if (await this.stopped()) return;
    const farTex = await far;
    this.buildTrees(c, farTex.trees);
    if (await this.stopped()) return;
    this.lanterns.build(c);
    if (await this.stopped()) return;
    const bench = this.buildBench(c);
    if (await this.stopped()) return;
    const boards = this.buildSigns(c, bench);
    if (await this.stopped()) return;
    // What is where today (DESIGN.md, Garden code): from the one clock read.
    const now = this.opened;
    const g = this.game;
    // The mat says the doormat's word as a mat would: the bare word, in capitals.
    const welcome = this.visitors.scenery?.doormat?.word;
    this.jokes.build(c, g.bench, now, welcome ? bareNoun(welcome).toUpperCase() : null);
    if (await this.stopped()) return;
    // The garden's age, in calendar days since the first review (#379).
    const first = this.visitors.firstReview;
    this.guests.build(this.spots(pads, boards, now), now, first === null ? 0 : dayNumber(now) - dayNumber(first));
    if (await this.stopped()) return;
    this.scene.add(buildShed(c, this.layout));
    this.notes.build(c);
    // The hill is there whenever the stile is (game.ts).
    if (g.stileNotes && g.stileSpot && g.hill && this.lookoutThings) {
      // Draws no random numbers.
      this.stile = new StileScene(g.stileSpot, g.hill, g.hillOpen, g.stileNotes);
      for (const _step of this.stile.build(c)) if (await this.stopped()) return;
      this.lookoutThings.build(c);
    }
    this.toys.build(c);
    if (await this.stopped()) return;
    // Draws no random numbers either.
    this.carry.build();
    this.scene.add(this.carry.root);
    g.placeWaiting();
    // Even with the door shut: it may open in this walk.
    this.orchardAtlas = await orchardAtlas;
    // After the visitors: a visitor may sit in the orchard's trees today.
    if (g.door.state === "open") this.openDoorView(false);
    if (await this.stopped()) return;
    this.buildStakes(c);
    if (await this.stopped()) return;
    this.buildSunflower(c);
    if (await this.stopped()) return;
    this.buildDecor(c);
    if (await this.stopped()) return;
    this.sky.buildSkyAndSun(c, farTex);
    if (await this.stopped()) return;
    this.critters.build(c);
    if (await this.stopped()) return;
    this.walkInto.build(c, this.visitors.autumn);
    this.buildMarker();
    g.setTime(g.time);
    await this.warm([...this.scene.children]);
  }

  /**
   * Compiles the shaders and uploads the textures before the first frame, a
   * slice at a time (#459): the first render did both in one long task. One step
   * per mesh with a new material, and one per texture: a whole part was up to 26 ms
   * at CPU 10× (#571). The GPU links the shaders while the slices yield, and the
   * first draws wait for the links. `parts`: children of the scene.
   */
  private async warm(parts: THREE.Object3D[]): Promise<void> {
    // The scene's fog without its objects: compile() walks the whole target scene for lights on
    // every call, and the garden has none. The fog is part of each shader's cache key.
    const target = new THREE.Scene();
    target.fog = this.fog;
    const meshes = new Set<string>();
    const textures = new Set<THREE.Texture>();
    const linked: Promise<unknown>[] = [];
    // Without the extension there is no link status to wait for (each program counts as ready at once), and
    // compileAsync would warn on every page: compile alone does the same.
    const parallel = this.renderer.extensions.has("KHR_parallel_shader_compile");
    for (const child of parts) {
      for (const o of firstOfEach(child, meshes)) {
        if (parallel) linked.push(this.renderer.compileAsync(o, this.camera, target));
        else this.renderer.compile(o, this.camera, target);
        if (await this.stopped()) return;
        for (const mat of materialsOf(o))
          for (const t of texturesOf(mat)) {
            if (textures.has(t)) continue;
            textures.add(t);
            this.renderer.initTexture(t);
            if (await this.stopped()) return;
          }
      }
    }
    // Without the wait, the first draw of a material blocks until the GPU has linked its program.
    await Promise.all(linked);
    this.sliceFrom = performance.now();
    if (this.disposed) return;
    await this.drawOnce(parts);
    if (this.disposed) return;
    await this.gpuDone();
  }

  /**
   * Waits, without blocking, until the GPU has done all the work queued so far.
   * The uploads and links of the warm-up run in the GPU process after it ends: the next
   * call that must wait for that process (a resize, a uniform, any state change) blocked
   * the first frames for 10-20 ms at CPU 10× (#571). A fence lets the browser poll instead.
   */
  private async gpuDone(): Promise<void> {
    const gl = this.renderer.getContext();
    // three has made only WebGL 2 contexts since r163; its type still names WebGL 1.
    if (!(gl instanceof WebGL2RenderingContext)) throw new Error("the walk needs WebGL 2");
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    // Null only when the context is lost: then there is no GPU work to wait for.
    if (!fence) return;
    gl.flush();
    while (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) {
      // A timer, not scheduler.yield: Chrome updates the status in a task of its own, which a yield's continuation runs ahead of.
      await new Promise((r) => setTimeout(r, 1));
      if (this.disposed) break;
    }
    gl.deleteSync(fence);
    this.sliceFrom = performance.now();
  }

  /**
   * Draws each mesh with a new material once into one pixel, a slice at a time.
   * compile() leaves part of a material's setup to its first draw: its program and
   * uniforms. On the first frame, that took about 200 ms in one task at CPU 10× (#459),
   * and a whole part per draw up to 44 ms (#571). Only what the camera sees now is drawn,
   * as on the first frame. Each draw hides the other parts, and puts the one mesh on a
   * layer of its own for the camera, and undoes both in the same slice: the loop may be
   * drawing frames between slices (the plants are warmed after start).
   */
  private async drawOnce(parts: THREE.Object3D[]): Promise<void> {
    const all = this.scene.children;
    // One array for every part, filled by index: an array (and an entry pair per child) per part was ~10 MB of garbage (#459).
    const shown: boolean[] = [];
    const frustum = new THREE.Frustum();
    const drawn = new Set<string>();
    for (const p of parts) {
      if (!p.visible) continue;
      // Only this part's matrices: updating the whole scene's on every draw cost more than the draws.
      p.updateMatrixWorld();
      this.camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
      for (const o of firstOfEach(p, drawn, frustum)) {
        for (let i = 0; i < all.length; i++) {
          shown[i] = all[i].visible;
          all[i].visible = all[i] === p;
        }
        const seen = this.camera.layers.mask;
        this.camera.layers.set(WARM_LAYER);
        o.layers.enable(WARM_LAYER);
        this.scene.matrixWorldAutoUpdate = false;
        this.renderer.setScissorTest(true);
        this.renderer.setScissor(0, 0, 1, 1);
        try {
          this.renderer.render(this.scene, this.camera);
        } finally {
          this.renderer.setScissorTest(false);
          this.scene.matrixWorldAutoUpdate = true;
          o.layers.disable(WARM_LAYER);
          this.camera.layers.mask = seen;
          for (let i = 0; i < all.length; i++) all[i].visible = shown[i];
        }
        if (await this.stopped()) return;
      }
    }
  }

  /** Ground: grass everywhere, a path surface inside the fence. */
  private buildGround(c: BuildCtx) {
    const { w, d, cx, cz, mat } = c;
    const grassTex = T.paperTexture(T.grass(), true);
    grassTex.repeat.set(400 / T.GROUND_TILE, 400 / T.GROUND_TILE);
    // At 0, where everything in the garden stands (#861). Drawn behind what lies on it in the same plane (the yard's path, the hill's grass at its foot) by depth alone, so they never flicker into it.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(grassTex, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(still(ground));
    const pathTex = T.paperTexture(T.path(), true);
    pathTex.repeat.set(w / T.GROUND_TILE, d / T.GROUND_TILE);
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(pathTex));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(cx, 0, cz);
    this.scene.add(still(yard));
  }

  /** The picket fence, with a gap on the gate side where the door in the hedge is. */
  private buildFence(c: BuildCtx) {
    const { L, b, mat } = c;
    const fenceTex = T.paperTexture(T.picket(), true);
    const fence = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.1) return;
      const t = fenceTex.clone();
      t.repeat.set(len / 1.0, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.8), mat(t, { transparent: false, alphaTest: 0.5, side: THREE.DoubleSide }));
      m.position.set((x1 + x2) / 2, 0.4, (z1 + z2) / 2);
      m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      this.scene.add(still(m));
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
    this.door.build(c, L);
  }

  /** The door is open for good: the swing (`swing`; none with reduced motion), and what lies behind it is built now. */
  private openDoorView(swing: boolean) {
    this.door.open(swing);
    // The orchard's own hedge, round the far sides, so it is a walled garden.
    const o = this.layout.orchard;
    this.hedge.addWalls(this.ctx, orchardHedge(this.layout), 4);
    const { firstPlanted } = this.visitors.orchard;
    const orchard = buildOrchard(
      {
        parent: this.scene,
        sprites,
        atlas: this.orchardAtlas,
        bench: () => benchModel(this.ctx),
        mat: this.ctx.mat,
        plaque: firstPlanted === null ? null : benchLine(firstPlanted, this.lang),
      },
      o,
      this.game.trunks,
    );
    this.orchard = orchard;
    this.walkInto.setOrchard(orchard.trees, orchard.params);
    for (const m of orchard.mats) this.mats.add(m);
    this.hitBoxes.push(...orchard.scenery);
    // Built after setTime when the door opens in this walk: give it the time of day now.
    this.tint();
  }

  /**
   * Where visitors can sit today (spots.ts), from the world built so far: the
   * pond's pads, the lanterns, the bench, the notice boards, the first bed's
   * sign and the fence's rail, autumn's leaf piles, the high places the goat
   * stands on and, when the walk starts
   * with the door open, the orchard's trees.
   */
  private spots(pads: [number, number][], boards: [number, number, number][], now: Date): Spots {
    const L = this.layout;
    const b = L.bounds;
    const first = L.beds[0];
    // After the back fence's board: the first bed's sign (scenePlants.ts) and the fence's rail on either side.
    const sign: [number, number, number] = [first.x - first.w / 2 - 0.3, 0.93, first.z + first.d / 2 + 0.3];
    const perches: [number, number, number][] = [
      boards[0],
      sign,
      [b.maxX - 0.06, RAIL, (b.maxZ + first.z) / 2],
      [b.minX + 0.06, RAIL, first.z - 1],
      // On top of the hedge, right of the door (the goat's place is to the left).
      [L.gate.x + 2.2, HEDGE.height + 0.12, b.maxZ + HEDGE.gap + 0.25],
      ...boards.slice(1),
    ];
    // Only when the walk starts with the door open: a visitor the learner may be looking at
    // does not vanish from the garden as the door opens. Visitors that came another way
    // (the gnome, the moth...) have no garden word and never sit in the trees.
    const brought = new Set(this.visitors.list.flatMap((v) => visitor(v.id).garden ?? []));
    const orchard = this.visitors.door === "open" ? this.game.trunks : [];
    const trees = treeVisitorSpots(orchard, brought, now);
    const piles = this.visitors.autumn ? leafPiles(L) : [];
    // On top of the hedge left of the door, just behind its front, on the leaves that stand above it; on the back fence's board, beside where a bird sits; on the bench's back, clear of the sitter and the bird.
    const [sx, sy, sz] = boards[0];
    const ledges: Ledge[] = [
      { on: "hedge", at: [L.gate.x - 2.2, HEDGE.height + 0.12, b.maxZ + HEDGE.gap + 0.25] },
      { on: "shed", at: shedRoof(L) },
      { on: "sign", at: [sx - 0.3, sy, sz] },
      { on: "bench", at: [this.game.bench.x + 0.15, BENCH_BACK, this.game.bench.z - 0.2] },
    ];
    return { bench: this.game.bench, shedStep: shedStep(L), pads, lanterns: this.game.lamps.spots, perches, sign, trees, orchard, piles, ledges };
  }

  /** The ray from the eye through a point on the canvas (CSS pixels). */
  private ray(cssX: number, cssY: number, cssW: number, cssH: number): Ray {
    const c = this.camera;
    const d = this.tmp.set((cssX / cssW) * 2 - 1, -(cssY / cssH) * 2 + 1, 0.5).unproject(c).sub(c.position).normalize();
    return { ox: c.position.x, oy: c.position.y, oz: c.position.z, dx: d.x, dy: d.y, dz: d.z };
  }

  /** What a tap does at the door, if it meets the key or the shut door (CSS pixels). Ask after the plants and visitors, before the scenery. */
  private pickDoor({ r }: TapAt): TapHit<"door"> | null {
    const d = this.game.door;
    if (d.state === "open") return null;
    const L = this.layout;
    const z0 = L.bounds.maxZ + HEDGE.gap;
    const toDoor = rayBox(r, [L.gate.x - DOOR_HALF, 0, z0 - 0.05], [L.gate.x + DOOR_HALF, DOOR.h, z0 + DOOR.thick + 0.05]);
    // A small thing on the ground: a generous disc round it, so a finger finds it.
    // From farther than its reach too: a tap there walks to it first (tapDoor, #336). There, whatever
    // stands in front of it (a lantern, the sunflower) is what the tap meets; in reach the key comes first, as it did.
    const disc = d.key && d.state === "key" ? rayDisc(r, d.key.x, 0.03, d.key.z, 0.3) : Infinity;
    const toKey = disc < Infinity && !R.doorInReach(this.game.things, this.game.me.x, this.game.me.z, "key", 0) && thingAt(r, this.sceneryWorld()) < disc ? Infinity : disc;
    if (Math.min(toDoor, toKey) > FOG_FAR) return null;
    if (toKey <= toDoor) return { kind: "door", a: "key" };
    return { kind: "door", a: d.state === "held" ? "open" : "try" };
  }

  // What the page asks of the garden: each goes to the game (game.ts), which says what happens.
  act(a: R.Reach) {
    this.game.act(a);
  }
  shake(p: PlacedPlant) {
    this.game.shake(p);
  }
  doorAct(a: R.DoorAction) {
    this.game.doorAct(a);
  }
  readDiary(id: string) {
    this.game.readDiary(id);
  }
  setTime(t: TimeOfDay) {
    this.game.setTime(t);
  }
  look(dx: number, dy: number) {
    this.game.look(dx, dy);
  }
  step(metres: number) {
    this.game.stepAhead(metres);
  }
  turn(amount: number) {
    this.game.turn(amount);
  }
  select(p: PlacedPlant | null, walkTo = false) {
    this.game.select(p, walkTo);
  }

  /** What the game tells this scene to show (game.ts GameHooks). */
  private hooks(): GameHooks {
    return {
      plantTop: (p) => BED_H + plantHeight(p.growth),
      select: (p) => {
        const i = p ? this.layout.plants.indexOf(p) : -1;
        for (const m of this.mats) m.uniforms.uSelected.value = i;
        this.marker.visible = !!p;
        this.cb.onSelect(p);
      },
      shake: (p, forms) => {
        this.plants.shake(p, forms, this.game.elapsed, this.reducedMotion);
        this.cb.onShake(p, forms);
      },
      nod: (p) => this.nod(p),
      sneeze: (i) => this.plants.sneeze(i, this.game.elapsed),
      hand: (holding) => this.cb.onHand(holding),
      carry: (done) => this.cb.onCarry(done),
      toy: (done) => this.cb.onToy(done),
      keyTaken: () => this.door.keyTaken(),
      doorOpen: () => {
        this.openDoorView(true);
        this.cb.onDoorOpen();
      },
      read: (on, id) => {
        switch (on) {
          case "shed":
            return this.notes.read(id);
          // A stile note and a diary page are read only where the game has a stile and a hill: the build made them.
          case "stile":
            return this.stile!.show();
          case "mat":
            return this.jokes.showNote();
          case "diary":
            return this.lookoutThings!.show();
          default:
            return on satisfies never;
        }
      },
      open: (id) => this.cb.onNote(id),
      company: (c) => this.cb.onCompany(c),
      stall: () => this.cb.onStall(),
      reach: (o) => {
        this.notes.lift(o?.on === "note" ? o.target : null);
        this.plants.ready(o?.on === "plant" ? o.target : null);
        this.cb.onReach(o ? o.a : null);
      },
      stars: (out) => {
        this.sky.setStars(out);
        this.critters.setBright(out);
        this.cb.onStars(out);
      },
      time: (t) => this.light(t),
      blend: (look, race) => {
        this.sky.blend(look, race);
        if (!look) return;
        this.tintNow.copy(LIGHT[look.from].tint).lerp(LIGHT[look.to].tint, look.k);
        this.fogNow.copy(LIGHT[look.from].fog).lerp(LIGHT[look.to].fog, look.k);
        this.tint();
      },
      trip: (to) => {
        if (!to) {
          this.spot.visible = false;
          return;
        }
        this.spot.position.set(to.x, 0.03 + this.game.lift(to.x, to.z), to.z);
        this.spot.visible = true;
      },
      lantern: (i) => this.lanterns.show(i),
    };
  }

  /** The lantern under a point on the canvas (CSS pixels), while they are lit (#361), with nothing in front of it. */
  private pickLantern({ r }: TapAt): TapHit<"lantern"> | null {
    const got = this.lanterns.pick(r);
    if (!got || got.t > FOG_FAR || this.hedgeAt(r) < got.t || thingAt(r, this.sceneryWorld()) < got.t) return null;
    return { kind: "lantern", i: got.i };
  }

  /**
   * A loose thing under a point on the canvas (CSS pixels), with your hands
   * free; holding one, the well (a pebble), the pond to throw it in, or the
   * ground in reach to put it down.
   */
  private pickCarry({ r }: TapAt): TapHit<"carry"> | null {
    const w = this.sceneryWorld();
    const wall = Math.min(thingAt(r, w), this.hedgeAt(r));
    const pebbles = this.game.pebbles;
    if (pebbles.held === null) {
      const got = this.carry.pick(r);
      if (!got || got.t > FOG_FAR || this.hedgeAt(r) < got.t) return null;
      // From afar a tap walks there first: whatever stands in front of it is what the tap meets. In reach it comes first.
      return pebbles.standFor(got.target, this.game.me.x, this.game.me.z).near || wall >= got.t ? { kind: "carry", t: got.target } : null;
    }
    if (this.carry.pickWell(r) <= wall) return { kind: "carry", t: { at: "well" } };
    // The pond's own hit disc (sceneSky.ts) lies a few mm over the water and a rim wider: the water may be just behind it.
    const p = this.layout.pond;
    const water = rayDisc(r, p.x, 0.04, p.z, p.r);
    if (water < FOG_FAR && water < wall + 0.1) return { kind: "carry", t: { at: "water", x: r.ox + r.dx * water, z: r.oz + r.dz * water } };
    const g = groundAt(r, w);
    return g && Math.hypot(g.x - this.game.me.x, g.z - this.game.me.z) < GROUND_REACH ? { kind: "carry", t: { at: "ground", ...g } } : null;
  }

  /** The dandelion clock under a point on the canvas (CSS pixels), unless something stands in front of it. */
  private pickToy({ r }: TapAt): TapHit<"toy"> | null {
    const got = this.toys.pick(r);
    if (!got || got.t > FOG_FAR || this.hedgeAt(r) < got.t) return null;
    // From afar a tap walks there first: whatever stands in front of it is what the tap meets. In reach it comes first.
    const near = this.game.clocks.standFor(got.i, this.game.me.x, this.game.me.z).near;
    return near || thingAt(r, this.sceneryWorld()) >= got.t ? { kind: "toy", i: got.i } : null;
  }

  /** The mouse door, or the sundial at night (#364), under a point on the canvas (CSS pixels), with nothing in front of it. */
  private pickJoke({ r }: TapAt): TapHit<"joke"> | null {
    const got = this.jokes.pick(r);
    if (!got || got.t > FOG_FAR || thingAt(r, this.sceneryWorld()) < got.t) return null;
    return { kind: "joke", j: { line: got.line, spoken: got.spoken, at: got.at } };
  }

  /** The gardener's note (#654) under a point on the canvas (CSS pixels), with nothing in front of it. */
  private pickNote({ r }: TapAt): TapHit<"note"> | null {
    const shed = this.notes.pick(r);
    // Null: there is no stile yet.
    const step = this.stile?.pick(r) ?? null;
    // Null: the mouse door is shut (#882).
    const mat = this.jokes.pickNote(r);
    const near = [shed, step, mat].reduce<{ id: string; t: number } | null>((a, b) => (b && (!a || b.t < a.t) ? b : a), null);
    // Infinity: there is no diary yet. A tap on it opens it where it opens (Diary.page).
    const book = this.lookoutThings?.pick(r) ?? Infinity;
    // The book is drawn only where the game has a diary (game.ts).
    const got = book < (near ? near.t : Infinity) ? { id: this.game.diary!.page(), t: book } : near;
    if (!got || got.t > FOG_FAR || thingAt(r, this.sceneryWorld()) < got.t) return null;
    return { kind: "note", id: got.id };
  }

  /** How far along the ray the nearest hedge is, or Infinity: what lies past it is hidden. */
  private hedgeAt(r: Ray): number {
    let t = Infinity;
    for (const b of this.hitBoxes) if (b.id === "hedge") t = Math.min(t, rayBox(r, b.min, b.max));
    return t;
  }

  /** The orchard tree under a point on the canvas (CSS pixels), unless the hedge is in front of it (#315). Ask after the plants and visitors. */
  private pickTree({ r }: TapAt): TapHit<"tree"> | null {
    if (!this.orchard) return null;
    const got = pickTree(r, this.orchard.hits);
    if (!got || got.t > FOG_FAR || this.hedgeAt(r) < got.t) return null;
    return { kind: "tree", t: this.orchard.trees.find((t) => t.id === got.hit.id)! };
  }

  /** Trees and bushes outside the fence. */
  private buildTrees(c: BuildCtx, treeTex: THREE.Texture) {
    const { L, b, w, d, rand } = c;
    const hedge = hedgeSpan(L);
    const stileX = this.visitors.stile ? stileAt(L).x : null;
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
      const tx = x + nx * out + (rand() - 0.5);
      const tz = z + nz * out + (rand() - 0.5);
      const tree = {
        x: tx,
        // On the hill past the stile (#722), on its slope.
        y: this.game.hill ? hillY(this.game.hill, tx, tz) : 0,
        z: tz,
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
      // Nor on the old path past the stile (#714), so the view from its top board is open. After the rand() calls: the other trees stay where they were.
      if (stileX !== null && nz === -1 && Math.abs(tree.x - stileX) < STILE_VIEW) continue;
      // Nor on the hilltop's open grass (#770): only the brambles ring it.
      const hill = this.game.hill;
      if (hill && Math.hypot(tree.x - hill.top[0], tree.z - hill.top[1]) < HILLTOP_R + 0.5) continue;
      trees.push(tree);
    }
    for (const t of trees) {
      const k = TREE_KINDS[Math.round(t.u * 4)];
      this.hitBoxes.push(spriteBox(k.id, t.x, t.y, t.z, k.half * t.scale, k.top * t.scale));
    }
    const treeMesh = sprites(treeTex, trees);
    this.mats.add(treeMesh.material);
    this.scene.add(still(treeMesh));
  }

  /** A bench by the pond, for sitting and admiring. Returns where it stands. */
  private buildBench(c: BuildCtx): THREE.Group {
    const bench = benchModel(c);
    const at = this.game.bench;
    bench.position.set(at.x, 0, at.z);
    // Two cup rings on the seat, between where two would sit: small, seen only up close (#869, what the bench's line names).
    const rings = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.12), c.mat(T.paperTexture(T.cupRings()), { alphaTest: 0.5 }));
    rings.name = "cup rings";
    rings.rotation.x = -Math.PI / 2;
    rings.position.set(0.05, BENCH_SEAT + 0.002, 0.02);
    bench.add(rings);
    this.scene.add(still(bench));
    {
      // The seat and the back rest as two boxes, not one round both: sitting, the eye is over the seat and in front
      // of the back, so a tap looks out past the bench to what is under the finger (#868).
      const { x, z } = bench.position;
      const tag: [number, number, number] = [x, 0.88, z];
      this.hitBoxes.push({ id: "bench", min: [x - BENCH.half, 0, z - BENCH.back], max: [x + BENCH.half, BENCH_SEAT, z + BENCH.front], tag });
      this.hitBoxes.push({ id: "bench", min: [x - BENCH.half, 0, z - BENCH.back], max: [x + BENCH.half, BENCH_BACK, z - 0.15], tag });
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
    if (taken) signs.bench = { text: SIGNS[this.lang].taken };
    // The fish swims in the pond (#209): "no fish" is put right by hand (#364).
    const fish = this.visitors.list.some((v) => v.id === "fish");
    signs.fence = fishSign(signs.fence, fish, this.lang);
    signs.bench = fishSign(signs.bench, fish, this.lang);
    const noticeBoard = (line: SignLine, x: number, z: number, turn: number) => {
      const g = new THREE.Group();
      const board = signBoard(c, T.paperTexture(line.fix ? T.fixedNotice(line.text, line.fix.strike, line.fix.write) : T.notice(line.text)), 1.2, 0.48);
      board.position.y = 0.95;
      if (line.upsideDown) board.rotation.z = Math.PI;
      g.add(board);
      for (const sx of [-0.45, 0.45]) {
        // Behind the board with a gap: a post in the board's plane fights it and shows through the text.
        const post = new THREE.Mesh(woodBox(0.06, 0.86, 0.06), mat(woodTex, { vertexColors: true }));
        post.position.set(sx, 0.43, -0.06);
        g.add(post);
      }
      g.position.set(x, 0, z);
      g.rotation.y = turn;
      this.scene.add(still(g));
      this.hitBoxes.push(boardBox(x, z, 1.2, NOTICE_TOP, turn));
    };
    noticeBoard(signs.fence, L.gate.x, b.minZ + 0.25, 0);
    noticeBoard(signs.bench, bench.position.x + BENCH_SIGN.dx, bench.position.z + BENCH_SIGN.dz, 0.35);
    const tops: [number, number, number][] = [[L.gate.x, NOTICE_TOP, b.minZ + 0.25]];
    if (!taken) tops.push([bench.position.x + BENCH_SIGN.dx, NOTICE_TOP, bench.position.z + BENCH_SIGN.dz]);
    // The snail's finish line (where it set off), on a small board just inside the gate, facing the garden.
    if (this.visitors.list.some((v) => v.id === "snail")) {
      const g = new THREE.Group();
      const board = signBoard(c, T.paperTexture(T.notice(SNAIL_SIGN[this.lang])), 1.0, 0.4);
      board.position.y = 0.62;
      g.add(board);
      const post = new THREE.Mesh(woodBox(0.05, 0.5, 0.05), mat(woodTex, { vertexColors: true }));
      post.position.set(0, 0.25, -0.05);
      g.add(post);
      g.position.set(L.gate.x + GATE_HALF + 1.7, 0, b.maxZ - 0.3);
      g.rotation.y = Math.PI - 0.25;
      this.scene.add(still(g));
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
      const board = signBoard(c, T.paperTexture(T.notice(text)), w, w * 0.4);
      board.position.y = y;
      g.add(board);
      const post = new THREE.Mesh(woodBox(0.04, y, 0.04), mat(woodTex, { vertexColors: true }));
      post.position.set(0, y / 2, -0.03);
      g.add(post);
      g.position.set(x, 0, z);
      g.rotation.y = turn;
      this.scene.add(still(g));
      this.hitBoxes.push(boardBox(x, z, w, y + w * 0.2, turn));
    };
    const first = L.beds[0];
    // An empty garden (#58): "Reserved", at the front right of the empty bed, where the card in the middle does not hide it.
    if (!L.plants.length) stake(RESERVED[this.lang], first.x + first.w / 2 - 0.32, first.z + first.d / 2 - 0.3, 0.64, 0.56, -0.3);
    const keepsake = this.visitors.keepsake;
    const kept = keepsake ? L.plants.find((p) => p.id === keepsake.id) : undefined;
    if (keepsake && kept) {
      const bed = L.beds[kept.bed];
      stake(keepsakeLabel(keepsake.lemma, new Date(keepsake.at).toLocaleDateString(this.lang, { day: "numeric", month: "short" })), kept.x, bed.z + bed.d / 2 + 0.16, 0.5, 0.36);
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
    this.scene.add(still(flowerMesh));
  }

  /** Wild bits: tufts, flowers, mushrooms, stones. Thick outside, a few by the fence and pond. */
  private buildDecor(c: BuildCtx) {
    const { L, b, w, d, cx, cz, rand } = c;
    const hedge = hedgeSpan(L);
    const decorTex = T.cutoutTexture(T.decor());
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
    this.scene.add(still(decorMesh));
  }

  /** The marker over the selected plant, always on top of the hills and clouds; the ring on the ground where a walk goes. */
  private buildMarker() {
    // Always on top: no depth test, and in the transparent pass with the highest
    // renderOrder, because the far hills and clouds draw in that pass after the
    // opaque one (and a mesh without a depth test writes no depth to stop them).
    this.marker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.28),
      new THREE.MeshBasicMaterial({ map: T.paperTexture(T.marker()), alphaTest: 0.5, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    this.scene.add(this.marker);
    // Where a walk goes (#336): flat on the ground, a little above the path so it never flickers into it.
    this.spot = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: T.paperTexture(T.spot()), alphaTest: 0.5, transparent: true, depthWrite: false }));
    this.spot.rotation.x = -Math.PI / 2;
    this.spot.visible = false;
    this.scene.add(this.spot);
  }

  /** The visitor under a point on the canvas (CSS pixels), if any. */
  private pickVisitor(at: TapAt): TapHit<"visitor"> | null {
    // The hedge hides the visitors on its other side (#315): a bird in the orchard from the garden, the garden's from the orchard.
    const v = this.guests.pick(at.x, at.y, at.w, at.h, (x, y, z) => this.behindHedge(x, y, z));
    return v && { kind: "visitor", v };
  }

  /** The hiding visitor the action button would find now (#379), for the status a screen reader hears; null when it would find none. */
  hider(): Hider | null {
    const o = this.game.offer;
    return o?.on === "hider" ? this.guests.hider(o.target) : null;
  }

  /**
   * A tap on a visitor: what it says back (the awake frog croaks one of the
   * `frog` words, or says a line) in a small bubble for a few seconds, or else its tag. Returns what it said.
   */
  private tapVisitor(id: VisitorId, frog: FrogWords): Reply | null {
    const said = this.guests.tap(id, frog);
    this.game.visitorTapped(said);
    return said;
  }

  /**
   * The scenery under a point on the canvas (CSS pixels), with its word, or
   * null. Ask only after the plants and visitors: they come first. One ray
   * through volumes built with the garden; it runs on a tap, not every frame.
   */
  private pickScenery({ r }: TapAt): TapHit<"scenery"> | null {
    const words = this.visitors.scenery;
    if (!words) return null;
    const hit = pickScenery(r, this.sceneryWorld(), (id) => !!words[id]);
    return hit ? { kind: "scenery", s: { view: words[hit.id]!, hit } } : null;
  }

  /**
   * Open ground a tap walks to (#336), out of reach, inside the fence or the
   * open orchard, or on the open way past the back fence (#770), with nothing
   * in front of it; else null. Ask after the plants, visitors, trees and
   * door, before the scenery: the ground in reach and the grass outside the
   * fence still name themselves.
   */
  private pickGround({ r }: TapAt): TapHit<"walk"> | null {
    const w = this.sceneryWorld();
    const back = this.game.back;
    const g = back?.open ? this.groundPast(r, thingAt(r, w)) : groundAt(r, w);
    if (!g || Math.hypot(g.x - this.game.me.x, g.z - this.game.me.z) < GROUND_REACH) return null;
    const b = this.layout.bounds;
    const o = this.layout.orchard;
    const inGarden = g.x > b.minX && g.x < b.maxX && g.z > b.minZ && g.z < b.maxZ;
    const inOrchard = !!this.orchard && Math.abs(g.x - o.x) < o.w / 2 && Math.abs(g.z - o.z) < o.d / 2;
    // Past the fence, the cut way's or the hilltop's ground: where a walker may stand, or near enough that a tap at a bramble's foot counts.
    const s = collide(this.layout, g.x, g.z, WALKER, false, back);
    const past = g.z < b.minZ && Math.hypot(s.x - g.x, s.z - g.z) < TAP_SLACK;
    return inGarden || inOrchard || past ? { kind: "walk", ...g } : null;
  }

  /** Where a ray first meets the ground, the stile's steps and the hill too (#770), nearer than `far`; else null. */
  private groundPast(r: Ray, far: number): { x: number; z: number } | null {
    const at = (t: number) => r.oy + r.dy * t - this.game.lift(r.ox + r.dx * t, r.oz + r.dz * t);
    // In short steps until below the ground, then halved down to a centimetre.
    let b = GROUND_STEP;
    while (at(b) > 0) {
      b += GROUND_STEP;
      if (b >= far) return null;
    }
    let a = b - GROUND_STEP;
    while (b - a > 0.01) {
      const m = (a + b) / 2;
      if (at(m) > 0) a = m;
      else b = m;
    }
    return b >= far ? null : { x: r.ox + r.dx * b, z: r.oz + r.dz * b };
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
      night: this.game.shown === "night",
      sunRadius: 0.045,
      clouds: this.sky.cloudPositions,
      cloudHalf: [8.8, 5],
    };
  }

  /** Builds the plants' meshes, then draws their sprites, nearest first (#323, #459: scenePlants.ts). */
  async loadPlants(): Promise<void> {
    // A task of its own, apart from the first resize and start that come just before it (#459).
    await yieldToBrowser();
    if (this.disposed) return;
    this.plants.buildPlants({ scene: this.scene, mats: this.mats });
    const total = this.layout.plants.length;
    // Nothing to tint, draw or report in an empty garden: buildPlants built nothing.
    if (!total) return;
    // The new plants take the time of day on show; while time speeds up on the bench, the next frame blends them too.
    this.light(this.game.shown);
    // Their materials set up here, a slice at a time, not all on the next frame (~50 ms at CPU 10×, #459).
    await this.warm(this.plants.meshes());
    if (this.disposed) return;
    await this.plants.drawSprites();
    // The walk may have been left (and disposed) while the sprites were drawn.
    if (this.disposed) return;
    this.cb.onProgress(total, total);
  }

  /** Show a time of day: the sky, what is lit, who is awake, the tint and the fog. The one chosen, or one on the way while time speeds up on the bench (#362). */
  private light(t: TimeOfDay) {
    const c = conditions(t);
    for (const part of this.parts) part.onConditions?.(c);
    this.tintNow.copy(LIGHT[t].tint);
    this.fogNow.copy(LIGHT[t].fog);
    this.tint();
    // The sunflower droops a little at dusk.
    this.flower.params.setY(0, t === "dusk" ? 0.14 : 0);
    this.flower.params.needsUpdate = true;
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
  /** Picks the detail from frame times (#677), once the plants are loaded; null while they load, or when a test pins it. */
  private picker: DetailPicker | null = null;
  private onVisibility = () => this.picker?.pause();

  setDetail(d: Detail) {
    this.detail = d;
    this.resize(...this.size);
  }

  /** From now on the frame times pick the detail. After loadPlants: its work slows frames whatever the detail. */
  autoDetail() {
    this.picker = new DetailPicker(
      (d) => this.setDetail(d),
      (ms) => this.cb.onTooSlow(ms, this.detail),
    );
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  resize(cssW: number, cssH: number) {
    this.size = [cssW, cssH];
    // The framebuffer's width comes from the detail level; CSS scales it to the screen. A whole
    // number of device pixels per framebuffer pixel keeps the scaling even.
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.round((cssW * dpr) / DETAIL[this.detail]));
    const w = Math.round((cssW * dpr) / scale);
    const h = Math.round((cssH * dpr) / scale);
    // Setting the canvas size waits on the GPU process: up to 15 ms at CPU 10× (#571). The first
    // ResizeObserver callback repeats the size the walk opened with.
    const now = this.renderer.getSize(new THREE.Vector2());
    if (now.x !== w || now.y !== h) this.renderer.setSize(w, h, false);
    this.camera.aspect = cssW / cssH;
    this.camera.updateProjectionMatrix();
    // Framebuffer pixels per metre at 1 m, for the z's and the bits' point size.
    const pxPerMetre = h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.critters.resize(pxPerMetre);
    this.walkInto.resize(pxPerMetre);
    this.sky.resize(h);
  }

  /**
   * The plant hears its name (#60): it perks up for a moment. On about one
   * listen in 30 its nearest neighbour perks up too, a little late, as if it
   * thought you called it. Nothing moves with reduced motion.
   */
  nod(p: PlacedPlant) {
    this.plants.nod(p, this.game.elapsed, this.reducedMotion);
  }

  /** Is the hedge between the eye and this point? */
  private behindHedge(x: number, y: number, z: number): boolean {
    const c = this.camera.position;
    const d = Math.hypot(x - c.x, y - c.y, z - c.z);
    return this.hedgeAt({ ox: c.x, oy: c.y, oz: c.z, dx: (x - c.x) / d, dy: (y - c.y) / d, dz: (z - c.z) / d }) < d;
  }

  /**
   * The words a tap or a shake may soon say (#754), for loading their clips ahead: the words of the
   * plants and orchard trees within `metres` of the walker, nearest first; then today's visitors and
   * the garden's scenery words, which are few; then the near plants' other forms, said when shaken.
   */
  wordsNear(metres: number): string[] {
    const near = [...this.layout.plants, ...this.game.trunks]
      .map((t) => ({ t, d: Math.hypot(t.x - this.game.me.x, t.z - this.game.me.z) }))
      .filter((n) => n.d < metres)
      .sort((a, b) => a.d - b.d)
      .map((n) => n.t);
    const named = [...this.visitors.list.map((v) => v.word), ...Object.values(this.visitors.scenery ?? {}).map((v) => v.word)].filter((w) => w !== null);
    const forms = near.flatMap((t) => ("forms" in t ? petalForms(t.lemma, t.forms) : []));
    return [...near.map((t) => t.lemma), ...named, ...forms];
  }

  private pickPlant(at: TapAt): TapHit<"plant"> | null {
    const p = this.plants.pick(at.x, at.y, at.w, at.h);
    return p && { kind: "plant", p };
  }

  /** Every kind of thing a tap can meet (#850), asked in TAP_PRIORITY order. */
  private tappers: { [K in TapHit["kind"]]: Tapper<K> } = {
    visitor: { pick: (at) => this.pickVisitor(at), tap: (h, frog) => this.tapVisitor(h.v.id, frog) },
    plant: { pick: (at) => this.pickPlant(at), tap: (h) => this.game.tapPlant(h.p) },
    tree: { pick: (at) => this.pickTree(at), tap: (h) => this.game.tapTree(h.t) },
    door: { pick: (at) => this.pickDoor(at), tap: (h) => this.game.tapDoor(h.a) },
    joke: { pick: (at) => this.pickJoke(at), tap: (h) => this.game.showLine(h.j.line, h.j.at, h.j.spoken) },
    // How wide the view is at one metre away: the game reads a note close enough to fill it.
    note: { pick: (at) => this.pickNote(at), tap: (h) => this.game.tapNote(h.id, this.camera.aspect * Math.tan((this.camera.fov * Math.PI) / 360)) },
    lantern: { pick: (at) => this.pickLantern(at), tap: (h) => this.game.tapLantern(h.i) },
    carry: { pick: (at) => this.pickCarry(at), tap: (h) => this.game.tapCarry(h.t) },
    toy: { pick: (at) => this.pickToy(at), tap: (h) => this.game.tapToy(h.i) },
    walk: { pick: (at) => this.pickGround(at), tap: (h) => this.game.walkTo(h.x, h.z) },
    scenery: { pick: (at) => this.pickScenery(at), tap: (h) => this.game.tapScenery(h.s) },
  };

  /** What one tap (CSS pixels) meets: the first kind of thing in TAP_PRIORITY that meets something (#323, #850). */
  pickAny(cssX: number, cssY: number, cssW: number, cssH: number): TapHit | null {
    const at: TapAt = { x: cssX, y: cssY, w: cssW, h: cssH, r: this.ray(cssX, cssY, cssW, cssH) };
    for (const kind of TAP_PRIORITY) {
      const hit = this.tappers[kind].pick(at);
      if (hit) return hit;
    }
    return null;
  }

  /** Act on what a tap met (pickAny). A visitor may answer (`frog`: what the frog may say): this returns what it said. */
  tap<K extends TapHit["kind"]>(hit: TapHit<K>, frog: FrogWords): Reply | null | void {
    return this.tappers[hit.kind].tap(hit, frog);
  }

  start() {
    this.game.start();
    const loop = () => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(loop);
      const now = performance.now();
      this.picker?.frame(now - this.last);
      const dt = Math.min(MAX_FRAME, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
    };
    // The first frame in a task of its own: it sets up every shader for drawing, and loadPlants follows in this one (#459).
    this.frame = requestAnimationFrame(loop);
  }

  /** One frame: the game steps with the input held now, then everything is drawn where the game says. */
  private tick(dt: number) {
    const g = this.game;
    const me = g.me;
    const motion = this.reducedMotion ? 0 : 1;

    // Where the walker was, and whether they went on foot, for how fast they walk into things (#359).
    const x0 = me.x;
    const z0 = me.z;
    const onFoot = me.mode.kind === "trip" || Math.hypot(this.input.move.x, this.input.move.y) > 0.01;
    g.step(dt, this.input);
    const t = g.elapsed;
    // Sitting down or standing up, the eye sinks or rises (walker.ts step).
    const seat = me.seat;
    this.camera.position.set(me.x, EYE - (EYE - W.SEAT.eye) * seat + g.lift(me.x, me.z) + Math.sin(me.bob) * 0.035 * motion, me.z);
    // On the stool the view narrows as you sit, and widens again as you get up (#858).
    const fov = g.sitOn === "stool" ? FOV - (FOV - STOOL_FOV) * seat : FOV;
    if (fov !== this.camera.fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.rotation.set(me.pitch, me.yaw, 0);
    this.camera.updateMatrixWorld();

    for (const mat of this.mats) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uSway.value = motion;
    }
    // One frame, ticked into every part in the fixed order `parts` documents:
    // sky (clouds, water, the sun), the door (its swing and the key's glint),
    // critters (fireflies, butterflies, the sleeping bloom's z's), plants
    // (chunk culling — beds outside the fog are skipped — streaming the
    // plants nearest you, the perk and sneeze uniforms, brushing), the
    // visitors, the jokes, walking into trees and leaf piles (#359), the loose
    // things (the pond's rings), then the toys (#360: the
    // dandelion seeds).
    const frame = this.tickFrame;
    frame.dt = dt;
    frame.elapsed = t;
    frame.x = me.x;
    frame.z = me.z;
    frame.yaw = me.yaw;
    // dt is 0 only on the very first frame, before anyone could walk.
    frame.speed = onFoot && dt > 0 ? Math.hypot(me.x - x0, me.z - z0) / dt : 0;
    for (const part of this.parts) part.tick?.(frame);
    if (g.selected) {
      const p = g.selected;
      this.marker.position.set(p.x, BED_H + plantHeight(p.growth) + 0.32 + Math.sin(t * 3) * 0.05 * motion, p.z);
      this.marker.quaternion.copy(this.camera.quaternion);
    }

    // The sunflower shows its face only to someone standing in its sun (and never at night).
    const fl = this.flower;
    const face = sunflowerFaces(fl.x, fl.z, me.x, me.z, this.sky.sunDir.x, this.sky.sunDir.z, g.shown === "night");
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
    const g = this.game;
    const v = this.tmp;
    const out: Label[] = this.plants.labelsNear(g.me.x, g.me.z, v);
    out.push(...this.plants.petals(g.elapsed, v));
    const tags: Partial<Record<(typeof LABEL_PRIORITY)[number], Label>> = {};

    // A tapped scenery word (#74) is the one tag while it shows: no visitor tag beside it.
    const st = g.sceneryTap;
    if (st) {
      const h = st.hit;
      if (h.follow === "sun") v.copy(this.camera.position).addScaledVector(this.sky.sunDir, SUN_DIST).y += SUN_DIST * SUN_TAG;
      else if (h.follow) {
        const cloud = this.sky.cloudPosition(h.follow.cloud);
        v.set(cloud.x, h.y, cloud.z);
      }
      else v.set(h.x, h.y, h.z);
      v.project(this.camera);
      const { thought } = st.view;
      // A thought's tag fades out at the end; it is wider than a word's, so it is kept on the screen.
      if (v.z <= 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1)
        tags.scenery = thought
          ? { id: `scenery:${st.view.id}`, text: st.view.word, gloss: st.view.gloss, known: st.view.known, kind: "scenery", thought, x: onScreen((v.x + 1) / 2, THOUGHT_EDGE), y: Math.max(THOUGHT_TOP, onScreen((1 - v.y) / 2)), near: Math.min(1, (st.until - g.elapsed) / SCENERY_TAG.fade) }
          : { id: `scenery:${st.view.id}`, text: st.view.word, gloss: st.view.gloss, known: st.view.known, kind: "scenery", x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: 1 };
    }
    // The door's quiet line (#315), while it shows.
    const ln = g.line;
    if (ln && !ln.at) tags.line = { id: "line", text: ln.text, gloss: ln.spoken, kind: "far", x: 0.5, y: LOW_LINE, near: 1 };
    else if (ln?.at) {
      v.set(...ln.at).project(this.camera);
      // Kept on the screen: standing right at the door, its top is above the view, and the line must still be read.
      if (v.z <= 1) tags.line = { id: "line", text: ln.text, gloss: ln.spoken, kind: "line", x: onScreen((v.x + 1) / 2), y: onScreen((1 - v.y) / 2), near: 1 };
    }
    // A tapped orchard tree's word (#315), over its crown; kept on the screen, as a tall tree's top is often above the view.
    const tt = g.treeTap;
    if (tt) {
      v.set(tt.tree.x, tt.tree.height + 0.08, tt.tree.z).project(this.camera);
      if (v.z <= 1) tags.tree = { id: `tree:${tt.tree.id}`, text: tt.tree.lemma, gloss: tt.tree.gloss, kind: "tree", x: onScreen((v.x + 1) / 2), y: onScreen((1 - v.y) / 2), near: 1 };
    }
    // A fallen fruit's word (#359), over the fruit as it rolls; kept on the screen. Its meaning is the fruit's kind, the plain English name.
    const fr = g.fruitTap;
    if (fr) {
      v.set(fr.at.x, fr.at.y + 0.25, fr.at.z).project(this.camera);
      if (v.z <= 1) tags.fruit = { id: "fruit", text: fr.tree.lemma, gloss: fr.tree.kind, kind: "fruit", x: onScreen((v.x + 1) / 2), y: onScreen((1 - v.y) / 2), near: 1 };
    }
    // The well's echo (#335 S6), a moment after the plop, over its roof; kept on the screen.
    const ec = g.echoTap;
    if (ec && g.elapsed >= ec.from) {
      const w = this.layout.well;
      v.set(w.x, 1.4, w.z).project(this.camera);
      if (v.z <= 1) tags.echo = { id: `echo:${ec.n}`, text: ec.word, gloss: ec.date, kind: "echo", x: onScreen((v.x + 1) / 2), y: onScreen((1 - v.y) / 2), near: 1 };
    }
    // A visitor's approach tag shows only while none of line/fruit/scenery/tree is active (clearTaps keeps at most one of those set at a time).
    const exclusiveActive = !!(g.sceneryTap || g.treeTap || g.line || g.fruitTap);
    const { say, tag } = this.guests.labels(g.me.x, g.me.z, !exclusiveActive);
    if (say) tags.say = say;
    if (tag) tags.tag = tag;
    // One table for what shows over what: say (a visitor's bubble) always; then whichever of line/scenery/tree is active; last, a visitor's tag.
    for (const kind of LABEL_PRIORITY) {
      const l = tags[kind];
      if (l) out.push(l);
    }
    const heard = this.guests.status();
    if (heard !== this.lastHeard) {
      this.lastHeard = heard;
      this.cb.onVisitorStatus(heard);
    }
    const key = out.map((l) => `${l.id}${l.text}${l.x.toFixed(3)}${l.y.toFixed(3)}${l.near.toFixed(2)}`).join();
    if (key !== this.lastLabels) {
      this.lastLabels = key;
      this.cb.onLabels(out);
    }
  }

  /** For dev tools only, through the window.__garden handle (e2e/look.run.ts, #974): the game now, and what is in view, as plain data. It changes nothing. */
  stateNow(): SceneState {
    return { ...this.game.state(), things: thingsInView(this.camera, this.hitBoxes, this.hitDiscs, this.game.stileSpot) };
  }

  dispose() {
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const part of this.parts) part.dispose?.();
    cancelAnimationFrame(this.frame);
    this.renderer.dispose();
    // Losing the context frees every geometry, material and texture on the GPU at once. Disposing each of them was
    // ~45-70 ms in one task at CPU 10× as the walk closed (#459); the canvas goes with the walk, so nothing draws on it again.
    this.renderer.forceContextLoss();
  }
}

/** An object's materials: none, one, or one per face group. */
function materialsOf(o: THREE.Object3D): THREE.Material[] {
  const m = (o as THREE.Mesh).material;
  return Array.isArray(m) ? m : m ? [m] : [];
}

/**
 * The objects under `root` that bring a material not yet in `seen`, and adds their
 * materials to it. A material's shader also depends on the kind of object (an
 * instanced mesh, a sprite), so the key has both. With a frustum: only the shown
 * objects the camera sees, as a draw would.
 */
function firstOfEach(root: THREE.Object3D, seen: Set<string>, frustum?: THREE.Frustum): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const visit = (o: THREE.Object3D) => {
    const mats = materialsOf(o);
    if (!mats.length) return;
    const keys = mats.map((m) => `${o.type} ${m.uuid}`);
    if (keys.every((k) => seen.has(k))) return;
    if (frustum && o.frustumCulled && !(o instanceof THREE.Sprite ? frustum.intersectsSprite(o) : frustum.intersectsObject(o))) return;
    for (const k of keys) seen.add(k);
    out.push(o);
  };
  if (frustum) root.traverseVisible(visit);
  else root.traverse(visit);
  return out;
}

/** The camera layer drawOnce draws one object on; nothing else in the garden uses layers. */
const WARM_LAYER = 31;

/** The textures a material draws with: its maps, and for a sprite shader its uniforms. */
function texturesOf(mat: THREE.Material): THREE.Texture[] {
  const all = Object.values(mat).filter((v) => v instanceof THREE.Texture);
  if (mat instanceof THREE.ShaderMaterial) for (const u of Object.values(mat.uniforms)) if (u.value instanceof THREE.Texture) all.push(u.value);
  return all;
}

/** How long one slice of the scene's build may run before it yields: under the 10 ms task budget, with room for the browser's own work. */
const SLICE_MS = 8;
