// The walkable word garden, rendered the 90s way: a tiny framebuffer scaled
// up with hard pixels, unlit textures, fog, and flat sprite plants that turn
// to face you. Loaded only when the garden is opened.

import * as THREE from "three";
import { rng } from "../lib/seed";
import { yieldToBrowser } from "../lib/yield";
import { along, BED_H, BENCH, benchAt, besideKey, collide, DOOR_HALF, DOOR_LINES, DOOR_SPOKEN, HEDGE, hedgeSpan, keyAt, route, sunflowerAt, viewpoint, walk, WALKER, walkStep, type BackWay, type KeyHelp, type KeySpot, type Layout, type PlacedPlant, type Trip } from "./world";
import { REACH_SLACK } from "./reach";
import { standAt, wayNear, type Ground } from "./ground";
import { benchLine, pickTree, placeTrees, treeVisitorSpots, type OrchardTree, type PlacedTree } from "./orchard";
import { buildOrchard, type Orchard } from "./orchardScene";
import { gateHedge, orchardHedge } from "./hedge";
import * as T from "./textures";
import { plantHeight as plantHeightOf } from "../ui/plant";
import { fishSign, keepsakeLabel, pickSigns, SIGNS, sunflowerFaces, type SignLine } from "./whimsy";
import { GATE_HALF, SNAIL_SIGN, visitor, type VisitorId, type VisitorView } from "./visitors";
import { SceneVisitors, type Hider } from "./sceneVisitors";
import { RAIL, type Ledge, type Spots } from "./spots";
import { conditions } from "./conditions";
import { DETAIL, DetailPicker, type Detail } from "./detail";
import { boardBox, DECOR_KINDS, groundAt, pickScenery, rayBox, rayDisc, spriteBox, SUN_TAG, thingAt, TREE_KINDS, type HitBox, type HitDisc, type Ray, type SceneryHit, type SceneryView, type SceneryViews, type SceneryWorld } from "./scenery";
import { HILLS, SKY_R, SkyWater } from "./sceneSky";
import { Hedge } from "./sceneHedge";
import { Door, DOOR, DOOR_REACH, KEY_REACH } from "./sceneDoor";
import { Critters } from "./sceneCritters";
import { NAME_NEAR, Plants } from "./scenePlants";
import { LANTERN_REACH, Lanterns } from "./sceneLanterns";
import { ANSWER_LINE, ANSWER_NOTE, ANSWER_SPOKEN, backWay, DIARY_REACH, hasNote, HILL_NOTE, HILLTOP_R, hillY, lookoutAt, LookoutLight, STOOL_R, type Lookout } from "./lookout";
import { LookoutThings } from "./sceneLookout";
import { stepY, stileAt, type StileSpot } from "./stile";
import { StileScene } from "./sceneStile";
import { courseNotes } from "./notes/read";
import { FULL_MOON } from "./moon";
import { TAP_PRIORITY, type Frame, type Part, type Reachable, type TapAt, type TapHit, type Tapper } from "./scenePart";
import { buildShed, shedRoof, shedStep } from "./shed";
import { Carry, CARRY_STAND, type CarryAct, type CarryDone, type CarryTarget, type Landing } from "./sceneCarry";
import { aimAt, ANSWERS, type Answer, type Answerers } from "./carry";
import { echo, echoDate, type Met } from "./well";
import { TOY_STAND, Toys, type ToyAct, type ToyDone, type ToyTarget } from "./sceneToys";
import type { ToysWalk } from "./toys";
import { bareNoun } from "./nouns";
import { petalForms, plantInReach } from "./shake";
import type { Gender } from "../deck/schema";
import type { DeckLang } from "../deck/langs";
import { Jokes, type Joke } from "./sceneJokes";
import { ShedNotes } from "./sceneNotes";
import { WalkInto } from "./sceneWalkInto";
import { leafPiles, type Fell, type Rolling } from "./walkInto";
import { FOG_FAR, FOG_NEAR, PLANT_SCALE, plantHeight, signBoard, sprites, SPRITE_H, still, type BuildCtx, type SpriteItem } from "./sceneSprites";
import { backRate, COMPANY_SPOT, due, glance, GLANCE, GNOME_WORD, lapseLook, lapseRate, settle, untilNight, type Companion, type Look } from "./bench";
import { RESERVED } from "../content/voice";
import { dayNumber } from "../core/day";
import type { Hideout, Reply } from "./kinds/kind";

export type TimeOfDay = "day" | "dusk" | "night";

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

/**
 * The door in the hedge (#315): locked; locked with the key hidden somewhere in
 * the garden (its garden word brought it), with the help the world gives once it
 * has waited a while (#334); or open for good.
 */
export type DoorState = "locked" | { key: KeySpot; help: KeyHelp } | "open";
/** What the learner can do at the door: try it while it is locked, pick up the key, or open the door with the key. */
export type DoorAction = "try" | "key" | "open";
/** Walk into things (#359): a plant brushed past plays its word's note (a bloom's clear, a younger plant's soft); a tree walked into let something fall; a leaf pile burst. */
export type WalkIntoEvent = { did: "brush"; word: string; clear: boolean } | { did: "bump"; fell: Fell; word: string } | { did: "pile" };
/** What the one action button does to the thing in reach (#334): the door's actions, sit on the bench and stand up again, shake a plant (#357), carry's (#358), the toys' (#360), blow a lantern out and light it again (#361), or find the gnome where it hides (#379), or read a note in the shed (#654), or sit on the lookout's stool and read the diary there (#858). */
export type Reach = DoorAction | "sit" | "stand" | "shake" | CarryAct | ToyAct | "snuff" | "light" | "seek" | "read" | "stool" | "diary";

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

/** Who visits the walk today. */
export interface WalkVisitors {
  list: VisitorView[];
  /** The first word's plant, its lemma and when it was planted, for its stake: "casa · 3 oct" (#61). */
  keepsake?: { id: string; lemma: string; at: number } | null;
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
  /** Autumn as the walk opens (core/day.ts isAutumn): leaf piles on the paths (#359). */
  autumn: boolean;
  /** The lawn toys (#360): today's calendar day. */
  toys: ToysWalk;
  /** Tonight's moon (#361, moon.ts moonPhase), as the walk opens. */
  moon: number;
  /** Every word in the garden and when it was first met, for the well's echo (#335 S6). */
  met: Met[];
  /** The learner's first review ever (ms), for the garden's age (#379); null for a new learner. */
  firstReview: number | null;
  /** The gardener's notes on the shed's nails (#654): the unlocked ones, in the order they came, and whether each is still unread. */
  notes: readonly { id: string; unread: boolean }[];
  /** The stile in the back fence (#714): null until the first stile note is unlocked; then the notes under its step (stile.ts placeNotes). */
  stile: readonly string[] | null;
  /** The diary on the hill (#858): null until its first page is unlocked; then its pages, in the order they came, and whether each is still unread. */
  diary: readonly { id: string; unread: boolean }[] | null;
}

