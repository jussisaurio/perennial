// The garden you can walk in. Every word you have started is a plant in a
// raised bed; walk the paths, read the names, click a plant to hear it.
// The three.js scene loads only when this screen opens. The plants come from
// garden/plants.ts, shared with the 2D garden, so a word looks the same in both.

import "@fontsource/pixelify-sans/500.css";
import "@fontsource/pixelify-sans/700.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { language } from "../content/languages";
import type { LoadedDeck } from "../data/deck";
import { openDoor, saveLeft, useLearner, useStore } from "../data/learner";
import { chunkLabel, nextChunk } from "../data/practice";
import { track } from "../observability";
import { DOOR_LINES, groupOf, keyHelp, keySpot, type KeySpot, type PlacedPlant } from "../garden/world";
import { plantMood, plantsFromLearner, showcasePlants, stageSentence, THIRSTY, type PlantSource } from "../garden/plants";
import type { Detail, DoorState, Label, Reach, TimeOfDay, WalkIntoEvent } from "../garden/scene";
import type { TapHit } from "../garden/scenePart";
import type { Hider } from "../garden/sceneVisitors";
import type { Hideout } from "../garden/kinds/kind";
import { EMPTY_WALK, loadingLine, plantLine } from "../content/voice";
import { snoreLine } from "../garden/whimsy";
import { takeFocus, type Focus } from "./gardenFocus";
import { WordPlant } from "./plant";
import { speak, speakAll } from "./speech";
import { SoundToggle, useSound } from "./Sound";
import { plural } from "./format";
import { useNow } from "./useNow";
import { useGardenScene, useWalkInput } from "./useGardenScene";
import { dayNumber } from "../core/day";
import { boatWord, gardenBroughtAt, learnerLeave, learnerVisitors, showcaseLeave, type LearnerVisitors } from "./visitors";
import { FINDS, type Left, type LeaveWalk } from "../garden/leave";
import { CRUMB_BAG, FIND_ART, fruitArt } from "../garden/leaveArt";
import type { PixelArt } from "../garden/visitorArt";
import type { LeaveAct, LeaveDone } from "../garden/sceneLeave";
import type { CarryAct, CarryDone, Held } from "../garden/sceneCarry";
import { LOOSE_ART } from "../garden/carryArt";
import type { ToyAct, ToyDone } from "../garden/sceneToys";
import type { ToysWalk } from "../garden/toys";
import { inLang, nounView } from "../garden/nouns";
import { GNOME_WORD, type Companion } from "../garden/bench";
import { PixelRects } from "./pixel";
import { brushNote, wakeAudio, whistle } from "./chime";
import { fellLine } from "../garden/walkInto";
import type { Gender } from "../deck/schema";

/** A plant just shaken (#357): its word and the forms that fell from it ([]: one leaf). */
type Shook = { lemma: string; forms: string[] };
/** Hide-and-seek (#379): something hiding in reach of the action button, and what the button just found. */
type Seek = { near: Hider | null; found: Hider | null };

/** Where a visitor hid (#379): "under the bench", or "behind" and its word, said in the course language. */
function Where({ where, lang }: { where: Hideout; lang: string }) {
  return where.word === null ? (
    <>{where.text}</>
  ) : (
    <>
      {where.text} <span lang={lang}>{where.word}</span>
    </>
  );
}

/**
 * What the walk's status says to a screen reader: who just came to sit with
 * them on the bench (#362); the key at their feet; a toy's doing (#360); a
 * find's word and meaning (#351); a fruit that fell from a tree they walked
 * into, and its word (#359); the well's echo, an old word and the day it
 * was met (#335 S6); the prints from the bowl, or something at their
 * feet; something small hiding near them, or what they just found hiding
 * (#379); what fell from a shaken plant (#357); who answered a call (#377); the door's line; a lantern that
 * is out, and the stars once every one is (#361); what a thrown thing did
 * where it landed (#358); what they hold. Things in the world, never
 * instructions (#334).
 */
function spokenStatus(reach: Reach | null, labels: readonly Label[], state: DoorState, held: HandView | null, shook: Shook | null, called: string[] | null, company: Companion | null, landed: string | null, toy: ToyDone | null, seek: Seek, lang: string, stars: boolean): ReactNode {
  if (company) return COMPANY_LINE[company](lang);
  if (reach === "key") return "The key is here.";
  // What a toy just did (#360), for a few seconds.
  if (toy?.did === "blow") return "The seeds fly away on the wind.";
  if (toy?.did === "fold")
    return (
      <>
        A paper boat with <span lang={lang}>{toy.word.lemma}</span> on it floats out on the pond.
      </>
    );
  // It never says what hides, only that something small does: the button finds it.
  if (seek.near)
    return (
      <>
        Something small is <Where where={seek.near.where} lang={lang} />.
      </>
    );
  if (seek.found)
    return (
      <>
        You found the {seek.found.gloss}. It was <Where where={seek.found.where} lang={lang} />.
      </>
    );
  // The course-language word is marked as such, so a screen reader says it in that language.
  const found = labels.find((l) => l.kind === "find");
  if (found)
    return (
      <>
        You found <span lang={lang}>{found.text}</span>: {found.gloss}.
      </>
    );
  const fell = labels.find((l) => l.kind === "fruit");
  // A fruit's tag always carries its kind in English as its meaning (scene.ts labels).
  if (fell)
    return (
      <>
        {fellLine(fell.gloss!)} <span lang={lang}>{fell.text}</span>
      </>
    );
  const echoed = labels.find((l) => l.kind === "echo");
  // The echo's gloss is the day the word was met (scene.ts labels).
  if (echoed)
    return (
      <>
        An echo from the well: {echoed.gloss}: <span lang={lang}>{echoed.text}</span>.
      </>
    );
  if (reach === "follow") return "Small prints lead away from the bowl.";
  if (reach === "find") return "Something lies here.";
  if (shook)
    return shook.forms.length ? (
      <>
        <span lang={lang}>{shook.lemma}</span> shakes. Petals fall: <span lang={lang}>{shook.forms.join(", ")}</span>.
      </>
    ) : (
      <>
        <span lang={lang}>{shook.lemma}</span> shakes. One leaf falls.
      </>
    );
  if (called) return called.length ? called.join(" ") : "Only the wind answers.";
  const line = spokenLine(labels.find((l) => l.kind === "line")?.text, state);
  if (!line && reach === "light") return stars ? "Every lantern is out. Stars shine over the hills." : "This lantern is out.";
  if (line) return line;
  // Nothing held: what the last thing thrown or put down did, if anything.
  if (!held) return landed;
  return <>You hold {held.word ? <span lang={lang}>{held.name}</span> : held.name}.</>;
}

