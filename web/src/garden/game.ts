// The garden's game (#975): all its state and rules, with no three.js, no
// window, and no clock or random of its own. The scene (scene.ts) draws it:
// each frame it feeds the input, steps the game, and draws what it holds. A
// tap the scene picked comes in as an event (tapPlant, tapDoor...), the action
// button as `act`; what must be shown goes out through the hooks. A unit test
// plays it with no browser at all (game.test.ts).

import { BED_H, benchAt, besideKey, DOOR_LINES, DOOR_SPOKEN, HEDGE, keyAt, viewpoint, type BackWay, type KeyHelp, type KeySpot, type Layout, type PlacedPlant } from "./world";
import * as R from "./reachCore";
import * as W from "./walker";
import type { Ground } from "./ground";
import { placeTrees, type OrchardTree, type PlacedTree } from "./orchard";
import type { SceneryHit, SceneryView, SceneryViews } from "./scenery";
import type { VisitorId, VisitorView } from "./visitors";
import { conditions } from "./conditions";
import { ANSWER_LINE, ANSWER_NOTE, ANSWER_SPOKEN, backWay, Diary, DIARY_REACH, hasNote, HILL_NOTE, lookoutAt, LookoutLight, type Lookout } from "./lookout";
import { stileAt, StileNotes, type NotePlace, type StileSpot } from "./stile";
import { courseNotes } from "./notes/read";
import { ShedWall } from "./shed";
import { aimAt, ANSWERS, CARRY_STAND, Pebbles, type Answer, type Answerers, type CarryDone, type CarryTarget, type Landing } from "./carry";
import { echo, echoDate, type Met } from "./well";
import { Clocks, TOY_STAND, type ToyDone, type ToysWalk, type ToyTarget } from "./toys";
import { NAME_NEAR, petalForms } from "./shake";
import { Lamps } from "./lanterns";
import { MouseMat } from "./mouseDoor";
import { backRate, COMPANY_SPOT, due, glance, GLANCE, GNOME_WORD, lapseLook, lapseRate, settle, untilNight, type Companion, type Look } from "./bench";
import type { Rolling } from "./walkInto";
import type { DeckLang } from "../deck/langs";

export type TimeOfDay = "day" | "dusk" | "night";

/**
 * The door in the hedge (#315), as the walk opens: locked; locked with the key
 * hidden somewhere in the garden (its garden word brought it), with the help
 * the world gives once it has waited a while (#334); or open for good.
 */
export type DoorState = "locked" | { key: KeySpot; help: KeyHelp } | "open";

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
  /** The last note (#882), on the mat of the open mouse door: null until it is unlocked, and until then the mouse door is shut. */
  mouseDoor: NotePlace | null;
}

/** The eye's height (m), standing. */
export const EYE = 1.05;
/**
 * A tapped scenery word's tag (#74), in seconds: a word alone shows for `word`; one with a thought (#864) for `thought`,
 * long enough to read it slowly, and fades out over its last `fade`.
 */
export const SCENERY_TAG = { word: 4, thought: 10, fade: 0.6 };
/** Where a walk to the door stops: on the path in front of it, in reach of it (reachCore.ts DOOR_REACH). */
const DOOR_STAND = 1.4;
/** A walk to the key stops this short of it (m), so it is still in view, in reach (KEY_REACH). */
const KEY_STAND = 1;
/** The well's echo (#335 S6) comes this long (s) after the plop, and shows for this long. */
const ECHO = { delay: 1.2, show: 5 };
/** A plant this near (m) where a thing lands perks up (#358). */
const PERK_NEAR = 0.9;

/**
 * The door in the hedge, as the game holds it (#315): "key" while its key lies
 * in the garden, "held" once the learner picked it up this walk; only "open"
 * is saved.
 */
export interface DoorNow {
  state: "locked" | "key" | "held" | "open";
  /** Where the key lies, or lay before it was picked up; null when this walk has no key. */
  readonly key: { x: number; z: number } | null;
  /** The world's help for a key left waiting (#334); null without a key. */
  readonly help: KeyHelp | null;
  /** The dog waits by the key (#802): it is the help, so the key does not glint. A star by the dog read as the dog sparkling. */
  guarded: boolean;
}

/**
 * Today's visitors, as the game sends them about (sceneVisitors.ts moves and
 * draws them). They are not the game's own state yet: NO_GUESTS stands in for
 * them in a garden with no browser.
 */