export interface SceneCallbacks {
  onSelect: (p: PlacedPlant | null) => void;
  onLabels: (labels: Label[]) => void;
  onProgress: (done: number, total: number) => void;
  /** What the action button does now, for the thing in reach (#334); null with nothing in reach (no button, #835). */
  onReach: (a: Reach | null) => void;
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

export interface Input {
  /** -1..1 each: forward and right, from keys or the touch stick. */
  move: { x: number; y: number };
  run: boolean;
}

const EYE = 1.05;
const WALK = 3.6;
/**
 * The longest frame the garden runs in full (s). Down to 10 frames a second
 * the garden runs in real time: a walk is as fast and a visitor's wait as long
 * (#790; at 0.05, CI's software WebGL ran it at a third of its speed). Below
 * that it runs slower, so a walk still moves in steps short enough to see the
 * stile's top board, and a gap (a hidden tab, a stalled load) is not one jump.
 */
const MAX_FRAME = 0.1;
/** On the stile's steps (#770), a walk goes this much of its pace: you climb. */
const STEPS_PACE = 0.6;
/** A tap past the back fence counts this near (m) to where a walker may stand (#770): at a bramble's foot, say. */
const TAP_SLACK = 0.5;
/** How far a ray goes between looks for the ground, on the hill (m). */
const GROUND_STEP = 0.1;
/** Ground nearer than this (m) is in reach (#336): a tap on it names the path, as before; farther ground is walked to. */
const GROUND_REACH = 1.5;
/** Where a walk to the door stops: on the path in front of it, in reach of it (sceneDoor.ts DOOR_REACH). */
const DOOR_STAND = 1.4;
/** A walk to the key stops this short of it (m), so it is still in view, in reach (KEY_REACH). */
const KEY_STAND = 1;
/** The well's echo (#335 S6) comes this long (s) after the plop, and shows for this long. */
const ECHO = { delay: 1.2, show: 5 };
/** A plant this near (m) where a thing lands perks up (#358). */
const PERK_NEAR = 0.9;
/** Near enough to the bench (m, from its middle) to sit on it (#334). */
const BENCH_REACH = 1.6;
/** How much farther (m) a thing counts as in reach: REACH_SLACK for what the action button shows now (`shown`), none for anything else. */
function slack(shown: boolean): number {
  return shown ? REACH_SLACK : 0;
}
/** Infers each action-button thing's target type (#850). */
function reachable<T>(r: Reachable<T>): Reachable<T> {
  return r;
}
/** Sitting on the bench (#334): the eye's height, where you sit along the seat (near its left end: the rest is for company, #362), and how fast you sit down (per second). */
const SEAT = { eye: 0.78, dx: -0.5, speed: 2.5 };
/** The view's height (degrees), and on the lookout's stool (#858) a little narrower: the far house and its lantern nearer the middle. */
const FOV = 62;
const STOOL_FOV = 50;
/** A line over no point in the garden (the far light's answer, #858): how far down the view, above the action button. */
const LOW_LINE = 0.72;
/** No tree outside the back fence within this far (m) either side of the stile (#714): the old path is seen from its top board. */
const STILE_VIEW = 2.5;
/** How fast the view turns toward where a walk goes: the share of the turn left that it makes per second. */
const TRIP_TURN = 3;
/** How far away the sun (or moon) is drawn, along its direction from the eye. */
const SUN_DIST = 200;

/** The bench by the pond (#334) or the lookout's stool (#858). */
type Seat = "bench" | "stool";

/**
 * What the walker is doing (#877), one at a time:
 * - free: standing, or walking with the keys;
 * - trip: a walk to a tapped spot (#336, world.ts Trip and walkStep). It turns the view gently toward where
 *   it goes while `turn` (never with reduced motion, and no more once the viewer looks round themselves).
 *   On arrival it does `then` (a plant's card, the door);
 * - glide: to a plant along `path` (world.ts route), turning from one yaw and pitch to the other, `t` 0 to 1 over `s` seconds;
 * - seated: on the bench or the stool. Any move stands you up.
 */
type Walker =
  | { kind: "free" }
  | ({ kind: "trip"; then: (() => void) | null; turn: boolean } & Trip)
  | { kind: "glide"; path: [number, number][]; yaw: [number, number]; pitch: [number, number]; t: number; s: number }
  | { kind: "seated"; on: Seat };

/** One for all: the frame loop goes back to free without making a new object. */
const FREE: Walker = { kind: "free" };

/** Each time of day's tint for everything unlit, and its fog, made once: the time-lapse on the bench (#362) blends them every frame. */
const LIGHT: Record<TimeOfDay, { tint: THREE.Color; fog: THREE.Color }> = {
  day: { tint: new THREE.Color(...T.SKIES.day.tint), fog: new THREE.Color(T.SKIES.day.fog) },
  dusk: { tint: new THREE.Color(...T.SKIES.dusk.tint), fog: new THREE.Color(T.SKIES.dusk.fog) },
  night: { tint: new THREE.Color(...T.SKIES.night.tint), fog: new THREE.Color(T.SKIES.night.fog) },
};

/** A label's place kept on the screen (a fraction of it), for lines that must be read even when their point is out of view. `edge`: how far in from each side its middle stays. */
const onScreen = (k: number, edge = 0.12) => Math.max(edge, Math.min(1 - edge, k));

/**
 * A tapped scenery word's tag (#74), in seconds: a word alone shows for `word`; one with a thought (#864) for `thought`,
 * long enough to read it slowly, and fades out over its last `fade`.
 */
const SCENERY_TAG = { word: 4, thought: 10, fade: 0.6 };
/** How far in from each side a thought's tag stays: half of its widest (index.css .gw-thought, 15rem), on a phone 412 px wide. */
const THOUGHT_EDGE = 0.3;
/** The highest a thought's point goes: its tag is drawn above the point, and two or three lines tall it would go under the top pill. */
const THOUGHT_TOP = 0.24;

/**
 * The order GardenScene.labels pushes a tag in, when more than one shows at
 * once: a visitor's "say" bubble (the frog's croak) first; the well's echo; then whichever of
 * line/fruit/scenery/tree is active (GardenScene.clearTaps keeps at most one of
 * those three set); a visitor's approach tag last. One table, like
 * TAP_PRIORITY.
 */
const LABEL_PRIORITY = ["say", "echo", "line", "fruit", "scenery", "tree", "tag"] as const;

/** A wooden bench: a seat facing +z, a back rest behind it, four legs. The one by the pond, and the orchard's (#315). */
function benchModel(c: Pick<BuildCtx, "mat" | "woodTex">): THREE.Group {
  const bench = new THREE.Group();
  const plank = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), c.mat(c.woodTex));
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
  private elapsed = 0;
  private frame = 0;
  /** The walk is drawn: from now on a visitor sent somewhere goes there in its own way (#802). */
  private started = false;
  private disposed = false;
  private yaw = 0;
  private pitch = -0.2;
  private x = 0;
  private z = 0;
  private bob = 0;
  /** What the walker is doing (#877): one state, changed only by `toWalker`. */
  private walker: Walker = FREE;
  /** Where a walk's frame moves the walker (walkStep fills it in place); and whether a stalled walk was reported this time in the garden. */
  private at = { x: 0, z: 0 };
  private stallReported = false;
  /** The ring on the ground where a walk goes. */
  private spot!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** What the action button does now (#334), and to which thing in `reachables` (#850). */
  private reach: Reach | null = null;
  private reacher: Reachable<unknown> | null = null;
  /** Carry (#358): the pebbles; and how often each one has answered a landing this visit. */
  private carry: Carry;
  private answered: Record<Answer, number> = { frog: 0, plant: 0, well: 0 };
  /** The well's echo (#335 S6): an old word and the day it was met, over the well, from `from` until `until` (elapsed s). */
  private echoTap: { n: number; word: string; date: string; from: number; until: number } | null = null;
  /** When the walk opened (ms): the well's echo reaches back from then. */
  private openedAt = 0;
  /** A fallen fruit's tag (#359): the word of the tree it fell from, over the fruit as it rolls, for a few seconds. */
  private fruitTap: { tree: PlacedTree; at: Readonly<Rolling>; until: number } | null = null;
  /** Walking into things (#359): bumping orchard trees and bursting leaf piles. */
  private walkInto: WalkInto;
  /** The lawn toys (#360): the dandelion clocks. */
  private toys: Toys;
  /** The gardener's notes in the shed (#654). */
  private notes = new ShedNotes();
  /** The eye's seat (#334, #858), sat on now or last: `seat` goes from 0 (standing) to 1 (sitting) for the eye's height, and the view narrows on the stool. */
  private seat = 0;
  private sitOn: Seat = "bench";
  /** The way out of the back fence (#714, #749): the thicket, and the stile once the hill's note is unlocked. */
  private stile: StileScene | null = null;
  /**
   * The stile, the hill past it and the lookout on its top (#722), all null
   * until the stile is there; and the ground past the back fence the walker
   * may stand on (#770): none past the brambles until the note that tells of
   * the hill is unlocked, then over the stile and up the old path.
   */
  private readonly stileSpot: StileSpot | null;
  private readonly hill: Lookout | null;
  /** The stool and the diary on the hill's top (#858), null with the hill. */
  private readonly lookoutThings: LookoutThings | null;
  private readonly hillOpen: boolean;
  private readonly back: BackWay | null;
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
  /** Who is on the way to the bench, not there yet (#802). */
  private onWay = new Set<Companion>();
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
  /** The sunflower: where it stands, its sprite's frame and lean, and which side it shows (null: not drawn yet). */
  private flower!: { x: number; z: number; uv: THREE.InstancedBufferAttribute; params: THREE.InstancedBufferAttribute; face: boolean | null };
  private selected: PlacedPlant | null = null;
  /** The time of day chosen (the clock, or the button), and the one on show: they differ while time speeds up on the bench (#362). */
  private time: TimeOfDay = "day";
  private shown: TimeOfDay = "day";
  /** Time is sped up on the bench now, or running back to the time chosen (#362). */
  private lapsing = false;
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
  /** The tapped scenery word and where its tag sits (it follows the sun or a cloud). */
  private sceneryTap: { view: SceneryView; hit: SceneryHit; until: number } | null = null;
  /** The lanterns where paths cross (#361): lit at dusk and night, each one blown out or lit again by hand. */
  private lanterns: Lanterns;
  /** The signals with the lookout's lantern and the far light's answers (#858). */
  readonly lookout: LookoutLight;
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
  /** The orchard tree tapped last and until when its tag shows. */
  private treeTap: { tree: PlacedTree; until: number } | null = null;
  /** What the world is built with, kept for the orchard, which is built when the door opens. */
  private ctx!: BuildCtx;
  /** The orchard's tree atlas, painted in a worker during the build (#571), for when the door opens. */
  private orchardAtlas!: THREE.Texture;

  /** The help the world gives for a key left waiting (#334), while it still lies in the garden. */
  private get keyHelp(): KeyHelp | null {
    return this.door.state === "key" ? this.door.help : null;
  }

  /** The orchard's trees, for walking round their trunks: none while the door is shut. */
  private get trunks(): readonly PlacedTree[] {
    return this.orchard?.trees ?? [];
  }

  /** The ground as it is now (#761), for your ways on foot, over the stile too (#770). */
  private get ground(): Ground {
    return { layout: this.layout, doorOpen: () => this.door.state === "open", trees: () => this.trunks, back: this.back };
  }
  /**
   * A quiet line from the garden (the door's, or a joke's), over a point, until a time. A joke's line is in the
   * course language, and `spoken` is its English for screen readers (#650). The far light's answer (#858) is
   * over no point (null): it is low in the view, read wherever you look.
   */
  private line: { text: string; spoken?: string; at: [number, number, number] | null; until: number } | null = null;
  readonly input: Input = { move: { x: 0, y: 0 }, run: false };

  private layout: Layout;
  private cb: SceneCallbacks;
  private reducedMotion: boolean;

  /** The course language: the signs and everything else written in the world are in it (#650). */
  private lang: DeckLang;
  private visitors: WalkVisitors;
  /** Today's visitors in the walk (sceneVisitors.ts). */
  private guests: SceneVisitors;

  constructor(canvas: HTMLCanvasElement, layout: Layout, cb: SceneCallbacks, reducedMotion: boolean, lang: DeckLang, visitors: WalkVisitors) {
    this.layout = layout;
    this.cb = cb;
    this.reducedMotion = reducedMotion;
    this.lang = lang;
    this.visitors = visitors;
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    // Reading the shader logs on a program's first use waits for the GPU: ~10 ms of a first draw at CPU 10× (#571).
    // Dev and the e2e tests still read them, so a broken shader fails there.
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.x = layout.gate.x;
    // Start inside the gate, close enough that the first bed fills the view.
    const first = layout.beds[0];
    this.z = Math.min(layout.gate.z - 1.2, first.z + first.d / 2 + 3.2);
    this.camera.rotation.order = "YXZ";
    // The way over the stile opens once the note that tells of the hill is unlocked (#770), and the far light answers once the note that tells of that is.
    // Null: no diary page is unlocked yet.
    const notes = [...visitors.notes, ...(visitors.diary ?? [])].map((n) => n.id);
    this.hillOpen = hasNote(courseNotes(lang), notes, HILL_NOTE);
    this.stileSpot = visitors.stile ? stileAt(layout) : null;
    this.hill = this.stileSpot ? lookoutAt(this.stileSpot) : null;
    this.lookoutThings = this.hill ? new LookoutThings(this.hill) : null;
    this.back = this.stileSpot && this.hill ? backWay(this.stileSpot, this.hill, this.hillOpen) : null;
    this.lookout = new LookoutLight(hasNote(courseNotes(lang), notes, ANSWER_NOTE));
    this.lanterns = new Lanterns();
    this.sky = new SkyWater(this.camera, reducedMotion, this.lookout);
    this.critters = new Critters(this.camera, reducedMotion);
    this.plants = new Plants(
      this.renderer,
      this.camera,
      layout,
      (d, total) => this.cb.onProgress(d, total),
      (x, y, z) => this.behindHedge(x, y, z),
      (p) => this.cb.onWalkInto({ did: "brush", word: p.lemma, clear: p.stage === "bloom" }),
      visitors.moon === FULL_MOON,
    );
    this.door = new Door(reducedMotion);
    this.jokes = new Jokes(this.camera, reducedMotion);
    this.walkInto = new WalkInto(
      reducedMotion,
      (tree, fell, fruit) => {
        if (fruit) {
          this.fruitTap = { tree, at: fruit, until: this.elapsed + 4 };
          this.clearTaps({ scenery: true, tree: true, line: true, visitor: true });
        }
        this.cb.onWalkInto({ did: "bump", fell, word: tree.lemma });
      },
      () => this.cb.onWalkInto({ did: "pile" }),
    );
    this.carry = new Carry(layout, reducedMotion, {
      doorOpen: () => this.door.state === "open",
      land: (l) => this.landed(l),
    });
    this.toys = new Toys(layout, visitors.toys, reducedMotion, {
      sneeze: (i) => this.plants.sneeze(i, this.elapsed),
    });
    this.guests = new SceneVisitors(
      {
        scene: this.scene,
        camera: this.camera,
        layout,
        // The visitors stay in the garden: they are drawn on flat ground, not on the stile or the hill (#770).
        ground: { ...this.ground, back: null },
        reducedMotion,
        lang,
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
    if (await this.stopped()) return;
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
    this.lanterns.build(c, this.hill);
    if (await this.stopped()) return;
    const bench = this.buildBench(c);
    if (await this.stopped()) return;
    const boards = this.buildSigns(c, bench);
    if (await this.stopped()) return;
    // The one clock read in the build: what is where today (DESIGN.md, Garden code).
    const now = new Date();
    this.openedAt = now.getTime();
    // The mat says the doormat's word as a mat would: the bare word, in capitals.
    const welcome = this.visitors.scenery?.doormat?.word;
    this.jokes.build(c, this.bench, now, welcome ? bareNoun(welcome).toUpperCase() : null);
    if (await this.stopped()) return;
    // The garden's age, in calendar days since the first review (#379).
    const first = this.visitors.firstReview;
    this.guests.build(this.spots(pads, boards, now), now, first === null ? 0 : dayNumber(now) - dayNumber(first));
    if (await this.stopped()) return;
    this.scene.add(buildShed(c, this.layout));
    this.notes.build(c, this.visitors.notes);
    const stile = this.visitors.stile;
    // The hill is there whenever the stile is (the constructor).
    if (stile && this.stileSpot && this.hill && this.lookoutThings) {
      // Draws no random numbers.
      this.stile = new StileScene(this.stileSpot, this.hill, this.hillOpen);
      this.stile.build(c, stile);
      this.lookoutThings.build(c, this.visitors.diary);
    }
    this.toys.build(c);
    if (await this.stopped()) return;
    // Draws no random numbers either.
    this.carry.build();
    this.scene.add(this.carry.root);
    // A key left waiting a few days (#334): the dog, if it is here today, sits by it from the start (#802). At dusk and night the bird too (birdByKey).
    const key = this.door.key;
    if (this.keyHelp?.visitors && key && this.guests.has("dog")) {
      this.guests.place("dog", besideKey(this.layout, key, "dog"), key);
      this.door.guarded = true;
    }
    // Even with the door shut: it may open in this walk.
    this.orchardAtlas = await orchardAtlas;
    // After the visitors: a visitor may sit in the orchard's trees today.
    if (this.visitors.door === "open") this.openDoor();
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
    this.setTime(this.time);
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
    const grassTex = T.pixelTexture(T.grass(), true);
    grassTex.repeat.set(200, 200);
    // At 0, where everything in the garden stands (#861). Drawn behind what lies on it in the same plane (the yard's path, the hill's grass at its foot) by depth alone, so they never flicker into it.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(grassTex, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(still(ground));
    const pathTex = T.pixelTexture(T.path(), true);
    pathTex.repeat.set(w / 1.1, d / 1.1);
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(pathTex));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(cx, 0, cz);
    this.scene.add(still(yard));
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
        atlas: this.orchardAtlas,
        bench: () => benchModel(this.ctx),
        mat: this.ctx.mat,
        plaque: firstPlanted === null ? null : benchLine(firstPlanted, this.lang),
      },
      o,
      trees,
    );
    this.orchard = orchard;
    this.walkInto.setOrchard(orchard.trees, orchard.params);
    for (const m of orchard.mats) this.mats.add(m);
    this.hitBoxes.push(...orchard.scenery);
    this.carry.showWell();
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
    const orchard = this.visitors.door === "open" ? placeTrees(L.orchard, this.visitors.orchard.trees) : [];
    const trees = treeVisitorSpots(orchard, brought, now);
    const piles = this.visitors.autumn ? leafPiles(L) : [];
    // On top of the hedge left of the door, just behind its front, on the leaves that stand above it; on the back fence's board, beside where a bird sits; on the bench's back, clear of the sitter and the bird.
    const [sx, sy, sz] = boards[0];
    const ledges: Ledge[] = [
      { on: "hedge", at: [L.gate.x - 2.2, HEDGE.height + 0.12, b.maxZ + HEDGE.gap + 0.25] },
      { on: "shed", at: shedRoof(L) },
      { on: "sign", at: [sx - 0.3, sy, sz] },
      { on: "bench", at: [this.bench.x + 0.15, BENCH_BACK, this.bench.z - 0.2] },
    ];
    return { bench: this.bench, shedStep: shedStep(L), pads, lanterns: this.lanterns.spots, perches, sign, trees, orchard, piles, ledges };
  }

  /** The ray from the eye through a point on the canvas (CSS pixels). */
  private ray(cssX: number, cssY: number, cssW: number, cssH: number): Ray {
    const c = this.camera;
    const d = this.tmp.set((cssX / cssW) * 2 - 1, -(cssY / cssH) * 2 + 1, 0.5).unproject(c).sub(c.position).normalize();
    return { ox: c.position.x, oy: c.position.y, oz: c.position.z, dx: d.x, dy: d.y, dz: d.z };
  }

  /** What a tap does at the door, if it meets the key or the shut door (CSS pixels). Ask after the plants and visitors, before the scenery. */
  private pickDoor({ r }: TapAt): TapHit<"door"> | null {
    const d = this.door;
    if (d.state === "open") return null;
    const L = this.layout;
    const z0 = L.bounds.maxZ + HEDGE.gap;
    const toDoor = rayBox(r, [L.gate.x - DOOR_HALF, 0, z0 - 0.05], [L.gate.x + DOOR_HALF, DOOR.h, z0 + DOOR.thick + 0.05]);
    // A small thing on the ground: a generous disc round it, so a finger finds it.
    // From farther than its reach too: a tap there walks to it first (tapDoor, #336). There, whatever
    // stands in front of it (a lantern, the sunflower) is what the tap meets; in reach the key comes first, as it did.
    const disc = d.key && d.state === "key" ? rayDisc(r, d.key.x, 0.03, d.key.z, 0.3) : Infinity;
    const toKey = disc < Infinity && !this.inReach("key", 0) && thingAt(r, this.sceneryWorld()) < disc ? Infinity : disc;
    if (Math.min(toDoor, toKey) > FOG_FAR) return null;
    if (toKey <= toDoor) return { kind: "door", a: "key" };
    return { kind: "door", a: d.state === "held" ? "open" : "try" };
  }

  /** Is the viewer near enough (and `slack` m more) to the key (for "key") or the door (the rest) to act on it? */
  private inReach(a: DoorAction, slack: number): boolean {
    const k = this.door.key;
    if (a === "key") return !!k && Math.hypot(this.x - k.x, this.z - k.z) < KEY_REACH + slack;
    return Math.hypot(this.x - this.layout.gate.x, this.z - this.layout.bounds.maxZ) < DOOR_REACH + slack;
  }

  /** The action button (#334): do what it shows to the thing in reach. Anything else no longer applies and does nothing. */
  act(a: Reach) {
    const t = this.reacher;
    if (t && a === this.reach) t.act(a, t.shown);
    // A press that comes before the button caught up with a change in reach: the bench and the door check their own state, so they act all the same.
    else if (a === "sit" && this.walker.kind !== "seated") this.sit("bench");
    else if (a === "stand") this.standUp();
    else if (a === "try" || a === "key" || a === "open") this.doorAct(a);
  }

  /** The lantern under a point on the canvas (CSS pixels), while they are lit (#361), with nothing in front of it. */
  private pickLantern({ r }: TapAt): TapHit<"lantern"> | null {
    const got = this.lanterns.pick(r);
    if (!got || got.t > FOG_FAR || this.hedgeAt(r) < got.t || thingAt(r, this.sceneryWorld()) < got.t) return null;
    return { kind: "lantern", i: got.i };
  }

  /** A tap on a lantern (#361): blow it out or light it in reach; from farther away, walk up to it first. */
  private tapLantern(i: number) {
    const [x, z] = this.lanterns.spot(i);
    if (Math.hypot(x - this.x, z - this.z) < LANTERN_REACH) return this.toggleLantern(i);
    this.goTo(x, z, LANTERN_REACH - 0.4, () => this.toggleLantern(i));
  }

  /** Blow lantern `i` out, or light it again; the moth, the stars and the fireflies answer. The lookout's, lit again, is a signal to the far light (#858). */
  private toggleLantern(i: number) {
    const relit = this.lanterns.toggle(i);
    if (i === this.lanterns.lookout) {
      if (relit) this.lookout.signal(this.elapsed);
      return;
    }
    // The moth knows the garden's lanterns only, the lookout's last.
    this.guests.lanternsLit(this.lanterns.on.slice(0, this.lanterns.spots.length));
    this.nightSky();
  }

  /** Every lantern out: the stars come out over the hills and the fireflies glow brighter (#361); otherwise they go back. */
  private nightSky() {
    const out = this.lanterns.allOut;
    this.sky.setStars(out);
    this.critters.setBright(out);
    this.cb.onStars(out);
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

  /**
   * A loose thing under a point on the canvas (CSS pixels), with your hands
   * free; holding one, the well (a pebble), the pond to throw it in, or the
   * ground in reach to put it down.
   */
  private pickCarry({ r }: TapAt): TapHit<"carry"> | null {
    const w = this.sceneryWorld();
    const wall = Math.min(thingAt(r, w), this.hedgeAt(r));
    if (this.carry.held === null) {
      const got = this.carry.pick(r);
      if (!got || got.t > FOG_FAR || this.hedgeAt(r) < got.t) return null;
      // From afar a tap walks there first: whatever stands in front of it is what the tap meets. In reach it comes first.
      return this.carry.standFor(got.target, this.x, this.z).near || wall >= got.t ? { kind: "carry", t: got.target } : null;
    }
    if (this.carry.pickWell(r) <= wall) return { kind: "carry", t: { at: "well" } };
    // The pond's own hit disc (sceneSky.ts) lies a few mm over the water and a rim wider: the water may be just behind it.
    const p = this.layout.pond;
    const water = rayDisc(r, p.x, 0.04, p.z, p.r);
    if (water < FOG_FAR && water < wall + 0.1) return { kind: "carry", t: { at: "water", x: r.ox + r.dx * water, z: r.oz + r.dz * water } };
    const g = groundAt(r, w);
    return g && Math.hypot(g.x - this.x, g.z - this.z) < GROUND_REACH ? { kind: "carry", t: { at: "ground", ...g } } : null;
  }

  /** A tap on a loose thing, the well, the water or the ground in reach (#358): act on it in reach; from farther away, walk up to it first. */
  private tapCarry(t: CarryTarget) {
    const at = this.carry.standFor(t, this.x, this.z);
    if (at.near) return this.doCarry(t);
    this.goTo(at.x, at.z, CARRY_STAND, () => this.doCarry(t));
  }

  /** Pick up a loose thing; throw what you hold in the water, put it down on the ground, or drop it in the well. Anything that no longer applies does nothing. */
  private doCarry(t: CarryTarget) {
    const c = this.carry;
    if (t.at === "thing") {
      if (!c.lift(t.i)) return;
      this.cb.onHand(true);
      this.cb.onCarry({ did: "lift" });
      return;
    }
    const at = t.at === "well" ? this.layout.well : t;
    if (!c.letGo(this.x, this.z, at.x, at.z, t.at === "water")) return;
    this.cb.onHand(false);
    this.cb.onCarry({ did: t.at === "water" ? "throw" : t.at === "well" ? "well" : "put" });
  }

  /** The action button's throw (#358): what you hold flies a few steps ahead, where you face. */
  private throwAhead() {
    const to = aimAt(this.x, this.z, this.yaw);
    if (!this.carry.letGo(this.x, this.z, to.x, to.z, true)) return;
    this.cb.onHand(false);
    this.cb.onCarry({ did: "throw" });
  }

  /** What answers a landing (carry.ts ANSWERS): the frog, a plant, the well. */
  private answerers: Answerers = {
    frogHop: () => this.guests.splash(),
    say: (id, text) => {
      if (!this.guests.here(id)) return false;
      this.say(id, text);
      return true;
    },
    perk: (x, z) => {
      let best: PlacedPlant | null = null;
      let bestD = PERK_NEAR;
      for (const p of this.layout.plants) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestD) [best, bestD] = [p, d];
      }
      if (best) this.nod(best);
      return !!best;
    },
    echo: (n) => {
      const e = echo(this.visitors.met, this.openedAt, n);
      // No words met yet: only the plop.
      if (!e) return;
      const from = this.elapsed + ECHO.delay;
      this.echoTap = { n, word: e.lemma, date: echoDate(e.at, this.openedAt, this.lang), from, until: from + ECHO.show };
    },
  };

  /** A put-down thing landed (#358): whoever its row names answers, and the page hears what happened. */
  private landed(l: Landing) {
    const a = l.reaction.answer;
    const more = a ? ANSWERS[a](this.answerers, l, this.answered[a]++) : null;
    this.cb.onCarry({ did: "land", said: more ? `${l.said} ${more}` : l.said });
  }

  /** The dandelion clock under a point on the canvas (CSS pixels), unless something stands in front of it. */
  private pickToy({ r }: TapAt): TapHit<"toy"> | null {
    const got = this.toys.pick(r);
    if (!got || got.t > FOG_FAR || this.hedgeAt(r) < got.t) return null;
    // From afar a tap walks there first: whatever stands in front of it is what the tap meets. In reach it comes first.
    const near = this.toys.standFor(got.i, this.x, this.z).near;
    return near || thingAt(r, this.sceneryWorld()) >= got.t ? { kind: "toy", i: got.i } : null;
  }

  /** A tap on a dandelion clock (#360): blow it in reach; from farther away, walk up to it first. */
  private tapToy(i: number) {
    const at = this.toys.standFor(i, this.x, this.z);
    const t: ToyTarget = { at: "clock", i };
    if (at.near) return this.doToy(t);
    this.goTo(at.x, at.z, TOY_STAND, () => this.doToy(t));
  }

  /** Blow a clock: one blown already does nothing. */
  private doToy(t: ToyTarget) {
    if (this.toys.blow(t.i)) this.cb.onToy({ did: "blow" });
  }

  /**
   * Sit on the bench, facing the pond, or on the lookout's stool (#858),
   * facing the far house: a cut to the seat, and the eye sinks (at once, with
   * reduced motion). Any move stands you up.
   */
  private sit(on: Seat) {
    if (on === "stool") {
      // The stool is there whenever the button offers it.
      const h = this.hill!;
      [this.x, this.z, this.yaw, this.pitch] = [h.stool[0], h.stool[1], h.face, 0];
    } else {
      const b = this.bench;
      // The bench faces +z, toward the pond; forward is -z at yaw 0.
      [this.x, this.z, this.yaw, this.pitch] = [b.x + SEAT.dx, b.z + 0.05, Math.PI, 0.1];
    }
    this.toWalker({ kind: "seated", on });
  }

  /** Stand up, if you sat (the action button). */
  private standUp() {
    if (this.walker.kind === "seated") this.toWalker(FREE);
  }

  /**
   * The one way the walker's state changes (#877): what leaving the old one
   * and entering the new one do. Moving with the keys calls it every frame,
   * so going from free to free does nothing and makes nothing new.
   */
  private toWalker(next: Walker) {
    const was = this.walker;
    this.walker = next;
    this.leaveWalker(was);
    this.enterWalker(next);
  }

  private leaveWalker(was: Walker) {
    switch (was.kind) {
      case "free":
      case "glide":
        return;
      case "trip":
        this.spot.visible = false;
        return;
      case "seated":
        return this.leaveSeat(was.on);
      default:
        return was satisfies never;
    }
  }

  private enterWalker(next: Walker) {
    switch (next.kind) {
      case "free":
      case "glide":
        return;
      case "trip":
        // goTo has put the ring where the walk goes.
        this.spot.visible = true;
        return;
      case "seated":
        this.sitOn = next.on;
        this.sat = 0;
        this.seatView = { yaw: this.yaw, pitch: this.pitch, looked: false };
        return;
      default:
        return next satisfies never;
    }
  }

  /** Stand up (any move does): who came to sit with you goes back to their own places, and time runs back to now (#362). */
  private leaveSeat(on: Seat) {
    if (on === "stool") {
      // Up off the stool, a step toward the far house: the stool is solid, and a walk starts where a walker may stand.
      const h = this.hill!;
      const out = STOOL_R + WALKER + 0.01;
      [this.x, this.z] = [h.stool[0] - Math.sin(h.face) * out, h.stool[1] - Math.cos(h.face) * out];
    }
    this.turnTo = null;
    this.gnomeSays = null;
    for (const id of this.come) this.guests.visit(id, null);
    const bird = this.come.has("bird");
    this.come.clear();
    this.onWay.clear();
    // The bird may have been waiting by a key before it came.
    if (bird) this.birdByKey();
    this.cb.onCompany(null);
  }

  /**
   * One frame of sitting on the bench (#362), before the camera moves: time
   * speeds up after a while (bench.ts), and visitors here today come to sit
   * with you: you can watch each one come (#802).
   * The head turns to whoever came (not with reduced motion, nor once you have
   * looked round yourself). Standing up, time runs back to the time chosen.
   */
  private onBench(dt: number) {
    let race = 0;
    const w = this.walker;
    if (w.kind === "seated") {
      this.sat += dt;
      race = lapseRate(this.sat);
      this.lapse += race * dt;
      if (w.on === "stool") {
        // On the stool, no one comes to sit with you, and time holds once it is night (#858).
        const most = untilNight(this.time);
        if (this.lapse >= most) [this.lapse, race] = [most, 0];
      } else this.company();
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

  /** One frame of company on the bench (#362): who comes, who has arrived, the gnome's word, and the head's turn toward whoever came. */
  private company() {
    const who = due(this.sat, this.here, this.come);
    if (who) this.sitBeside(who);
    for (const id of this.onWay) if (this.guests.arrived(id)) this.sitsWith(id);
    if (this.gnomeSays !== null && this.sat >= this.gnomeSays) {
      this.gnomeSays = null;
      this.guests.say("gnome", GNOME_WORD[this.lang]);
    }
    const t = this.turnTo;
    if (t) {
      const w = glance(this.sat - t.at);
      const v = this.seatView;
      this.yaw = v.yaw + (t.yaw - v.yaw) * w;
      this.pitch = v.pitch + (t.pitch - v.pitch) * w;
      if (w === 0 && this.sat > t.at) this.turnTo = null;
    }
  }

  /** A visitor comes to sit with you on the bench (#362), on its way there in its own way (#802). */
  private sitBeside(who: Companion) {
    const [dx, dy, dz] = COMPANY_SPOT[who];
    this.guests.visit(who, [this.bench.x + dx, dy, this.bench.z + dz], true);
    this.come.add(who);
    this.onWay.add(who);
  }

  /** A visitor got to the bench: a screen reader hears it, and the head turns to it. The gnome says its word once you see it. */
  private sitsWith(who: Companion) {
    this.onWay.delete(who);
    const [dx, dy, dz] = COMPANY_SPOT[who];
    const at = [this.bench.x + dx, dy, this.bench.z + dz];
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
  private tapDoor(a: DoorAction) {
    if (this.inReach(a, 0)) return this.doorAct(a);
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
      this.showLine(DOOR_LINES[this.lang].found, [d.key.x, 0.15, d.key.z], DOOR_SPOKEN.found);
    } else if (a === "open" && d.state === "held") {
      this.openDoor(true);
      this.clearTaps({ line: true });
      this.cb.onDoorOpen();
    } else if (a === "try" && d.state !== "open") this.showLine(DOOR_LINES[this.lang].locked, [L.gate.x, 1.5, z0], DOOR_SPOKEN.locked);
  }

  /** Show a quiet line over a point (null: over no point) for a few seconds. One tag at a time: a tapped scenery or visitor tag goes. */
  private showLine(text: string, at: [number, number, number] | null, spoken?: string) {
    // A line over no point rises and fades as the well's echo does (GardenWalk, kind "far"), over the echo's time.
    this.line = { text, spoken, at, until: this.elapsed + (at ? 4 : ECHO.show) };
    this.clearTaps({ scenery: true, tree: true, visitor: true, fruit: true });
  }

  /**
   * A scenery word, an orchard tree, the door's quiet line, a fallen fruit's
   * word (#359) and a visitor's tag take turns showing: setting one clears
   * whichever of the rest is named here. One place for the rule this file's
   * own select/tapVisitor/tapTree/tapScenery/showLine used to half-repeat,
   * each inline (#323).
   */
  private clearTaps(which: { scenery?: boolean; tree?: boolean; line?: boolean; visitor?: boolean; fruit?: boolean }) {
    if (which.scenery) this.sceneryTap = null;
    if (which.tree) this.treeTap = null;
    if (which.line) this.line = null;
    if (which.visitor) this.guests.untap();
    if (which.fruit) this.fruitTap = null;
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
    const near = step && (!shed || step.t < shed.t) ? step : shed;
    // Infinity: there is no diary yet. A tap on it opens it where it opens (LookoutThings.page).
    const book = this.lookoutThings?.pick(r) ?? Infinity;
    const got = book < (near ? near.t : Infinity) ? { id: this.lookoutThings!.page(), t: book } : near;
    if (!got || got.t > FOG_FAR || thingAt(r, this.sceneryWorld()) < got.t) return null;
    return { kind: "note", id: got.id };
  }

  /** A tap on a note: open it from in front of the shed, by the stile's foot (#714), or by the diary's stone (#858); from farther away, walk up to it first. */
  private tapNote(id: string) {
    const things = this.lookoutThings;
    if (things?.has(id)) {
      if (things.byDiary(this.x, this.z, 0)) return this.openDiary();
      const [sx, sz] = this.hill!.stone;
      return this.goTo(sx, sz, DIARY_REACH - 0.3, () => this.openDiary());
    }
    if (this.stile?.has(id)) {
      if (this.stile.inReach(this.x, this.z, 0)) return this.openNote(id);
      const [fx, fz] = stileAt(this.layout).foot;
      return this.goTo(fx, fz, 0, () => this.openNote(id));
    }
    if (this.notes.inFront(this.x, this.z, 0)) return this.openNote(id);
    const at = this.notes.standAt(id, this.camera.aspect * Math.tan((this.camera.fov * Math.PI) / 360));
    this.goTo(at.x, at.z, 0, () => this.openNote(id));
  }

  /** Open note `id` on its card; on the wall it is a read one from now on. */
  private openNote(id: string) {
    if (this.stile?.has(id)) this.stile.read(id);
    else this.notes.read(id);
    this.cb.onNote(id);
  }

  /** Open the diary (#858) on its oldest unread page, or its last. */
  private openDiary() {
    // The button and a tap offer the diary only while there is one.
    const id = this.lookoutThings!.page();
    this.readDiary(id);
    this.cb.onNote(id);
  }

  /** Diary page `id` was read, opened or turned to: the ribbon goes once every page is read. */
  readDiary(id: string) {
    // The diary's card shows only while there is a diary.
    this.lookoutThings!.read(id);
  }

  /** A joke's quiet line, over it for a few seconds (after a tap). */
  private tapJoke(j: Joke) {
    this.showLine(j.line, j.at, j.spoken);
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

  /** Show a tree's word and meaning over it for a few seconds (after a tap). One tag at a time. */
  private tapTree(tree: PlacedTree) {
    this.treeTap = { tree, until: this.elapsed + 4 };
    this.clearTaps({ scenery: true, line: true, visitor: true, fruit: true });
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
        y: this.hill ? hillY(this.hill, tx, tz) : 0,
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
      if (this.hill && Math.hypot(tree.x - this.hill.top[0], tree.z - this.hill.top[1]) < HILLTOP_R + 0.5) continue;
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
    const at = benchAt(c.L);
    this.bench = at;
    bench.position.set(at.x, 0, at.z);
    // Two cup rings on the seat, between where two would sit: small, seen only up close (#869, what the bench's line names).
    const rings = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.12), c.mat(T.pixelTexture(T.cupRings()), { alphaTest: 0.5 }));
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
      const board = signBoard(c, T.pixelTexture(T.notice(SNAIL_SIGN[this.lang])), 1.0, 0.4);
      board.position.y = 0.62;
      g.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), mat(woodTex));
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
      const board = signBoard(c, T.pixelTexture(T.notice(text)), w, w * 0.4);
      board.position.y = y;
      g.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, y, 0.04), mat(woodTex));
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
      stake(keepsakeLabel(keepsake.lemma, keepsake.at, this.lang), kept.x, bed.z + bed.d / 2 + 0.16, 0.5, 0.36);
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
    this.scene.add(still(decorMesh));
  }

  /** The marker over the selected plant, always on top of the hills and clouds; the ring on the ground where a walk goes. */
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
  }

  /** The visitor under a point on the canvas (CSS pixels), if any. */
  private pickVisitor(at: TapAt): TapHit<"visitor"> | null {
    // The hedge hides the visitors on its other side (#315): a bird in the orchard from the garden, the garden's from the orchard.
    const v = this.guests.pick(at.x, at.y, at.w, at.h, (x, y, z) => this.behindHedge(x, y, z));
    return v && { kind: "visitor", v };
  }

  /** The action button finds a hiding visitor (#379), as a tap on it would. */
  private seek(id: VisitorId) {
    this.guests.find(id);
    this.clearTaps({ scenery: true, tree: true, line: true, fruit: true });
  }

  /** The hiding visitor the action button would find now (#379), for the status a screen reader hears; null when it would find none. */
  hider(): Hider | null {
    const id = this.seekReach.shown;
    return id ? this.guests.hider(id) : null;
  }

  /**
   * A tap on a visitor: what it says back (the awake frog croaks one of the
   * `known` words) in a small bubble for a few seconds, or else its tag. Returns what it said.
   */
  private tapVisitor(id: VisitorId, known: readonly string[]): Reply | null {
    const said = this.guests.tap(id, known);
    this.clearTaps(said === null ? { scenery: true, tree: true, line: true, fruit: true } : { line: true });
    return said;
  }

  /** A visitor says something in a small bubble for a few seconds (the frog answering a splash, #358). */
  private say(id: VisitorId, text: string) {
    this.guests.say(id, text);
    this.clearTaps({ line: true });
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
    const g = this.back?.open ? this.groundPast(r, thingAt(r, w)) : groundAt(r, w);
    if (!g || Math.hypot(g.x - this.x, g.z - this.z) < GROUND_REACH) return null;
    const b = this.layout.bounds;
    const o = this.layout.orchard;
    const inGarden = g.x > b.minX && g.x < b.maxX && g.z > b.minZ && g.z < b.maxZ;
    const inOrchard = !!this.orchard && Math.abs(g.x - o.x) < o.w / 2 && Math.abs(g.z - o.z) < o.d / 2;
    // Past the fence, the cut way's or the hilltop's ground: where a walker may stand, or near enough that a tap at a bramble's foot counts.
    const s = collide(this.layout, g.x, g.z, WALKER, false, this.back);
    const past = g.z < b.minZ && Math.hypot(s.x - g.x, s.z - g.z) < TAP_SLACK;
    return inGarden || inOrchard || past ? { kind: "walk", ...g } : null;
  }

  /** Where a ray first meets the ground, the stile's steps and the hill too (#770), nearer than `far`; else null. */
  private groundPast(r: Ray, far: number): { x: number; z: number } | null {
    const at = (t: number) => r.oy + r.dy * t - this.lift(r.ox + r.dx * t, r.oz + r.dz * t);
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
      night: this.shown === "night",
      sunRadius: 0.045,
      clouds: this.sky.cloudPositions,
      cloudHalf: [8.8, 5],
    };
  }

  /** Show a scenery word's tag for a few seconds (after a tap), long enough to read its thought slowly when it has one (#864). One tag at a time: a visitor's tapped tag goes. */
  private tapScenery(s: { view: SceneryView; hit: SceneryHit }) {
    this.sceneryTap = { ...s, until: this.elapsed + (s.view.thought ? SCENERY_TAG.thought : SCENERY_TAG.word) };
    this.clearTaps({ tree: true, line: true, visitor: true, fruit: true });
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
    this.showTime(this.shown);
    // Their materials set up here, a slice at a time, not all on the next frame (~50 ms at CPU 10×, #459).
    await this.warm(this.plants.meshes());
    if (this.disposed) return;
    await this.plants.drawSprites();
    // The walk may have been left (and disposed) while the sprites were drawn.
    if (this.disposed) return;
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
    this.nightSky();
    this.birdByKey();
    // The sunflower droops a little at dusk.
    this.flower.params.setY(0, t === "dusk" ? 0.14 : 0);
    this.flower.params.needsUpdate = true;
  }

  /**
   * A key left waiting a few days (#334): at dusk and night the bird, if it is
   * here today, lands by it; not while it sits with you on the bench (#362).
   * Before the walk starts (its time is set just before), it is there already (#802).
   */
  private birdByKey() {
    const key = this.door.key;
    if (!this.keyHelp?.visitors || !key || this.come.has("bird")) return;
    const at = this.shown !== "day" ? besideKey(this.layout, key, "bird") : null;
    if (at && !this.started) this.guests.place("bird", at, key);
    else this.guests.visit("bird", at);
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
    // A small framebuffer scaled up by CSS with hard pixels. A whole number of
    // device pixels per game pixel keeps every pixel the same size.
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
    this.plants.nod(p, this.elapsed, this.reducedMotion);
  }

  look(dx: number, dy: number) {
    this.lookedRound();
    this.yaw -= dx * 0.0055;
    this.pitch = Math.max(-0.75, Math.min(0.5, this.pitch - dy * 0.004));
  }

  /**
   * The viewer looks where they like now: a glide stops; a walk goes on, but no
   * longer turns the view; on the bench (#362), the head no longer turns to who comes.
   */
  private lookedRound() {
    const w = this.walker;
    if (w.kind === "glide") this.toWalker(FREE);
    else if (w.kind === "trip") w.turn = false;
    this.seatView.looked = true;
    this.turnTo = null;
  }

  /** Walk straight ahead (or back, if negative) by `metres`. */
  step(metres: number) {
    this.toWalker(FREE);
    ({ x: this.x, z: this.z } = walk(this.layout, this.x, this.z, this.x - Math.sin(this.yaw) * metres, this.z - Math.cos(this.yaw) * metres, this.door.state === "open", this.trunks, this.back));
  }

  turn(amount: number) {
    this.lookedRound();
    this.yaw += amount;
  }

  /** Walk to open ground (#336, a tap on it). */
  private walkTo(x: number, z: number) {
    this.goTo(x, z, 0, null);
  }

  /** A tap on a plant (#336): its card opens where you stand when its name shows; from farther away, you walk to it first. */
  private tapPlant(p: PlacedPlant) {
    if (Math.hypot(p.x - this.x, p.z - this.z) < NAME_NEAR) {
      // A walk under way stops: the viewer is looking at this plant now.
      if (this.walker.kind === "trip") this.toWalker(FREE);
      return this.select(p);
    }
    this.select(null);
    const v = viewpoint(this.layout, p);
    // On arrival, the short glide that faces the plant, as Next plant does, and its card.
    this.goTo(v.x, v.z, 0, () => this.select(p, true));
  }

  /** Walk round whatever is in the way to (x, z), or as near as a walker may stand, then stop `stop` m short and do `then`. */
  private goTo(x: number, z: number, stop: number, then: (() => void) | null) {
    // A glide (Next plant) passes over beds; a tap during one starts from where a walker would stand.
    ({ x: this.x, z: this.z } = standAt(this.ground, this.x, this.z));
    // Standing up off the stool steps you off it: the way starts from there.
    this.toWalker(FREE);
    const to = standAt(this.ground, x, z);
    this.spot.position.set(to.x, 0.03 + this.lift(to.x, to.z), to.z);
    this.toWalker({ kind: "trip", way: wayNear(this.ground, this.x, this.z, to.x, to.z, 0), leg: 1, stop, then, turn: !this.reducedMotion, stuck: 0 });
  }

  /**
   * One frame of a walk (#336): toward the next corner at walking speed (world.ts walkStep).
   * The view turns gently toward where it goes; with reduced motion it keeps still, and the walk moves at an even pace.
   */
  private walkOn(g: Walker & { kind: "trip" }, dt: number) {
    this.at.x = this.x;
    this.at.z = this.z;
    const now = walkStep(this.layout, g, this.at, WALK * this.pace() * dt, dt, this.door.state === "open", this.trunks, this.back);
    this.x = this.at.x;
    this.z = this.at.z;
    if (now === "arrived") {
      this.toWalker(FREE);
      return g.then?.();
    }
    if (now === "stalled") {
      this.toWalker(FREE);
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
    const near = [...this.layout.plants, ...this.trunks]
      .map((t) => ({ t, d: Math.hypot(t.x - this.x, t.z - this.z) }))
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
    visitor: { pick: (at) => this.pickVisitor(at), tap: (h, known) => this.tapVisitor(h.v.id, known) },
    plant: { pick: (at) => this.pickPlant(at), tap: (h) => this.tapPlant(h.p) },
    tree: { pick: (at) => this.pickTree(at), tap: (h) => this.tapTree(h.t) },
    door: { pick: (at) => this.pickDoor(at), tap: (h) => this.tapDoor(h.a) },
    joke: { pick: (at) => this.pickJoke(at), tap: (h) => this.tapJoke(h.j) },
    note: { pick: (at) => this.pickNote(at), tap: (h) => this.tapNote(h.id) },
    lantern: { pick: (at) => this.pickLantern(at), tap: (h) => this.tapLantern(h.i) },
    carry: { pick: (at) => this.pickCarry(at), tap: (h) => this.tapCarry(h.t) },
    toy: { pick: (at) => this.pickToy(at), tap: (h) => this.tapToy(h.i) },
    walk: { pick: (at) => this.pickGround(at), tap: (h) => this.walkTo(h.x, h.z) },
    scenery: { pick: (at) => this.pickScenery(at), tap: (h) => this.tapScenery(h.s) },
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

  /** Act on what a tap met (pickAny). A visitor may answer (`known`: the words it may say): this returns what it said. */
  tap<K extends TapHit["kind"]>(hit: TapHit<K>, known: readonly string[]): Reply | null | void {
    return this.tappers[hit.kind].tap(hit, known);
  }

  select(p: PlacedPlant | null, walkTo = false) {
    this.selected = p;
    if (p) this.clearTaps({ scenery: true, tree: true, fruit: true });
    const index = p ? this.layout.plants.indexOf(p) : -1;
    for (const mat of this.mats) mat.uniforms.uSelected.value = index;
    this.marker.visible = !!p;
    if (p && walkTo) {
      this.toWalker(FREE);
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
        const path = route(this.layout, this.x, this.z, v.x, v.z, this.back);
        this.toWalker({ kind: "glide", path, yaw: [this.yaw, yaw], pitch: [this.pitch, pitch], t: 0, s: path.length > 2 ? 1.8 : 0.9 });
      }
    }
    this.cb.onSelect(p);
  }

  start() {
    this.started = true;
    const loop = () => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(loop);
      const now = performance.now();
      this.picker?.frame(now - this.last);
      const dt = Math.min(MAX_FRAME, (now - this.last) / 1000);
      this.last = now;
      this.elapsed += dt;
      this.tick(dt);
    };
    // The first frame in a task of its own: it sets up every shader for drawing, and loadPlants follows in this one (#459).
    this.frame = requestAnimationFrame(loop);
  }

  /** One frame of a walk or a glide under way. */
  private moveOn(dt: number) {
    const w = this.walker;
    switch (w.kind) {
      case "free":
      case "seated":
        return;
      case "trip":
        return this.walkOn(w, dt);
      case "glide": {
        w.t = Math.min(1, w.t + dt / w.s);
        const e = w.t < 0.5 ? 2 * w.t * w.t : 1 - (-2 * w.t + 2) ** 2 / 2;
        ({ x: this.x, z: this.z } = along(w.path, e));
        this.yaw = w.yaw[0] + (w.yaw[1] - w.yaw[0]) * e;
        this.pitch = w.pitch[0] + (w.pitch[1] - w.pitch[0]) * e;
        if (w.t >= 1) this.toWalker(FREE);
        return;
      }
      default:
        return w satisfies never;
    }
  }

  private tick(dt: number) {
    const t = this.elapsed;
    const motion = this.reducedMotion ? 0 : 1;

    // Walking: forward is -z at yaw 0. Where the walker was, and whether they went on foot, for how fast they walk into things (#359).
    const x0 = this.x;
    const z0 = this.z;
    const onFoot = this.walker.kind === "trip" || Math.hypot(this.input.move.x, this.input.move.y) > 0.01;
    const { move, run } = this.input;
    const len = Math.hypot(move.x, move.y);
    if (len > 0.01) {
      this.toWalker(FREE);
      const speed = WALK * (run ? 2 : 1) * this.pace() * Math.min(1, len);
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const nx = this.x + ((fx * move.y + -fz * move.x) / Math.max(1, len)) * speed * dt;
      const nz = this.z + ((fz * move.y + fx * move.x) / Math.max(1, len)) * speed * dt;
      ({ x: this.x, z: this.z } = walk(this.layout, this.x, this.z, nx, nz, this.door.state === "open", this.trunks, this.back));
      this.bob += dt * speed * 3.2;
    }
    this.moveOn(dt);
    this.onBench(dt);
    // Sitting down or standing up: the eye sinks or rises over a moment (at once, with reduced motion).
    const sat = this.walker.kind === "seated" ? 1 : 0;
    this.seat = this.reducedMotion ? sat : this.seat + Math.max(-dt * SEAT.speed, Math.min(dt * SEAT.speed, sat - this.seat));
    this.camera.position.set(this.x, EYE - (EYE - SEAT.eye) * this.seat + this.lift(this.x, this.z) + Math.sin(this.bob) * 0.035 * motion, this.z);
    // On the stool the view narrows as you sit, and widens again as you get up (#858).
    const fov = this.sitOn === "stool" ? FOV - (FOV - STOOL_FOV) * this.seat : FOV;
    if (fov !== this.camera.fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
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
    // plants nearest you, the perk and sneeze uniforms, brushing), the
    // visitors, the jokes, walking into trees and leaf piles (#359), the loose
    // things (the pond's rings), then the toys (#360: the
    // dandelion seeds).
    const frame = this.tickFrame;
    frame.dt = dt;
    frame.elapsed = t;
    frame.x = this.x;
    frame.z = this.z;
    frame.yaw = this.yaw;
    // dt is 0 only on the very first frame, before anyone could walk.
    frame.speed = onFoot && dt > 0 ? Math.hypot(this.x - x0, this.z - z0) / dt : 0;
    for (const part of this.parts) part.tick?.(frame);
    if (this.lookout.answering(t)) this.showLine(ANSWER_LINE[this.lang], null, ANSWER_SPOKEN);
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

  /** How high the ground stands at (x, z) (m): the stile's steps and the hill past it (#770); 0 in the garden. Runs every frame: no allocation. */
  private lift(x: number, z: number): number {
    if (!this.stileSpot || !this.hill) return 0;
    return stepY(this.stileSpot, x, z) + hillY(this.hill, x, z);
  }

  /** How fast a walk goes now, as a share of WALK: slower on the stile's steps (#770). */
  private pace(): number {
    return this.stileSpot && stepY(this.stileSpot, this.x, this.z) > 0 ? STEPS_PACE : 1;
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
      const { thought } = st.view;
      // A thought's tag fades out at the end; it is wider than a word's, so it is kept on the screen.
      if (v.z <= 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1)
        tags.scenery = thought
          ? { id: `scenery:${st.view.id}`, text: st.view.word, gloss: st.view.gloss, known: st.view.known, kind: "scenery", thought, x: onScreen((v.x + 1) / 2, THOUGHT_EDGE), y: Math.max(THOUGHT_TOP, onScreen((1 - v.y) / 2)), near: Math.min(1, (st.until - this.elapsed) / SCENERY_TAG.fade) }
          : { id: `scenery:${st.view.id}`, text: st.view.word, gloss: st.view.gloss, known: st.view.known, kind: "scenery", x: (v.x + 1) / 2, y: (1 - v.y) / 2, near: 1 };
    }
    // The door's quiet line (#315), while it shows.
    const ln = this.line;
    if (ln && this.elapsed > ln.until) this.line = null;
    else if (ln && !ln.at) tags.line = { id: "line", text: ln.text, gloss: ln.spoken, kind: "far", x: 0.5, y: LOW_LINE, near: 1 };
    else if (ln?.at) {
      v.set(...ln.at).project(this.camera);
      // Kept on the screen: standing right at the door, its top is above the view, and the line must still be read.
      if (v.z <= 1) tags.line = { id: "line", text: ln.text, gloss: ln.spoken, kind: "line", x: onScreen((v.x + 1) / 2), y: onScreen((1 - v.y) / 2), near: 1 };
    }
    // A tapped orchard tree's word (#315), over its crown; kept on the screen, as a tall tree's top is often above the view.
    const tt = this.treeTap;
    if (tt && this.elapsed > tt.until) this.treeTap = null;
    else if (tt) {
      v.set(tt.tree.x, tt.tree.height + 0.08, tt.tree.z).project(this.camera);
      if (v.z <= 1) tags.tree = { id: `tree:${tt.tree.id}`, text: tt.tree.lemma, gloss: tt.tree.gloss, kind: "tree", x: onScreen((v.x + 1) / 2), y: onScreen((1 - v.y) / 2), near: 1 };
    }
    // A fallen fruit's word (#359), over the fruit as it rolls; kept on the screen. Its meaning is the fruit's kind, the plain English name.
    const fr = this.fruitTap;
    if (fr && this.elapsed > fr.until) this.fruitTap = null;
    else if (fr) {
      v.set(fr.at.x, fr.at.y + 0.25, fr.at.z).project(this.camera);
      if (v.z <= 1) tags.fruit = { id: "fruit", text: fr.tree.lemma, gloss: fr.tree.kind, kind: "fruit", x: onScreen((v.x + 1) / 2), y: onScreen((1 - v.y) / 2), near: 1 };
    }
    // The well's echo (#335 S6), a moment after the plop, over its roof; kept on the screen.
    const ec = this.echoTap;
    if (ec && this.elapsed > ec.until) this.echoTap = null;
    else if (ec && this.elapsed >= ec.from) {
      const w = this.layout.well;
      v.set(w.x, 1.4, w.z).project(this.camera);
      if (v.z <= 1) tags.echo = { id: `echo:${ec.n}`, text: ec.word, gloss: ec.date, kind: "echo", x: onScreen((v.x + 1) / 2), y: onScreen((1 - v.y) / 2), near: 1 };
    }
    // A visitor's approach tag shows only while none of line/fruit/scenery/tree is active (clearTaps keeps at most one of those set at a time).
    const exclusiveActive = !!(this.sceneryTap || this.treeTap || this.line || this.fruitTap);
    const { say, tag } = this.guests.labels(this.x, this.z, !exclusiveActive);
    if (say) tags.say = say;
    if (tag) tags.tag = tag;
    // One table for what shows over what: say (a visitor's bubble) always; then whichever of line/scenery/tree is active; last, a visitor's tag.
    for (const kind of LABEL_PRIORITY) {
      const l = tags[kind];
      if (l) out.push(l);
    }
    this.reportReach();
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

  /** The lantern in reach while they are lit (#361), by spot, or -1. */
  private lampInReach(): number {
    const shown = this.lanternReach.shown;
    // -1: the button shows no lantern now.
    return this.lanterns.inReach(this.x, this.z, shown === null ? -1 : shown);
  }

  /** The hiding visitor in reach (#379). */
  private seekReach: Reachable<VisitorId> = reachable({
    shown: null,
    reach: () => {
      const id = this.guests.hiderNear(this.x, this.z, this.seekReach.shown);
      return id ? { a: "seek", target: id } : null;
    },
    act: (_, id) => this.seek(id),
  });

  /** The lantern in reach (#361): blow it out, or light it again. */
  private lanternReach: Reachable<number> = reachable({
    shown: null,
    reach: () => {
      const i = this.lampInReach();
      return i < 0 ? null : { a: this.lanterns.on[i] ? "snuff" : "light", target: i };
    },
    act: (_, i) => this.toggleLantern(i),
  });

  /** A dandelion clock in reach (#360): blow it. */
  private toyReach: Reachable<ToyTarget> = reachable({
    shown: null,
    reach: () => this.toys.reachAt(this.x, this.z, this.toyReach.shown),
    act: (_, t) => this.doToy(t),
  });

  /** The plant ahead of you (#357): shake it. */
  private plantReach: Reachable<PlacedPlant> = reachable({
    shown: null,
    reach: () => {
      const p = plantInReach(this.layout.plants, this.x, this.z, this.yaw, this.plantReach.shown);
      return p && { a: "shake", target: p };
    },
    act: (_, p) => this.shakeNow(p),
    mark: (p) => this.plants.ready(p),
  });

  /** A loose thing (#358): one in your hands is thrown, or dropped in the well; with your hands free, one in reach is picked up. */
  private carryReach(held: boolean) {
    const r: Reachable<CarryTarget | null> = reachable({
      shown: null,
      reach: () => ((this.carry.held !== null) === held ? this.carry.reachAt(this.x, this.z, r.shown) : null),
      act: (a, t) => {
        if (a === "throw") this.throwAhead();
        // Every other carry act has a target (Carry.reachAt).
        else if (t) this.doCarry(t);
      },
    });
    return r;
  }

  /**
   * Everything the action button can act on (#334, #850), in the order it
   * chooses: the first in reach wins. On the bench it only gets you up; on
   * the lookout's stool it blows out or lights the lantern beside you while
   * they are lit, else gets you up (#858); then the key; a loose thing in your
   * hands; a hiding visitor (#379), before the bench and the plant ahead: it
   * hides under the one and behind the other; the door, unless a lantern by
   * the gate is nearer; the lookout's stool, then its diary, before the
   * lantern on the post a step in front of the stool; a lantern; a
   * note (#654) in the shed or at the stile's foot; a loose thing to pick up;
   * the bench; a dandelion clock (#360); last the plant ahead of you (#357).
   */
  private reachables: Reachable<unknown>[] = [
    reachable<number | null>({
      shown: null,
      reach: () => {
        if (this.walker.kind !== "seated") return null;
        // -1: by day the lookout's lantern is not lit, and the bench has none.
        const i = this.walker.on === "stool" ? this.lanterns.lookoutLamp : -1;
        return i < 0 ? { a: "stand", target: null } : { a: this.lanterns.on[i] ? "snuff" : "light", target: i };
      },
      act: (_, i) => (i === null ? this.standUp() : this.toggleLantern(i)),
    }),
    reachable({
      shown: null,
      reach: () => (this.door.state === "key" && this.inReach("key", slack(this.reach === "key")) ? { a: "key", target: null } : null),
      act: () => this.doorAct("key"),
    }),
    this.carryReach(true),
    this.seekReach,
    reachable<DoorAction>({
      shown: null,
      reach: () => {
        const d = this.door;
        // The two lanterns by the gate stand in the door's reach: whichever is nearer comes first.
        const lamp = this.lampInReach();
        const lampNear = lamp < 0 ? Infinity : Math.hypot(this.lanterns.spot(lamp)[0] - this.x, this.lanterns.spot(lamp)[1] - this.z);
        const near = d.state !== "open" && this.inReach("try", slack(this.reach === "try" || this.reach === "open")) && Math.hypot(this.x - this.layout.gate.x, this.z - this.layout.bounds.maxZ) <= lampNear;
        if (!near) return null;
        const a = d.state === "held" ? "open" : "try";
        return { a, target: a };
      },
      act: (_, a) => this.doorAct(a),
    }),
    reachable({
      shown: null,
      reach: () => (this.lookoutThings?.byStool(this.x, this.z, slack(this.reach === "stool")) ? { a: "stool", target: null } : null),
      act: () => {
        if (this.walker.kind !== "seated") this.sit("stool");
      },
    }),
    reachable({
      shown: null,
      reach: () => (this.lookoutThings?.byDiary(this.x, this.z, slack(this.reach === "diary")) ? { a: "diary", target: null } : null),
      act: () => this.openDiary(),
    }),
    this.lanternReach,
    reachable({
      shown: null,
      reach: () => {
        const near = slack(this.reach === "read");
        const id = this.notes.reachAt(this.x, this.z, this.yaw, this.pitch, EYE, near) ?? (this.stile?.inReach(this.x, this.z, near) ? this.stile.unopened() : null);
        return id ? { a: "read", target: id } : null;
      },
      act: (_, id) => this.openNote(id),
      mark: (id) => this.notes.lift(id),
    }),
    this.carryReach(false),
    reachable({
      shown: null,
      reach: () => (Math.hypot(this.x - this.bench.x, this.z - this.bench.z) < BENCH_REACH + slack(this.reach === "sit") ? { a: "sit", target: null } : null),
      act: () => {
        if (this.walker.kind !== "seated") this.sit("bench");
      },
    }),
    this.toyReach,
    this.plantReach,
  ];

  /**
   * Tell the page what the action button does now (#334): the first thing in
   * `reachables` in reach. With nothing in reach, no button (#835): when it
   * shows, it has something to do. The button's name says what it does, so
   * nothing in reach flashes (#689).
   */
  private reportReach() {
    let won: Reachable<unknown> | null = null;
    let got: { a: Reach; target: unknown } | null = null;
    for (const t of this.reachables) {
      got = t.reach();
      if (got) {
        won = t;
        break;
      }
    }
    const a = got ? got.a : null;
    const target = got ? got.target : null;
    // Targets are made once (Carry.reachAt, Toys.reachAt), so the same target is the same object.
    if (a === this.reach && won === this.reacher && (won === null || target === won.shown)) return;
    this.reach = a;
    this.reacher = won;
    for (const t of this.reachables) {
      t.shown = t === won ? target : null;
      t.mark?.(t.shown);
    }
    this.cb.onReach(a);
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