/** The door's line as a screen reader hears it: the locked line also says where this learner's key lies, once there is one. */
function spokenLine(line: string | undefined, state: DoorState): string | undefined {
  return line === DOOR_LINES.locked && typeof state === "object" ? `${line} ${KEY_PLACE[state.key]}` : line;
}

/** Who came to sit with you on the bench (#362), as a screen reader hears it. The gnome's word is in the course language. */
const COMPANY_LINE: Record<Companion, (lang: string) => ReactNode> = {
  bird: () => "A bird lands on the back of the bench.",
  cat: () => "The cat sits beside you.",
  gnome: (lang) => (
    <>
      The gnome comes over. It says: <span lang={lang}>{inLang(GNOME_WORD, lang)}</span>
    </>
  ),
};

/** What the learner did in the walk, for counting (#335): what a tap met (TapHit kinds), what the action button did (#334), what they left or found (#351), what they walked into (#359), or did with a loose thing (#358). */
type GardenVerb = TapHit["kind"] | Reach | WalkIntoEvent["did"] | Exclude<CarryDone["did"], "land">;

/** The landing page's walk: the same words, at the same stages, as its strip, without seeds to water (it is view-only). */
export function showcaseWalkPlants(deck: LoadedDeck, count = 160): PlantSource {
  return { ...showcasePlants(deck, count), seeds: 0 };
}

/** The walk-in garden for the signed-in learner. */
export function LearnerGardenWalk({ lang, onExit, onWater }: { lang: string; onExit: () => void; onWater: (minutes: number) => void }) {
  const [focus] = useState(takeFocus);
  // `from: "today"`: opened by the picture of what waits in Today's strip (#335), to see how often that way in is used.
  useEffect(() => track("garden_opened", focus?.at === "bowl" ? { from: "today" } : {}), [focus]);
  // What the learner does in the walk (#335): how many taps of each kind (walk, plant, door...) and presses of the
  // action button by what it did (sit, key...), one event per kind,
  // sent when the walk closes, or when the page is hidden: on a phone the walk is often left by locking it, not closed.
  // Kinds and counts only: no places, no words.
  const taps = useRef(new Map<GardenVerb, number>());
  useEffect(() => {
    const send = () => {
      for (const [verb, count] of taps.current) track("garden_action", { verb, count });
      taps.current.clear();
    };
    const hidden = () => document.visibilityState === "hidden" && send();
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      send();
    };
  }, []);
  // `?? 0`: the first tap of its kind this visit.
  const onTap = (verb: GardenVerb) => taps.current.set(verb, (taps.current.get(verb) ?? 0) + 1);
  const learner = useLearner(lang);
  // The learner's own garden: the same plants as the 2D garden.
  const source = useMemo(() => (learner ? plantsFromLearner(learner) : null), [learner]);
  const visitors = useMemo(() => (learner ? learnerVisitors(learner) : null), [learner]);
  const store = useStore();
  const now = useNow();
  // The door in the hedge (#315): open for good once opened; until then the key hides in the garden once "key" brought it,
  // always in the same place for this learner and course, and the world helps once it has waited a few days (#334).
  // Until the learner loads there is no garden to walk (`source` is null), so "locked" is never shown then.
  // door_open is missing from course rows Electric streams before its first course change after the migration: closed, as it was.
  // The help is for today (`now`); the walk takes its snapshot as it opens.
  const door = useMemo(() => {
    const since = learner ? gardenBroughtAt(learner, "key") : null;
    const state: DoorState = !learner
      ? "locked"
      : learner.course.door_open
        ? "open"
        : since !== null
          ? { key: keySpot(`${learner.course.user_id}:${lang}`), help: keyHelp(since, now) }
          : "locked";
    // A write the server refuses is told by the refused-writes notice (#253); this walk keeps its door open.
    return { state, open: () => void openDoor(store, lang).catch((e) => console.error("door not saved", e)) };
  }, [learner, store, lang, now]);
  // Leave it out (#351): the bowl and the shelf, worked out once, when the walk first has its learner: the walk is a snapshot of
  // the day it opens. A walk on a day after the night fixes what came, until it is found: saved at once, once per walk. Not again
  // when the learner changes (a refused write rolls back and would save it again, for ever) or at midnight (it would fix a day
  // the walk does not show). A write the server refuses is told by the refused-writes notice (#253), as for the door.
  const [leaveOpened, setLeaveOpened] = useState<{ walk: LeaveWalk; walkedNow: boolean } | null>(null);
  // Set while rendering (React's way to keep state from a prop's first value): the walk's snapshot never sees it missing.
  if (learner && !leaveOpened) setLeaveOpened(learnerLeave(learner, now, dayToday));
  const saveLeftHere = useMemo(() => (left: Left) => void saveLeft(store, lang, left).catch((e) => console.error("garden not saved", e)), [store, lang]);
  // Effects can run twice (React's strict mode), and this must be one write.
  const walkSaved = useRef(false);
  useEffect(() => {
    if (!leaveOpened?.walkedNow || walkSaved.current) return;
    walkSaved.current = true;
    saveLeftHere(leaveOpened.walk.left);
  }, [leaveOpened, saveLeftHere]);
  const leave = useMemo(() => leaveOpened && { walk: leaveOpened.walk, save: saveLeftHere }, [leaveOpened, saveLeftHere]);
  // The toys (#360), worked out once, when the walk first has its learner, like the bowl: the day's wind and clocks, and the boat's word.
  const [toys, setToys] = useState<ToysWalk | null>(null);
  if (learner && !toys) setToys({ day: dayNumber(now), boat: boatWord(learner, now) });
  // Watering is today's practice: the rest of today's 5 minutes, or 5 more once they are done,
  // named as Today names it, and worked out with the clock, so a walk open past midnight starts the new day.
  // Until the learner loads there are no plants (`source` is null), so nothing to water either.
  const chunk = learner ? nextChunk(learner, now) : null;
  const water = learner && chunk ? { label: chunk.state === "finish" ? `${chunkLabel(chunk)} · ${chunk.minutes} min` : chunkLabel(chunk), start: () => onWater(nextChunk(learner).minutes) } : undefined;
  const [hint] = useState(() => ({ show: !hintSeen(), moved: markHintSeen }));
  return <GardenWalk lang={lang} source={source} visitors={visitors} door={door} leave={leave ?? undefined} toys={toys ?? undefined} onExit={onExit} water={water} focus={focus} onTap={onTap} hint={hint} />;
}