export interface Guests {
  /** Is this visitor here today? */
  has(id: VisitorId): boolean;
  /** Is it here, in the garden, now (not gone off to sit with you, nor hiding)? */
  here(id: VisitorId): boolean;
  /** Send it to a place (null: back to its own), on its way there in its own way; `settled`: it stays. */
  visit(id: VisitorId, at: [number, number, number] | null, settled?: boolean): void;
  /** Put it at a place at once, looking at `looks`. */
  place(id: VisitorId, at: [number, number, number], looks: { x: number; z: number }): void;
  /** Has it got where it was sent? */
  arrived(id: VisitorId): boolean;
  say(id: VisitorId, text: string): void;
  /** Its tapped tag goes. */
  untap(): void;
  /** A hiding visitor is found (#379). */
  find(id: VisitorId): void;
  hiderNear(x: number, z: number, held: VisitorId | null): VisitorId | null;
  /** The frog hops in at a splash: true if it is here to hop. */
  splash(): boolean;
  /** The garden's lanterns, lit or out (the moth goes to a lit one). */
  lanternsLit(on: readonly boolean[]): void;
}

/** No visitors at all: for a garden played with no browser (game.test.ts). @internal Exported for tests. */
export const NO_GUESTS: Guests = {
  has: () => false,
  here: () => false,
  visit() {},
  place() {},
  arrived: () => false,
  say() {},
  untap() {},
  find() {},
  hiderNear: () => null,
  splash: () => false,
  lanternsLit() {},
};

/** What the game tells whoever shows it (the scene, or a test): each is called when that thing happens, never every frame. */
export interface GameHooks {
  /** How high plant `p`'s top stands (m), as its sprite shows it: the walk to a plant looks at its flower head. */
  plantTop(p: PlacedPlant): number;
  /** A plant was chosen (its card opens), or none. */
  select(p: PlacedPlant | null): void;
  /** A plant was shaken (#357): the forms that fall from it ([]: one leaf). */
  shake(p: PlacedPlant, forms: string[]): void;
  /** A plant perks up (#60, #358). */
  nod(p: PlacedPlant): void;
  /** A blown clock's seeds made plant `plant` (its index in the layout) sneeze (#360). */
  sneeze(plant: number): void;
  /** You picked up a pebble, or let it go (#358). */
  hand(holding: boolean): void;
  carry(done: CarryDone): void;
  toy(done: ToyDone): void;
  /** The key was picked up: it is no longer on the ground. */
  keyTaken(): void;
  /** The door opened for good, in this walk: what lies behind it is there now. */
  doorOpen(): void;
  /** Note `id` was read where it lies: its paper shows it as read now. */
  read(on: "shed" | "stile" | "mat" | "diary", id: string): void;
  /** Open note `id` on its card (#654). */
  open(id: string): void;
  /** Sitting on the bench (#362): who just came to sit with you, or null once you stand up. */
  company(c: Companion | null): void;
  /** A walk to a tapped spot stalled (#336): a way wayTo should never give. At most once per game. */
  stall(): void;
  /** What the action button does now (#334), and to which thing; null with nothing in reach. */
  reach(offer: R.Offer | null): void;
  /** Every lantern is out and the stars are out over the hills, or no longer (#361). */
  stars(out: boolean): void;
  /** A time of day is on show now: the one chosen, or one on the way while time speeds up on the bench (#362). */
  time(t: TimeOfDay): void;
  /** The light between two times of day while time speeds up on the bench, and how fast it runs (#362); null when it is back to the time chosen. */
  blend(look: Look | null, race: number): void;
  /** Where a walk goes (#336): its ring on the ground; null once it ends. */
  trip(to: { x: number; z: number } | null): void;
  /** Lantern `i` was blown out or lit again (#361). */
  lantern(i: number): void;
}

/** The garden, all its state and rules: the walker, what is in reach, and every small thing in it. */
export class Game {
  /** The walker (walker.ts): where you stand, where you look, and what you are doing. */
  readonly me: W.Walker;
  readonly world: W.WalkerWorld;
  /** Seconds since the walk opened: the game's only clock. */
  elapsed = 0;
  /** What the action button does now (#334), and to which thing (reachCore.ts); null with nothing in reach. */
  offer: R.Offer | null = null;
  /** What the button can act on, for reachCore.ts. */
  readonly things: R.Things;
  readonly door: DoorNow;
  /** The orchard's trees where they stand (orchard.ts placeTrees): none while the door is shut. */
  trunks: readonly PlacedTree[] = [];
  readonly lamps: Lamps;
  /** The signals with the lookout's lantern and the far light's answers (#858). */
  readonly lookout: LookoutLight;
  /** Carry (#358): the pebbles; and how often each one has answered a landing this visit. */
  readonly pebbles: Pebbles;
  private answered: Record<Answer, number> = { frog: 0, plant: 0, well: 0 };
  /** The lawn toys (#360): the dandelion clocks. */
  readonly clocks: Clocks;
  /** The gardener's notes on the shed's nails (#654). */
  readonly shed: ShedWall;
  /** The notes under the stile's step (#714): null until there is a stile. */
  readonly stileNotes: StileNotes | null;
  /** The diary on the hill (#858): null until its first page is unlocked. */
  readonly diary: Diary | null;
  /** The mouse door's mat, and the last note on it (#882). */
  readonly mouse: MouseMat;
  /**
   * The stile, the hill past it and the lookout on its top (#722), all null
   * until the stile is there; and the ground past the back fence the walker
   * may stand on (#770): none past the brambles until the note that tells of
   * the hill is unlocked, then over the stile and up the old path.
   */
  readonly stileSpot: StileSpot | null;
  readonly hill: Lookout | null;
  readonly hillOpen: boolean;
  readonly back: BackWay | null;
  /** The pond's bench, by its middle (world.ts benchAt), worked out once: reportReach runs every frame. */
  readonly bench: { x: number; z: number };