function initialTime(): TimeOfDay {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? "day" : h >= 18 && h < 21 ? "dusk" : "night";
}

const DETAIL_LABEL: Record<Detail, string> = { normal: "Normal quality", low: "Low quality" };
const QUALITY_KEY = "garden-quality";

/** The quality the viewer chose, or null if they never chose (then we may pick for them). */
function savedDetail(): Detail | null {
  try {
    const d = localStorage.getItem(QUALITY_KEY);
    if (d === "normal" || d === "low") return d;
  } catch {
    // Storage can be blocked; the default is fine.
  }
  return null;
}

const TIME_LABEL: Record<TimeOfDay, string> = { day: "Day", dusk: "Evening", night: "Night" };
const NEXT_TIME: Record<TimeOfDay, TimeOfDay> = { day: "dusk", dusk: "night", night: "day" };

/**
 * The action button (#334) shows only an icon, which changes shape with what it
 * does: you find out by pressing it. A screen reader hears what it does, said
 * plainly: mystery must not lock anyone out.
 */
const REACH_NAME: Record<Reach, string> = {
  try: "Try the door",
  key: "Pick up the key",
  open: "Open the door with the key",
  sit: "Sit on the bench",
  stand: "Stand up",
  take: "Take from the basket",
  leave: "Put it in the bowl",
  follow: "Follow the prints",
  find: "Pick it up",
  hang: "Hang it on the shelf",
  unhang: "Take from the shelf",
  shake: "Shake the plant",
  "lift-pebble": "Pick up the pebble",
  "lift-stick": "Pick up the stick",
  throw: "Throw it",
  stack: "Put it on the stones",
  blow: "Blow the dandelion",
  fold: "Fold a boat",
  snuff: "Blow out the lantern",
  light: "Light the lantern",
  call: "Call",
  well: "Drop it in the well",
  seek: "Found you",
};
/** An open hand, in pixels: try the door, pick up the key. */
const HAND = ["....#.....", "..#.#.#...", "..#.#.#...", "..#.#.#.#.", "..#.#.#.#.", "#.#######.", "##########", ".#########", "..#######.", "...#####..", "...#####.."];
const REACH_ICON: Record<Reach, readonly string[]> = {
  try: HAND,
  key: HAND,
  open: ["..###.......", ".#...#......", ".#...#######", ".#...#..#.#.", "..###...#.#."],
  sit: ["#.......", "#.......", "#.......", "########", "#......#", "#......#"],
  stand: ["...#...", "..###..", ".#####.", "#######", "..###..", "..###..", "..###.."],
  take: HAND,
  find: HAND,
  unhang: HAND,
  // A bowl.
  leave: ["#........#", "##########", ".########.", "..######.."],
  // Prints, one after the other.
  follow: ["......#.#.", ".......#..", "..........", "..#.#.....", "...#......", "......#.#.", ".......#..", "..#.#.....", "...#......"],
  // A small plant, shaking.
  shake: [".#..#..#.", "#..###..#", ".#.#.#.#.", "#...#...#", "....#....", "..#####..", "...###..."],
  // A hook.
  hang: ["..##..", ".#..#.", ".....#", "....#.", "...#..", "...#..", "#..#..", ".##..."],
  "lift-pebble": HAND,
  "lift-stick": HAND,
  // An arc, coming down.
  throw: ["..######....", ".#......#...", "#........#..", "#........#..", "#......#####", "#.......###.", "#........#.."],
  // Three stones, one on another.
  stack: ["...##...", "..####..", "........", ".######.", "........", "########", "########"],
  // A dandelion clock, on its stem.
  blow: ["..#.#.#..", ".#.###.#.", "..#####..", "#.#####.#", "..#####..", ".#.###.#.", "..#.#.#..", "....#....", "....#....", "....#...."],
  // A paper boat.
  fold: [".....#.....", "....###....", "...#####...", "..#######..", "###########", ".#########.", "..#######.."],
  // Puffs of air at a small flame.
  snuff: ["..........#.", "####......##", ".........###", "#####....###", ".........###", "####......#."],
  // A flame.
  light: ["...#...", "...##..", "..###..", ".#####.", ".#####.", "#######", "#######", ".#####.", "..###.."],
  // A whistle, and its sound.
  call: ["..........#..#", "...........#..", "######..####..", "#.....##....#.", "######.#....#.", ".......#....#.", "........####.."],
  // A stone, dropping into a well.
  well: ["....##....", "....##....", "..........", "....##....", "..........", "#........#", "#........#", "##########", "##########"],
  // An open eye: I see you.
  seek: ["...####...", ".##....##.", "#...##...#", "#..####..#", "#...##...#", ".##....##.", "...####..."],
};

/** Leave it out's actions (#351, sceneLeave.ts LeaveAct) and carry's (#358, sceneCarry.ts CarryAct): counted when done, not when pressed. */
const LEAVE_ACTS = new Set<Reach>(["take", "leave", "follow", "find", "hang", "unhang"] satisfies LeaveAct[]);
const CARRY_ACTS = new Set<Reach>(["lift-pebble", "lift-stick", "throw", "stack", "well"] satisfies CarryAct[]);
/** The toys' actions (#360, sceneToys.ts ToyAct). */
const TOY_ACTS = new Set<Reach>(["blow", "fold"] satisfies ToyAct[]);

/** What you hold (#351), drawn small by the action button, and said to screen readers. */
/** `word`: the name is a word in the course language. */
type HandView = { art: PixelArt; name: string; word: boolean };

function handView(h: Held, lang: string): HandView {
  if (h.from === "ground") return { art: LOOSE_ART[h.thing], name: `the ${h.thing}`, word: false };
  if (h.from === "shelf") {
    const v = nounView(FINDS[h.find], lang);
    // A course with no word for it says its meaning.
    return v.word ? { art: FIND_ART[h.find], name: v.word, word: true } : { art: FIND_ART[h.find], name: v.gloss, word: false };
  }
  const t = h.thing;
  return "kind" in t ? { art: fruitArt(t.kind), name: t.lemma, word: true } : { art: CRUMB_BAG, name: "the crumbs", word: false };
}

/** The landing page's walk: today's wind and dandelion clocks, and no boat (there are no words of its own to write on it). */
const showcaseToysNow = (): ToysWalk => ({ day: dayToday(), boat: null });

/** The landing page's walk: the bowl and the crumbs, and nothing saved. */
const showcaseLeaveNow = (): { walk: LeaveWalk; save: (left: Left) => void } => ({ walk: showcaseLeave(Date.now(), dayToday), save: () => {} });

/** Today's calendar day, read when it is asked: something left after midnight is left on the new day (#351). */
const dayToday = () => dayNumber(Date.now());

/**
 * Where the key lies, said only to screen readers (#315, #334): what a seeing
 * learner might spot cannot be heard, and a blind search would keep them out
 * of the orchard. Said as a thing in the world, not as an instruction.
 */
const KEY_PLACE: Record<KeySpot, string> = {
  bench: "Something small glints under the bench.",
  pond: "Something small glints among the stones by the pond.",
  lantern: "Something small glints by the lantern farthest from the door.",
  bed: "Something small glints by the bed farthest from the door.",
  sunflower: "Something small glints by the sunflower.",
};

/**
 * The controls hint (#334) shows in the learner's own walk until they first
 * move: it teaches the controls, and they stay the same. The landing page's
 * walk shows it each time and never uses it up.
 */
const HINT_SEEN_KEY = "garden-hint-seen";

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_SEEN_KEY) === "1";
  } catch {
    // Storage can be blocked: then the hint shows each time, as it did before.
    return false;
  }
}

function markHintSeen() {
  try {
    localStorage.setItem(HINT_SEEN_KEY, "1");
  } catch {
    // Not saved: it shows again next time.
  }
}

/** The landing page's walk: the hint shows each time, and nothing is saved. */
const SHOWCASE_HINT = { show: true, moved: () => {} };

/** The landing page's walk: the door stays locked, and there is nothing to save. */
const SHOWCASE_DOOR = { state: "locked" as const, open: () => {} };

/** The plant's one line of personality (the same every time for this word, and the same as in the 2D garden). */
function personality(p: PlacedPlant): string {
  return plantLine(p.lemma, plantMood(p));
}