  /**
   * A quiet line from the garden (the door's, or a joke's), over a point, until a time. A joke's line is in the
   * course language, and `spoken` is its English for screen readers (#650). The far light's answer (#858) is
   * over no point (null): it is low in the view, read wherever you look.
   */
  line: { text: string; spoken?: string; at: [number, number, number] | null; until: number } | null = null;
  /** The tapped scenery word and where its tag sits (it follows the sun or a cloud). */
  sceneryTap: { view: SceneryView; hit: SceneryHit; until: number } | null = null;
  /** The orchard tree tapped last and until when its tag shows. */
  treeTap: { tree: PlacedTree; until: number } | null = null;
  /** A fallen fruit's tag (#359): the word of the tree it fell from, over the fruit as it rolls, for a few seconds. */
  fruitTap: { tree: PlacedTree; at: Readonly<Rolling>; until: number } | null = null;
  /** The well's echo (#335 S6): an old word and the day it was met, over the well, from `from` until `until` (elapsed s). */
  echoTap: { n: number; word: string; date: string; from: number; until: number } | null = null;

  /**
   * Sitting still on the bench (#362): seconds sat; how far time has run on
   * (parts of the day past `time`, bench.ts) and the look on show for it; who
   * came to sit with you; the view you sat down with, and whether you have
   * looked round yourself since; the turn of the head toward who came last;
   * and when the gnome says its word (seconds sat).
   */
  private sat = 0;
  lapse = 0;
  private readonly lapseNow: Look = { from: "day", to: "day", k: 0 };
  private come = new Set<Companion>();
  /** Who is on the way to the bench, not there yet (#802). */
  private onWay = new Set<Companion>();
  private seatView = { yaw: 0, pitch: 0, looked: false };
  private turnTo: { yaw: number; pitch: number; at: number } | null = null;
  private gnomeSays: number | null = null;
  /** Is this visitor here today? Made once: the bench asks every frame while you sit. */
  private readonly here = (id: Companion) => this.guests.has(id);
  /** The eye's seat (#334, #858), sat on now or last: the view narrows on the stool. */
  sitOn: W.Seat = "bench";
  /** The time of day chosen (the clock, or the button), and the one on show: they differ while time speeds up on the bench (#362). */
  time: TimeOfDay = "day";
  shown: TimeOfDay = "day";
  /** Time is sped up on the bench now, or running back to the time chosen (#362). */
  private lapsing = false;
  /** The plant whose card is open. */
  selected: PlacedPlant | null = null;
  /** Whether a stalled walk was reported this time in the garden. */
  private stallReported = false;
  /** The walk is drawn: from now on a visitor sent somewhere goes there in its own way (#802). */
  private started = false;

  private readonly layout: Layout;
  /** The course language: the lines the garden says are in it (#650). */
  private readonly lang: DeckLang;
  private readonly visitors: WalkVisitors;
  /** When the walk opened (ms): the well's echo reaches back from then. */
  private readonly openedAt: number;
  private readonly hooks: GameHooks;
  private readonly guests: Guests;

  constructor(layout: Layout, lang: DeckLang, visitors: WalkVisitors, reducedMotion: boolean, openedAt: number, hooks: GameHooks, guests: Guests) {
    this.layout = layout;
    this.lang = lang;
    this.visitors = visitors;
    this.openedAt = openedAt;
    this.hooks = hooks;
    this.guests = guests;
    // Start inside the gate, close enough that the first bed fills the view.
    const first = layout.beds[0];
    this.bench = benchAt(layout);
    this.me = W.newWalker(layout.gate.x, Math.min(layout.gate.z - 1.2, first.z + first.d / 2 + 3.2));
    // The way over the stile opens once the note that tells of the hill is unlocked (#770), and the far light answers once the note that tells of that is.
    // Null: no diary page is unlocked yet.
    const notes = [...visitors.notes, ...(visitors.diary ?? [])].map((n) => n.id);
    this.hillOpen = hasNote(courseNotes(lang), notes, HILL_NOTE);
    this.stileSpot = visitors.stile ? stileAt(layout) : null;
    this.hill = this.stileSpot ? lookoutAt(this.stileSpot) : null;
    this.back = this.stileSpot && this.hill ? backWay(this.stileSpot, this.hill, this.hillOpen) : null;
    // The door and the trees are read when asked: the door opens during a walk.
    const ground: Ground = { layout, doorOpen: () => this.door.state === "open", trees: () => this.trunks, back: this.back };
    this.world = { ground, stile: this.stileSpot, hill: this.hill, reducedMotion };
    this.lookout = new LookoutLight(hasNote(courseNotes(lang), notes, ANSWER_NOTE));
    const d = visitors.door;
    this.door = typeof d === "object" ? { state: "key", key: keyAt(layout, d.key), help: d.help, guarded: false } : { state: d, key: null, help: null, guarded: false };
    this.lamps = new Lamps(layout, this.hill);
    this.pebbles = new Pebbles(layout, reducedMotion, () => this.door.state === "open", (l) => this.landed(l));
    this.clocks = new Clocks(layout, visitors.toys.day, BED_H, reducedMotion, (i) => this.hooks.sneeze(i));
    if (this.door.state === "open") this.opened();
    this.shed = new ShedWall(layout, visitors.notes);
    this.stileNotes = this.stileSpot && visitors.stile ? new StileNotes(this.stileSpot, visitors.stile) : null;
    // The diary lies on the hill's top: there is none without the hill.
    this.diary = this.hill && visitors.diary ? new Diary(visitors.diary) : null;
    this.mouse = new MouseMat(layout, visitors.mouseDoor);
    this.things = {
      door: this.door,
      gate: { x: layout.gate.x, z: layout.bounds.maxZ },
      bench: this.bench,
      lanterns: this.lamps,
      // No diary yet: the stool is there, with no book on it.
      lookout: this.hill ? { hill: this.hill, pages: this.diary?.pages ?? [] } : null,
      plants: layout.plants,
      carry: this.pebbles,
      toys: this.clocks,
      hiders: guests,
      mat: this.mouse,
      // Null: no shed note in view; then the one at the stile's foot, if you stand there.
      note: (x, z, yaw, pitch, slack) => this.shed.reachAt(x, z, yaw, pitch, EYE, slack) ?? (this.stileNotes?.inReach(x, z, slack) ? this.stileNotes.unopened() : null),
    };
  }

  /** The help the world gives for a key left waiting (#334), while it still lies in the garden. */
  private get keyHelp(): KeyHelp | null {
    return this.door.state === "key" ? this.door.help : null;
  }

  /**
   * Once the visitors are placed for the day: a key left waiting a few days (#334) has the dog, if it is here today,
   * sitting by it from the start (#802; at dusk and night the bird too, birdByKey). While the last note waits unread
   * (#882), the cat, if it is here today, sits by the open mouse door and looks in.
   */
  placeWaiting() {
    const key = this.door.key;
    if (this.keyHelp?.visitors && key && this.guests.has("dog")) {
      this.guests.place("dog", besideKey(this.layout, key, "dog"), key);
      this.door.guarded = true;
    }
    if (this.mouse.note?.unread && this.guests.has("cat")) {
      const by = this.mouse.besideMouseDoor();
      this.guests.place("cat", by.at, by.looks);
    }
  }

  /** The walk is drawn: from now on a visitor sent somewhere goes there in its own way (#802). */
  start() {
    this.started = true;
  }

  /**
   * One frame of the game, `dt` seconds long, with the keys or stick held now: the walker walks (or a walk to a
   * tapped spot goes on), time runs on the bench, the pebbles fly, the clocks' seeds drift, a tag past its time
   * goes, and the action button learns what is in reach.
   */
  step(dt: number, input: W.Input) {
    this.elapsed += dt;
    const was = this.me.mode;
    const end = W.step(this.me, input, dt, this.world);
    if (this.me.mode !== was) this.walkerWent(was);
    if (end?.end === "arrived") end.then?.();
    else if (end) {
      // Once per walk in the garden: a broken way is worth one report, not one a tap.
      if (!this.stallReported) this.hooks.stall();
      this.stallReported = true;
    }
    this.onBench(dt);
    this.pebbles.step(dt);
    this.clocks.step(this.elapsed);
    if (this.lookout.answering(this.elapsed)) this.showLine(ANSWER_LINE[this.lang], null, ANSWER_SPOKEN);
    const t = this.elapsed;
    if (this.sceneryTap && t > this.sceneryTap.until) this.sceneryTap = null;
    if (this.line && t > this.line.until) this.line = null;
    if (this.treeTap && t > this.treeTap.until) this.treeTap = null;
    if (this.fruitTap && t > this.fruitTap.until) this.fruitTap = null;
    if (this.echoTap && t > this.echoTap.until) this.echoTap = null;
    this.reportReach();
  }