/** Without `water` it is view-only (the landing page): no watering, no sessions. */
export function GardenWalk({
  lang,
  source,
  visitors,
  door = SHOWCASE_DOOR,
  leave: leaveGiven,
  toys: toysGiven,
  onExit,
  water,
  focus,
  onTap,
  hint: hintFirst = SHOWCASE_HINT,
}: {
  lang: string;
  source: PlantSource | null;
  /** Today's visitors (snail, cat, ...): a snapshot is taken when the garden opens. */
  visitors?: LearnerVisitors | null;
  /** The door in the hedge (#315), and how to save it once opened. Without it (the landing page) the door stays locked. */
  door?: { state: DoorState; open: () => void };
  /** Leave it out (#351): the bowl and the shelf, and how to save them. Without it (the landing page) the crumbs can be left, but nothing is saved. */
  leave?: { walk: LeaveWalk; save: (left: Left) => void };
  /** The lawn and pond toys (#360). Without it (the landing page), today's clocks and no boat. */
  toys?: ToysWalk;
  onExit: () => void;
  /** Starts practice; `label` says what it starts. */
  water?: { label: string; start: () => void };
  focus?: Focus | null;
  /** A tap met something in the walk (or open ground to walk to), or the action button did something: what, for counting (#335). */
  onTap?: (verb: GardenVerb) => void;
  /** Whether the controls hint shows, and what to do once the viewer first moves while it shows. */
  hint?: { show: boolean; moved: () => void };
}) {
  const [time, setTime] = useState<TimeOfDay>(initialTime);
  const [hint, setHint] = useState(hintFirst.show);
  const [detail, setDetail] = useState<Detail>(() => savedDetail() ?? "normal");
  const [sound] = useSound();
  const chooseDetail = (d: Detail) => {
    setDetail(d);
    try {
      localStorage.setItem(QUALITY_KEY, d);
    } catch {
      // Not saved; it still applies now.
    }
  };
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tag = language(lang).tag;
  const [showcase] = useState(showcaseLeaveNow);
  const given = leaveGiven ?? showcase;
  // What the learner leaves and finds is counted (#335). With sound on, a fruit taken from the basket says its word once, and so does a find.
  const leaveDone = (d: LeaveDone) => {
    if (d.did === "leave" || d.did === "find") onTap?.(d.did);
    if (!sound) return;
    if (d.did === "take" && d.hand.from === "basket" && "kind" in d.hand.thing) void speak(d.hand.thing.lemma, tag);
    // A course with no word for it has nothing to say.
    const word = d.did === "find" ? nounView(FINDS[d.find], lang).word : null;
    if (word) void speak(word, tag);
  };
  const leave = { ...given, done: leaveDone };
  // A shaken plant (#357): counted, said to screen readers and, with sound on, its forms said one by one.
  const [shook, setShook] = useState<Shook | null>(null);
  // Who answered a call (#377), said to screen readers ([]: no one). With sound on, a short whistle. Counted where it was made (the button, a long press).
  const [called, setCalled] = useState<string[] | null>(null);
  const onCall = (heard: string[]) => {
    setShook(null);
    setCalled(heard);
    if (!sound) return;
    // A key press on the button does not wake audio as a pointer does (the walk's onPointerDownCapture): wake it here, inside the click.
    wakeAudio();
    whistle();
  };
  // What the action button last found hiding (#379), for screen readers. Any other tap or press ends it.
  const [found, setFound] = useState<Hider | null>(null);
  const onShake = (p: PlacedPlant, forms: string[]) => {
    onTap?.("shake");
    setCalled(null);
    setShook({ lemma: p.lemma, forms });
    setToyNews(null);
    if (sound && forms.length) void speakAll(forms, tag);
  };
  // Walking into things is counted (#359). A brushed plant plays its note (only with sound on: brushNote checks); with sound on, a fallen fruit says its word.
  const walkInto = (e: WalkIntoEvent) => {
    onTap?.(e.did);
    if (e.did === "brush") brushNote(e.word, e.clear);
    else if (e.did === "bump" && e.fell === "fruit" && sound) void speak(e.word, tag);
  };
  // What a thrown or put-down thing did where it landed (#358), for screen readers. Doing something with it ends what a shake said.
  const [landed, setLanded] = useState<string | null>(null);
  const carryDone = (d: CarryDone) => {
    if (d.did === "land") return setLanded(d.said);
    onTap?.(d.did);
    setShook(null);
    setCalled(null);
  };
  const [showcaseToys] = useState(showcaseToysNow);
  // What a toy just did (#360), told to screen readers for a few seconds. Played with is counted; with sound on, the boat says its word.
  const [toyNews, setToyNews] = useState<ToyDone | null>(null);
  useEffect(() => {
    if (!toyNews) return;
    const t = setTimeout(() => setToyNews(null), 5000);
    return () => clearTimeout(t);
  }, [toyNews]);
  const toyDone = (d: ToyDone) => {
    onTap?.(d.did);
    setToyNews(d);
    setShook(null);
    setCalled(null);
    if (sound && d.did === "fold") void speak(d.word.lemma, tag);
  };
  const toys = { walk: toysGiven ?? showcaseToys, done: toyDone };
  const { data, scene, ready, failed, progress, labels, selected, reach, hand, company, stars } = useGardenScene({ lang, source, visitors, door, leave, walkInto, toys, focus, time, detail, wrap, canvas, onFocused: () => setHint(false), onShake, onCarry: carryDone, onCall });
  const held = hand && handView(hand, lang);
  // With sound on, the well's echo (#335 S6) says its word once, as it rises.
  const echoed = labels.find((l) => l.kind === "echo");
  const echoId = echoed?.id;
  const echoWord = echoed?.text;
  // Once per echo: turning sound on while one shows does not say it again.
  const echoSaid = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!echoId || echoId === echoSaid.current) return;
    echoSaid.current = echoId;
    if (sound) void speak(echoWord!, tag);
  }, [echoId, echoWord, sound, tag]);
  // A plant chosen from outside its card (the summary's "See it in the garden", a click in
  // the scene) takes focus to the card, so a screen reader reads it (#266). From the
  // card's own Next plant, focus stays on that button and the live card body is read.
  const dialog = useRef<HTMLDivElement>(null);
  const selectedId = selected?.id;
  useEffect(() => {
    if (selectedId && !dialog.current!.contains(document.activeElement)) dialog.current!.focus({ preventScroll: true });
  }, [selectedId]);
  // A long press on a plant shakes it (#357); on open ground, near or far, it calls (#377); on anything else it does nothing.
  const onHold = (clientX: number, clientY: number) => {
    if (!scene.current || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    const hit = scene.current.pickAny(clientX - r.left, clientY - r.top, r.width, r.height);
    if (hit?.kind === "plant") scene.current.shake(hit.p);
    if (hit?.kind === "walk" || (hit?.kind === "scenery" && (hit.s.hit.id === "path" || hit.s.hit.id === "grass"))) {
      onTap?.("call");
      scene.current.call();
    }
  };
  const { onPointerDown, onPointerMove, onPointerCancel, endDrag, stick } = useWalkInput({ scene, wrap, selected, onExit, onMove: () => moved(), onHold });

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, [hint]);

  // A click or tap (not a drag) picks a visitor, a plant, an orchard tree, the
  // door or key, open ground to walk to, or the garden itself, in that order
  // (one dispatcher, #323): whichever it meets first wins. Tapping anything but
  // a visitor or a plant (or nothing) closes a plant's card; a plant opens its
  // own, once you are near it (#336).
  const onPointerUp = (e: React.PointerEvent) => {
    if (!endDrag() || !scene.current || !wrap.current) return;
    setShook(null);
    setCalled(null);
    setFound(null);
    const r = wrap.current.getBoundingClientRect();
    const hit = scene.current.pickAny(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (hit?.kind !== "visitor" && hit?.kind !== "plant") scene.current.select(null);
    if (hit) onTap?.(hit.kind);
    switch (hit?.kind) {
      case "visitor": {
        // A visitor may answer (the awake frog croaks one of your known words, never its own name):
        // in a bubble and, with sound on, aloud. Otherwise its tag and its word. No card.
        const said = scene.current.tapVisitor(hit.v.id, visitors?.known ?? []);
        const spoken = said ?? hit.v.word;
        if (sound && spoken) void speak(spoken, tag);
        return;
      }
      case "plant":
        // Its card opens here when it is near, or once you have walked up to it.
        scene.current.tapPlant(hit.p);
        return;
      case "tree":
        // An orchard tree (#315): its word and meaning over it for a moment and, with sound on, its word.
        scene.current.tapTree(hit.t);
        setHint(false);
        if (sound) void speak(hit.t.lemma, tag);
        return;
      case "door":
        // The key, or the shut door (#315): its quiet line, or it opens; from afar, once you have walked up to it.
        scene.current.tapDoor(hit.a);
        setHint(false);
        return;
      case "bowl":
        // Leave it out (#351): the bowl, the basket's things, the shelf, or what came in the night; from afar, once you have walked up to it.
        scene.current.tapLeave(hit.t);
        setHint(false);
        return;
      case "joke":
        // The mouse door, or the sundial at night (#364): its quiet line, from wherever you stand.
        scene.current.tapJoke(hit.j);
        setHint(false);
        return;
      case "carry":
        // A loose thing to pick up; holding one, the cairn, the water to throw it in, or the ground to put it down (#358). From afar, once you have walked up to it.
        scene.current.tapCarry(hit.t);
        setHint(false);
        return;
      case "toy":
        // A dandelion clock (#360): blown; from afar, once you have walked up to it.
        scene.current.tapToy(hit.i);
        setHint(false);
        return;
      case "lantern":
        // A lit lantern (#361): blow it out, or light it again; from afar, once you have walked up to it.
        scene.current.tapLantern(hit.i);
        setHint(false);
        return;
      case "walk":
        scene.current.walkTo(hit.x, hit.z);
        moved();
        return;
      case "scenery":
        // The garden itself (#74). Its tag shows for a moment and, with sound on, it says its word.
        scene.current.tapScenery(hit.s);
        setHint(false);
        if (sound) void speak(hit.s.view.word, tag);
        return;
      default:
        return; // nothing there: already deselected above
    }
  };

  const stats = useMemo(() => {
    const ps = data?.l.plants ?? [];
    return { total: ps.length, bloom: ps.filter((p) => p.stage === "bloom").length };
  }, [data]);

  const hintShown = hint && stats.total > 0 && !selected;
  /** The viewer walked or looked: the hint goes and, if they saw it, it has done its job. */
  const moved = () => {
    if (hintShown) hintFirst.moved();
    setHint(false);
  };

  const step = (dir: 1 | -1) => {
    const ps = data?.l.plants;
    if (!ps?.length || !scene.current) return;
    const i = selected ? ps.indexOf(selected) : dir === 1 ? -1 : 0;
    scene.current.select(ps[(i + dir + ps.length) % ps.length], true);
    setHint(false);
  };

  if (failed)
    return (
      <div className="gw-fallback page">
        <h1>Your garden</h1>
        <p>{failed.text}</p>
        <p className="muted">You can still see all your words in the Words list, and the small garden on the Today screen.</p>
        <div className="row">
          {failed.retry && (
            <button className="primary" onClick={() => location.reload()}>
              Try again
            </button>
          )}
          <button className={failed.retry ? "ghost" : "primary"} onClick={onExit}>
            Back
          </button>
        </div>
      </div>
    );

  return (
    // Walking brushes plants that play their notes (#359): audio may start only inside a tap or key press, so any press in the walk wakes it.
    <div className={`gw gw-${time}`} ref={wrap} onPointerDownCapture={() => wakeAudio()}>
      <canvas
        ref={canvas}
        className="gw-canvas"
        tabIndex={-1}
        aria-label="Your word garden in 3D. Use W, A, S and D or the arrow keys to walk. Drag to look around. Use the Next plant button to go from plant to plant."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
      {/* The door's quiet line, for screen readers: the drawn labels are hidden from them. They also hear where the key lies, and when it is at their feet;
          for leave it out (#351), what they found, the prints and what lies at their feet, and what they hold; who comes to sit with them on the bench (#362); and a fruit that fell (#359). */}
      <div className="sr-only" role="status">
        {spokenStatus(reach, labels, door.state, held, shook, called, company, landed, toyNews, { near: reach === "seek" && scene.current ? scene.current.hider() : null, found }, lang, stars)}
      </div>
      <div className="gw-labels" aria-hidden="true">
        {labels.map((l) =>
          l.kind === "petal" ? (
            // A form falling from a shaken plant (#357), or a leaf for a word with none.
            <span key={l.id} className="gw-petal" lang={lang} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, opacity: l.near }}>
              {l.text || <LeafMark />}
            </span>
          ) : l.kind === "echo" ? (
            // The well's echo (#335 S6): the day it was met, then the word.
            <span key={l.id} className="gw-echo" lang="en" style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%` }}>
              {l.gloss}: <i lang={lang}>{l.text}</i>.
            </span>
          ) : l.kind === "say" || l.kind === "line" ? (
            <span key={l.id} className="gw-say" lang={l.kind === "line" ? "en" : lang} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%` }}>
              {l.text}
            </span>
          ) : l.kind === "tree" || l.kind === "find" || l.kind === "fruit" || l.kind === "boat" || l.where || ((l.kind === "visitor" || l.kind === "scenery") && !l.known) ? (
            <span key={l.id} className="gw-tag" lang={lang} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, opacity: l.near }}>
              <i>{l.text}</i>
              {/* A visitor found hiding (#379) says where it was in place of its meaning. */}
              <small lang="en"> · {l.where ? <Where where={l.where} lang={lang} /> : l.gloss}</small>
            </span>
          ) : (
            <span key={l.id} className={selected?.id === l.id ? "gw-label on" : "gw-label"} style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, opacity: l.kind === "visitor" || l.kind === "scenery" ? l.near : 0.35 + l.near * 0.65 }}>
              {l.known && <LeafMark />}
              {l.gender && <StakeMark gender={l.gender} />}
              {l.text}
            </span>
          ),
        )}
      </div>

      <div className="gw-top">
        <button className="gw-btn" onClick={onExit} aria-label="Back">
          ← <span className="gw-tool-label">Back</span>
        </button>
        <div className="gw-stats" aria-live="polite">
          {data && (stats.total ? `${plural(stats.total, "plant")} · ${stats.bloom} in bloom` : "No plants yet")}
          {data && data.seeds > 0 && <span className="gw-seeds"> · {plural(data.seeds, "seed")} ready</span>}
        </div>
        <div className="gw-tools">
          <SoundToggle className="gw-btn gw-icon" size={21} />
          <button
            className="gw-btn gw-quality"
            onClick={() => chooseDetail(detail === "normal" ? "low" : "normal")}
            title={detail === "normal" ? "Use low quality: bigger pixels, faster on older devices" : "Use normal quality"}
            aria-label={`Quality: ${DETAIL_LABEL[detail]}`}
          >
            <span className={`gw-px gw-px-${detail}`} aria-hidden="true" />
            <span className="gw-tool-label">{DETAIL_LABEL[detail]}</span>
          </button>
          <button className="gw-btn gw-time" onClick={() => setTime(NEXT_TIME[time])} title="Change the time of day" aria-label={`Time of day: ${TIME_LABEL[time]}`}>
            <span className="gw-glyph" aria-hidden="true">{time === "night" ? "☾" : time === "dusk" ? "◐" : "☀"}</span> <span className="gw-tool-label">{TIME_LABEL[time]}</span>
          </button>
        </div>
      </div>

      {progress && progress[1] > 0 && (
        <div className="gw-loading" role="status">
          {loadingLine()}… {Math.round((progress[0] / progress[1]) * 100)}%
        </div>
      )}

      {data && stats.total === 0 && water && (
        <div className="gw-card gw-empty">
          <strong>{EMPTY_WALK.title}</strong>
          <p className="small">{EMPTY_WALK.body}</p>
          <button className="primary" onClick={water.start}>
            {EMPTY_WALK.cta}
          </button>
        </div>
      )}

      {hintShown && (
        <div className="gw-hint">
          <span className="gw-hint-fine">Walk: W A S D, arrow keys or click the ground · Look: drag or swipe with two fingers · Click a plant to see its word</span>
          <span className="gw-hint-coarse">Walk: tap the ground or use the circle · Look: drag · Tap a plant</span>
        </div>
      )}

      {selected && (
        <div className="gw-card" role="dialog" aria-label={`The plant for ${selected.lemma}`} ref={dialog} tabIndex={-1}>
          <button className="gw-close" onClick={() => scene.current?.select(null)} aria-label="Close">
            ×
          </button>
          <div className="gw-card-body" aria-live="polite">
            <WordPlant word={selected.lemma} s={selected.s} stage={selected.stage} size={72} />
            <div>
              <strong className="gw-word" lang={lang}>
                {selected.lemma}
              </strong>
              <span className="gw-gloss">{selected.gloss}</span>
              <span className="muted small">
                {/* No recall number: right after an answer it reads 100%, which looks made up (#261). */}
                {stageSentence(selected.stage)} {selected.r < THIRSTY && "It is a little thirsty."}
              </span>
              <span className="muted small gw-bed">In the bed for {groupOf(selected.pos).toLowerCase()}.</span>
              <span className="small gw-flavour">{personality(selected)}</span>
              {time === "night" && selected.id === data?.visitors.sleeper && (
                <span className="small gw-flavour gw-snore">
                  {snoreLine(lang)}
                </span>
              )}
            </div>
          </div>
          <div className="row">
            {sound && (
              <button
                className="gw-btn gw-listen"
                onClick={() => {
                  // The plant hears its name and perks up for a moment (#60).
                  scene.current?.nod(selected);
                  void speak(selected.lemma, tag);
                }}
              >
                🔊 Listen
              </button>
            )}
            <span className="gw-spacer" />
            <button className="gw-btn" onClick={() => step(-1)} aria-label="Previous plant">
              ←
            </button>
            <button className="gw-btn" onClick={() => step(1)}>
              Next plant <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}

      <div className="gw-bottom">
        {held && !selected && (
          <div className="gw-hand" aria-hidden="true">
            <ArtIcon art={held.art} />
          </div>
        )}
        {reach && !selected && (
          <button
            className="gw-btn gw-icon gw-act"
            aria-label={REACH_NAME[reach]}
            onClick={() => {
              setFound(reach === "seek" && scene.current ? scene.current.hider() : null);
              scene.current?.act(reach);
              // Leave it out's, carry's and the toys' verbs are counted when they are done (leaveDone, carryDone, toyDone): a press may find nothing left to do. A shake is counted by onShake.
              if (!LEAVE_ACTS.has(reach) && !CARRY_ACTS.has(reach) && !TOY_ACTS.has(reach) && reach !== "shake") onTap?.(reach);
              if (reach !== "shake") setShook(null);
              if (reach !== "call") setCalled(null);
              // After the door opens, the key or a find is picked up, something is left, hung, thrown or stacked, a toy is played with, or a walk to the prints starts, there may be
              // nothing in reach: keep keyboard focus in the walk, not lost to the page. Taking or picking up keeps the button, for what comes next (a throw).
              const keeps = reach === "take" || reach === "unhang" || reach === "lift-pebble" || reach === "lift-stick";
              if (reach === "open" || reach === "key" || reach === "seek" || ((LEAVE_ACTS.has(reach) || CARRY_ACTS.has(reach) || TOY_ACTS.has(reach)) && !keeps)) canvas.current?.focus({ preventScroll: true });
            }}
          >
            <PixelIcon rows={REACH_ICON[reach]} />
          </button>
        )}
        {ready && !selected && stats.total > 0 && (
          <button className="gw-btn" onClick={() => step(1)}>
            Next plant <span aria-hidden="true">→</span>
          </button>
        )}
        {/* Named for what it starts, with no count of thirsty plants: Today keeps missed days from piling up, and so does the walk (#263). */}
        {water && stats.total > 0 && !selected && (
          <button className="gw-btn gw-water" onClick={water.start}>
            💧 {water.label}
          </button>
        )}
      </div>

      <Joystick onMove={stick} />
    </div>
  );
}