  /** The action button (#334), pressed while it said `a`: do what reachCore.ts's press says. */
  act(a: R.Reach) {
    const o = R.press(a, this.offer, this.me);
    if (!o) return;
    switch (o.on) {
      case "seat":
        return o.target === null ? this.standUp() : this.toggleLantern(o.target);
      case "key":
      case "door":
        return this.doorAct(o.a);
      case "carry":
        if (o.a === "throw") this.throwAhead();
        // Every other carry act has a target (Pebbles.reachAt).
        else if (o.target) this.doCarry(o.target);
        return;
      case "hider":
        return this.seek(o.target);
      case "mat":
      case "note":
        return this.openNote(o.target);
      case "stool":
        return this.sit("stool");
      case "diary":
        return this.openDiary();
      case "lantern":
        return this.toggleLantern(o.target);
      case "bench":
        return this.sit("bench");
      case "toy":
        return this.doToy(o.target);
      case "plant":
        return this.shakeNow(o.target);
      default:
        return o satisfies never;
    }
  }

  /** A tap on a lantern (#361): blow it out or light it in reach; from farther away, walk up to it first. */
  tapLantern(i: number) {
    const [x, , z] = this.lamps.at[i];
    if (Math.hypot(x - this.me.x, z - this.me.z) < R.LANTERN_REACH) return this.toggleLantern(i);
    this.goTo(x, z, R.LANTERN_REACH - 0.4, () => this.toggleLantern(i));
  }

  /** Blow lantern `i` out, or light it again; the moth, the stars and the fireflies answer. The lookout's, lit again, is a signal to the far light (#858). */
  private toggleLantern(i: number) {
    const relit = this.lamps.toggle(i);
    this.hooks.lantern(i);
    if (i === this.lamps.lookout) {
      if (relit) this.lookout.signal(this.elapsed);
      return;
    }
    // The moth knows the garden's lanterns only, the lookout's last.
    this.guests.lanternsLit(this.lamps.on.slice(0, this.lamps.spots.length));
    this.nightSky();
  }

  /** Every lantern out: the stars come out over the hills and the fireflies glow brighter (#361); otherwise they go back. */
  private nightSky() {
    this.hooks.stars(this.lamps.allOut);
  }

  /** A long press on a plant (#357): shake it where it stands when its name shows; from farther away, walk to it first. */
  shake(p: PlacedPlant) {
    if (Math.hypot(p.x - this.me.x, p.z - this.me.z) < NAME_NEAR) return this.shakeNow(p);
    const v = viewpoint(this.layout, p);
    this.goTo(v.x, v.z, 0, () => this.shakeNow(p));
  }

  private shakeNow(p: PlacedPlant) {
    this.hooks.shake(p, petalForms(p.lemma, p.forms));
  }

  /** A tap on a loose thing, the well, the water or the ground in reach (#358): act on it in reach; from farther away, walk up to it first. */
  tapCarry(t: CarryTarget) {
    const at = this.pebbles.standFor(t, this.me.x, this.me.z);
    if (at.near) return this.doCarry(t);
    this.goTo(at.x, at.z, CARRY_STAND, () => this.doCarry(t));
  }

  /** Pick up a loose thing; throw what you hold in the water, put it down on the ground, or drop it in the well. Anything that no longer applies does nothing. */
  private doCarry(t: CarryTarget) {
    const c = this.pebbles;
    if (t.at === "thing") {
      if (!c.lift(t.i)) return;
      this.hooks.hand(true);
      this.hooks.carry({ did: "lift" });
      return;
    }
    const at = t.at === "well" ? this.layout.well : t;
    if (!c.letGo(this.me.x, this.me.z, at.x, at.z, t.at === "water")) return;
    this.hooks.hand(false);
    this.hooks.carry({ did: t.at === "water" ? "throw" : t.at === "well" ? "well" : "put" });
  }

  /** The action button's throw (#358): what you hold flies a few steps ahead, where you face. */
  private throwAhead() {
    const to = aimAt(this.me.x, this.me.z, this.me.yaw);
    if (!this.pebbles.letGo(this.me.x, this.me.z, to.x, to.z, true)) return;
    this.hooks.hand(false);
    this.hooks.carry({ did: "throw" });
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
      if (best) this.hooks.nod(best);
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
    this.hooks.carry({ did: "land", said: more ? `${l.said} ${more}` : l.said });
  }

  /** A tap on a dandelion clock (#360): blow it in reach; from farther away, walk up to it first. */
  tapToy(i: number) {
    const at = this.clocks.standFor(i, this.me.x, this.me.z);
    const t: ToyTarget = { at: "clock", i };
    if (at.near) return this.doToy(t);
    this.goTo(at.x, at.z, TOY_STAND, () => this.doToy(t));
  }

  /** Blow a clock: one blown already does nothing. */
  private doToy(t: ToyTarget) {
    if (this.clocks.blow(t.i, this.elapsed)) this.hooks.toy({ did: "blow" });
  }

  /**
   * Sit on the bench, facing the pond, or on the lookout's stool (#858),
   * facing the far house: a cut to the seat, and the eye sinks (at once, with
   * reduced motion). Any move stands you up.
   */
  private sit(on: W.Seat) {
    this.walkerWent(W.sit(this.me, on, this.world));
  }

  /** Stand up, if you sat (the action button). */
  private standUp() {
    if (this.me.mode.kind === "seated") this.toWalker(W.FREE);
  }

  /** Change what the walker is doing (#877, walker.ts toMode), and show it. */
  private toWalker(next: W.Mode) {
    this.walkerWent(W.toMode(this.me, next, this.world));
  }

  /** What the game does when walker.ts has changed the walker's mode: for leaving `was`, and for entering the one it is in now. */
  private walkerWent(was: W.Mode) {
    this.leaveWalker(was);
    this.enterWalker(this.me.mode);
  }

  private leaveWalker(was: W.Mode) {
    switch (was.kind) {
      case "free":
      case "glide":
        return;
      case "trip":
        this.hooks.trip(null);
        return;
      case "seated":
        return this.leaveSeat();
      default:
        return was satisfies never;
    }
  }

  private enterWalker(next: W.Mode) {
    switch (next.kind) {
      case "free":
      case "glide":
      // goTo shows where the walk goes.
      case "trip":
        return;
      case "seated":
        this.sitOn = next.on;
        this.sat = 0;
        this.seatView = { yaw: this.me.yaw, pitch: this.me.pitch, looked: false };
        return;
      default:
        return next satisfies never;
    }
  }

  /** Stand up (any move does): who came to sit with you goes back to their own places, and time runs back to now (#362). */
  private leaveSeat() {
    this.turnTo = null;
    this.gnomeSays = null;
    for (const id of this.come) this.guests.visit(id, null);
    const bird = this.come.has("bird");
    this.come.clear();
    this.onWay.clear();
    // The bird may have been waiting by a key before it came.
    if (bird) this.birdByKey();
    this.hooks.company(null);
  }