/** A small pixel-art icon from rows of "#" (drawn) and "." (empty), in the button's colour. */
function PixelIcon({ rows }: { rows: readonly string[] }) {
  const w = Math.max(...rows.map((r) => r.length));
  return (
    <svg viewBox={`-1 -1 ${w + 2} ${rows.length + 2}`} width="32" height="32" aria-hidden="true" shapeRendering="crispEdges">
      <path d={pixelPath(rows)} fill="currentColor" />
    </svg>
  );
}

/** An SVG path with a 1×1 square for each "#" in the rows. */
function pixelPath(rows: readonly string[]): string {
  return rows.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === "#" ? [`M${x} ${y}h1v1h-1z`] : []))).join("");
}

/** Pixel art in its own colours, as big as the action button's icon. */
function ArtIcon({ art }: { art: PixelArt }) {
  const w = art.rows[0].length;
  const h = art.rows.length;
  const side = Math.max(w, h);
  return (
    <svg viewBox={`${(w - side) / 2 - 1} ${(h - side) / 2 - 1} ${side + 2} ${side + 2}`} width="32" height="32" shapeRendering="crispEdges">
      <PixelRects art={art} />
    </svg>
  );
}

/** A tiny pixel leaf: this visitor is also one of your words. */
function LeafMark() {
  return (
    <svg className="gw-leaf" viewBox="0 0 5 5" width="10" height="10" aria-hidden="true" shapeRendering="crispEdges">
      <path d="M3 0h2v2h-1v1h-1v1h-2v1h-1v-2h1v-1h1v-1h1z" fill="#8ccc6a" />
    </svg>
  );
}

/**
 * The top of a noun plant's label stake, by the noun's gender (#357): pointed,
 * round or square, and pointed beside round for a noun that takes either.
 * Never explained: the learner finds the pattern.
 */
const STAKE_TOP = {
  point: ["...#...", "..###..", ".#####.", "#######"],
  round: ["..###..", ".#####.", ".#####.", "..###.."],
  square: [".#####.", ".#####.", ".#####.", ".#####."],
};
const STAKE_POST = ["...#...", "...#...", "...#..."];
const STAKE_TOPS: Record<Gender, (keyof typeof STAKE_TOP)[]> = { m: ["point"], f: ["round"], n: ["square"], mf: ["point", "round"] };

function StakeMark({ gender }: { gender: Gender }) {
  const tops = STAKE_TOPS[gender];
  const w = tops.length * 8 - 1;
  return (
    <svg className="gw-stake" viewBox={`0 0 ${w} 7`} width={w * 2} height="14" aria-hidden="true" shapeRendering="crispEdges">
      {tops.map((t, i) => (
        <path key={t} transform={`translate(${i * 8} 0)`} d={pixelPath([...STAKE_TOP[t], ...STAKE_POST])} fill="#e2bd86" />
      ))}
    </svg>
  );
}

/** A thumb stick for touch screens. Hidden where there is a mouse. */
function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const active = useRef<number | null>(null);
  const R = 44;
  const move = (e: React.PointerEvent) => {
    if (active.current !== e.pointerId || !base.current) return;
    const r = base.current.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) [dx, dy] = [(dx / d) * R, (dy / d) * R];
    setKnob([dx, dy]);
    onMove(dx / R, -dy / R);
  };
  const end = () => {
    active.current = null;
    setKnob([0, 0]);
    onMove(0, 0);
  };
  return (
    <div
      ref={base}
      className="gw-stick"
      aria-hidden="true"
      onPointerDown={(e) => {
        active.current = e.pointerId;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="gw-knob" style={{ transform: `translate(${knob[0]}px, ${knob[1]}px)` }} />
    </div>
  );
}