  /**
   * One frame of sitting on the bench (#362): time speeds up after a while
   * (bench.ts), and visitors here today come to sit with you: you can watch
   * each one come (#802). The head turns to whoever came (not with reduced
   * motion, nor once you have looked round yourself). Standing up, time runs
   * back to the time chosen.
   */
  private onBench(dt: number) {
    let race = 0;
    const w = this.me.mode;
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
      this.hooks.blend(null, 0);
      return this.showTime(this.time);
    }
    this.lapsing = true;
    const look = lapseLook(this.time, this.lapse, this.lapseNow);
    // What is lit or awake changes half way; the sky, the light and the fog fade.
    const now = look.k < 0.5 ? look.from : look.to;
    if (now !== this.shown) this.showTime(now);
    this.hooks.blend(look, race);
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
      this.me.yaw = v.yaw + (t.yaw - v.yaw) * w;
      this.me.pitch = v.pitch + (t.pitch - v.pitch) * w;
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
    this.hooks.company(who);
    const turn = !this.world.reducedMotion && !this.seatView.looked;
    if (who === "gnome") this.gnomeSays = this.sat + (turn ? GLANCE.turn : 0);
    if (!turn) return;
    // Forward is -z at yaw 0; turn the short way round. Look at its middle, a little above where it sits.
    const v = this.seatView;
    const { x, z } = this.me;
    let yaw = Math.atan2(-(at[0] - x), -(at[2] - z));
    yaw -= Math.round((yaw - v.yaw) / (Math.PI * 2)) * Math.PI * 2;
    const pitch = Math.max(-0.75, Math.atan2(at[1] + 0.2 - W.SEAT.eye, Math.hypot(at[0] - x, at[2] - z)));
    this.turnTo = { yaw, pitch, at: this.sat };
  }

  /** A tap on the key or the door (#336): act on it in reach; from farther away, walk up to it first. */
  tapDoor(a: R.DoorAction) {
    if (R.doorInReach(this.things, this.me.x, this.me.z, a, 0)) return this.doorAct(a);
    const k = this.door.key;
    if (a === "key" && k) this.goTo(k.x, k.z, KEY_STAND, () => this.doorAct(a));
    else this.goTo(this.layout.gate.x, this.layout.bounds.maxZ - DOOR_STAND, 0, () => this.doorAct(a));
  }

  /** Try the door, pick up the key, or open the door with it: from a tap in reach, or the door's button. Anything else no longer applies and does nothing. */
  doorAct(a: R.DoorAction) {
    const d = this.door;
    const L = this.layout;
    if (a === "key" && d.state === "key" && d.key) {
      d.state = "held";
      this.hooks.keyTaken();
      // Whoever waited by it goes home.
      this.guests.visit("dog", null);
      this.guests.visit("bird", null);
      this.showLine(DOOR_LINES[this.lang].found, [d.key.x, 0.15, d.key.z], DOOR_SPOKEN.found);
    } else if (a === "open" && d.state === "held") {
      d.state = "open";
      this.opened();
      this.hooks.doorOpen();
      this.clearTaps({ line: true });
    } else if (a === "try" && d.state !== "open") this.showLine(DOOR_LINES[this.lang].locked, [L.gate.x, 1.5, L.bounds.maxZ + HEDGE.gap], DOOR_SPOKEN.locked);
  }

  /** The door is open: the orchard's trees stand behind it, and the well among them takes pebbles. */
  private opened() {
    this.trunks = placeTrees(this.layout.orchard, this.visitors.orchard.trees);
    this.pebbles.wellShown = true;
  }

  /** Show a quiet line over a point (null: over no point) for a few seconds. One tag at a time: a tapped scenery or visitor tag goes. */
  showLine(text: string, at: [number, number, number] | null, spoken?: string) {
    // A line over no point rises and fades as the well's echo does (GardenWalk, kind "far"), over the echo's time.
    this.line = { text, spoken, at, until: this.elapsed + (at ? 4 : ECHO.show) };
    this.clearTaps({ scenery: true, tree: true, visitor: true, fruit: true });
  }

  /**
   * A scenery word, an orchard tree, the door's quiet line, a fallen fruit's
   * word (#359) and a visitor's tag take turns showing: setting one clears
   * whichever of the rest is named here. One place for the rule.
   */
  private clearTaps(which: { scenery?: boolean; tree?: boolean; line?: boolean; visitor?: boolean; fruit?: boolean }) {
    if (which.scenery) this.sceneryTap = null;
    if (which.tree) this.treeTap = null;
    if (which.line) this.line = null;
    if (which.visitor) this.guests.untap();
    if (which.fruit) this.fruitTap = null;
  }

  /**
   * A tap on a note: open it from in front of the shed, by the stile's foot (#714), by the diary's stone (#858),
   * or by the mouse door's mat (#882); from farther away, walk up to it first. `halfTan`: how wide the view is
   * (the aspect times the tangent of half the field of view), so a walk to the shed stops where the note is in it.
   */
  tapNote(id: string, halfTan: number) {
    const { x, z } = this.me;
    if (this.mouse.has(id)) {
      if (this.mouse.noteInReach(x, z, 0)) return this.openNote(id);
      const at = this.mouse.standByNote();
      return this.goTo(at.x, at.z, 0, () => this.openNote(id));
    }
    const look = this.things.lookout;
    // The diary is only ever on the hill (constructor): `look` is there with it.
    if (this.diary?.has(id) && look) {
      if (R.byDiary(look, x, z, 0)) return this.openDiary();
      const [sx, sz] = look.hill.stone;
      return this.goTo(sx, sz, DIARY_REACH - 0.3, () => this.openDiary());
    }
    if (this.stileNotes?.has(id)) {
      if (this.stileNotes.inReach(x, z, 0)) return this.openNote(id);
      const [fx, fz] = stileAt(this.layout).foot;
      return this.goTo(fx, fz, 0, () => this.openNote(id));
    }
    if (this.shed.inFront(x, z, 0)) return this.openNote(id);
    const at = this.shed.standAt(id, halfTan);
    this.goTo(at.x, at.z, 0, () => this.openNote(id));
  }

  /** Open note `id` on its card; where it lies, it is a read one from now on. */
  private openNote(id: string) {
    if (this.stileNotes?.has(id)) {
      this.stileNotes.read(id);
      this.hooks.read("stile", id);
    } else if (this.mouse.has(id)) {
      this.mouse.read();
      this.hooks.read("mat", id);
    } else {
      this.shed.read(id);
      this.hooks.read("shed", id);
    }
    this.hooks.open(id);
  }

  /** Open the diary (#858) on its oldest unread page, or its last. */
  private openDiary() {
    // The button and a tap offer the diary only while there is one.
    const id = this.diary!.page();
    this.readDiary(id);
    this.hooks.open(id);
  }

  /** Diary page `id` was read, opened or turned to: the ribbon goes once every page is read. */
  readDiary(id: string) {
    // The diary's card shows only while there is a diary.
    this.diary!.read(id);
    this.hooks.read("diary", id);
  }

  /** Show a tree's word and meaning over it for a few seconds (after a tap). One tag at a time. */
  tapTree(tree: PlacedTree) {
    this.treeTap = { tree, until: this.elapsed + 4 };
    this.clearTaps({ scenery: true, line: true, visitor: true, fruit: true });
  }

  /** A fruit fell from an orchard tree walked into (#359): its word shows over it as it rolls. */
  fruitFell(tree: PlacedTree, at: Readonly<Rolling>) {
    this.fruitTap = { tree, at, until: this.elapsed + 4 };
    this.clearTaps({ scenery: true, tree: true, line: true, visitor: true });
  }

  /** The action button finds a hiding visitor (#379), as a tap on it would. */
  private seek(id: VisitorId) {
    this.guests.find(id);
    this.clearTaps({ scenery: true, tree: true, line: true, fruit: true });
  }

  /** A visitor was tapped (sceneVisitors.ts answers it): a tag it said clears the quiet line; its own tag clears the rest. */
  visitorTapped(said: unknown) {
    this.clearTaps(said === null ? { scenery: true, tree: true, line: true, fruit: true } : { line: true });
  }

  /** A visitor says something in a small bubble for a few seconds (the frog answering a splash, #358). */
  private say(id: VisitorId, text: string) {
    this.guests.say(id, text);
    this.clearTaps({ line: true });
  }

  /** Show a scenery word's tag for a few seconds (after a tap), long enough to read its thought slowly when it has one (#864). One tag at a time: a visitor's tapped tag goes. */
  tapScenery(s: { view: SceneryView; hit: SceneryHit }) {
    this.sceneryTap = { ...s, until: this.elapsed + (s.view.thought ? SCENERY_TAG.thought : SCENERY_TAG.word) };
    this.clearTaps({ tree: true, line: true, visitor: true, fruit: true });
  }

  /** Choose a time of day (the clock, or the button). */
  setTime(t: TimeOfDay) {
    this.time = t;
    // Time sped up on the bench (#362) runs on from the time chosen now.
    this.lapse = 0;
    this.lapsing = false;
    this.hooks.blend(null, 0);
    this.showTime(t);
  }

  /** Show a time of day: what is lit, who is awake. The one chosen, or one on the way while time speeds up on the bench (#362). */
  private showTime(t: TimeOfDay) {
    this.shown = t;
    this.lamps.dark = conditions(t).dark;
    this.hooks.time(t);
    this.nightSky();
    this.birdByKey();
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

  /** Look round by (dx, dy) radians. */
  look(dx: number, dy: number) {
    this.lookedRound();
    W.look(this.me, dx, dy, this.world);
  }

  /** The viewer looks where they like now (walker.ts does the walk's part): on the bench (#362), the head no longer turns to who comes. */
  private lookedRound() {
    this.seatView.looked = true;
    this.turnTo = null;
  }

  /** Walk straight ahead (or back, if negative) by `metres`. */
  stepAhead(metres: number) {
    this.walkerWent(W.stepAhead(this.me, metres, this.world));
  }

  turn(amount: number) {
    this.lookedRound();
    W.turn(this.me, amount, this.world);
  }

  /** Walk to open ground (#336, a tap on it). */
  walkTo(x: number, z: number) {
    this.goTo(x, z, 0, null);
  }

  /** A tap on a plant (#336): its card opens where you stand when its name shows; from farther away, you walk to it first. */
  tapPlant(p: PlacedPlant) {
    if (Math.hypot(p.x - this.me.x, p.z - this.me.z) < NAME_NEAR) {
      // A walk or a glide under way stops: the viewer is looking at this plant now (#876). On a seat, you stay sitting.
      if (this.me.mode.kind !== "seated") this.toWalker(W.FREE);
      return this.select(p);
    }
    this.select(null);
    const v = viewpoint(this.layout, p);
    // On arrival, the short glide that faces the plant, as Next plant does, and its card.
    this.goTo(v.x, v.z, 0, () => this.select(p, true));
  }

  /** Walk round whatever is in the way to (x, z), or as near as a walker may stand, then stop `stop` m short and do `then`. */
  private goTo(x: number, z: number, stop: number, then: (() => void) | null) {
    const { was, to } = W.startTrip(this.me, x, z, stop, then, this.world);
    this.walkerWent(was);
    // The ring goes where the walk goes.
    this.hooks.trip(to);
  }

  /** Choose plant `p` (its card opens), or none; `walkTo`: glide to where it is seen best, facing it (Next plant). */
  select(p: PlacedPlant | null, walkTo = false) {
    this.selected = p;
    if (p) this.clearTaps({ scenery: true, tree: true, fruit: true });
    if (p && walkTo) {
      const v = viewpoint(this.layout, p);
      // Look at the flower head, not the stem, so the view stays nearly level
      // and the plant sits above the card at the bottom of the screen.
      const pitch = Math.max(-0.18, Math.min(0.05, Math.atan2(this.hooks.plantTop(p) - EYE, Math.hypot(p.x - v.x, p.z - v.z))));
      this.walkerWent(W.glideTo(this.me, v.x, v.z, v.yaw, pitch, this.world));
    }
    this.hooks.select(p);
  }

  /**
   * Tell whoever shows the game what the action button does now (#334): what
   * reachCore.ts offers from where the walker stands. With nothing in reach,
   * no button (#835): when it shows, it has something to do.
   */
  private reportReach() {
    const got = R.offerAt(this.me, this.things, this.offer);
    if (R.same(got, this.offer)) return;
    this.offer = got;
    this.hooks.reach(got);
  }
}
