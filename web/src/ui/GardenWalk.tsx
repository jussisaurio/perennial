// The garden you can walk in. Every word you have started is a plant in a
// raised bed; walk the paths, read the names, click a plant to hear it.
// The three.js scene loads only when this screen opens. The plants come from
// garden/plants.ts, shared with the 2D garden, so a word looks the same in both.

import "@fontsource/pixelify-sans/500.css";
import "@fontsource/pixelify-sans/700.css";
// The gardener's hand, for the notes in the shed (#673).
import "@fontsource/patrick-hand/400.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { language } from "../content/languages";
import { openDoor, readNote, useLearner, useStore } from "../data/learner";
import { chunkLabel, nextChunk } from "../data/practice";
import { track } from "../observability";
import { DOOR_SPOKEN, keyHelp, keySpot, type KeySpot, type PlacedPlant } from "../garden/world";
import { plantsFromLearner, stageSentence, THIRSTY, type PlantSource } from "../garden/plants";
import type { DoorState, GardenScene, Label, Reach, TimeOfDay, WalkIntoEvent } from "../garden/scene";
import type { TapHit } from "../garden/scenePart";
import type { Hider } from "../garden/sceneVisitors";
import type { Hideout } from "../garden/kinds/kind";
import { EMPTY_WALK } from "../content/voice";
import { echoDate } from "../garden/well";
import { takeFocus, type Focus } from "./gardenFocus";
import { WordPlant } from "./plant";
import { animalSays, speak, speakAll } from "./speech";
import { clipsOn, loadClip, prefetchClips } from "./clipPlayer";
import { useSound } from "./Sound";
import { plural } from "./format";
import { useNow } from "./useNow";
import { yieldToBrowser } from "../lib/yield";
import { useGardenScene, useWalkInput, type Store } from "./useGardenScene";
import { dayNumber } from "../core/day";
import { gardenBroughtAt, learnerVisitors, type LearnerVisitors } from "./visitors";
import type { PixelArt } from "../garden/visitorArt";
import type { CarryAct, CarryDone } from "../garden/sceneCarry";
import { PEBBLE } from "../garden/carryArt";
import type { ToyAct, ToyDone } from "../garden/sceneToys";
import type { ToysWalk } from "../garden/toys";
import { inLang } from "../garden/nouns";
import { GNOME_WORD, type Companion } from "../garden/bench";
import { PixelRects } from "./pixel";
import { brushNote, wakeAudio } from "./chime";
import { fellLine } from "../garden/walkInto";
import type { Gender } from "../deck/schema";
import type { Note } from "../garden/notes/note";
import { courseNotes, noteInk, unlockedNotes } from "../garden/notes/read";
import { placeNotes } from "../garden/stile";

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
 * fruit that fell from a tree they walked into, and its word (#359); the
 * well's echo, an old word and the day it was met (#335 S6); something small
 * hiding near them, or what they just found hiding (#379); what fell from a
 * shaken plant (#357); a visitor's own line (#376:
 * the goat up high, the mole caught); the door's line; a lantern that is out,
 * and the stars once every one is (#361); what a thing thrown or put down did where it
 * landed (#358); what they hold. Things in the world, never instructions (#334).
 */
function spokenStatus(reach: Reach | null, labels: readonly Label[], state: DoorState, holding: boolean, shook: Shook | null, company: Companion | null, heard: string | null, landed: string | null, toy: ToyDone | null, seek: Seek, lang: string, stars: boolean): ReactNode {
  if (company) return COMPANY_LINE[company](lang);
  // A tapped thing's thought (#864): its name and the line, both in the course language.
  // The learner just tapped for it and it shows only 10 s, so it comes before the standing lines (the key, seek).
  const thought = labels.find((l) => l.kind === "scenery" && l.thought !== undefined);
  if (thought)
    return (
      <>
        <span lang={lang}>{thought.text}</span>: <span lang={lang}>{thought.thought}</span>
      </>
    );
  if (reach === "key") return "The key is here.";
  // What a toy just did (#360), for a few seconds.
  if (toy) return "The seeds fly away on the wind.";
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
  const fell = labels.find((l) => l.kind === "fruit");
  // A fruit's tag always carries its kind in English as its meaning (scene.ts labels).
  if (fell)
    return (
      <>
        {fellLine(fell.gloss!)} <span lang={lang}>{fell.text}</span>
      </>
    );
  const echoed = labels.find((l) => l.kind === "echo");
  // The day it says before the word is in the course language (#650), so it is left out here.
  if (echoed)
    return (
      <>
        An echo from the well. It says one of your old words: <span lang={lang}>{echoed.text}</span>.
      </>
    );
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
  if (heard) return heard;
  // A joke's line is in the course language, and its gloss is what it means (scene.ts showLine); the door's line is English.
  const quiet = labels.find((l) => l.kind === "line" || l.kind === "far");
  const line = spokenLine(quiet?.gloss ?? quiet?.text, state);
  if (!line && reach === "light") return stars ? "Every lantern is out. Stars shine over the hills." : "This lantern is out.";
  if (line) return line;
  // Nothing held: what the last thing thrown or put down did, if anything.
  if (!holding) return landed;
  return "You hold the pebble.";
}

/** The door's line as a screen reader hears it: the locked line also says where this learner's key lies, once there is one. */
function spokenLine(line: string | undefined, state: DoorState): string | undefined {
  return line === DOOR_SPOKEN.locked && typeof state === "object" ? `${line} ${KEY_PLACE[state.key]}` : line;
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

/** What the learner did in the walk, for counting (#335): what a tap met (TapHit kinds), what the action button did (#334), what they walked into (#359), or did with a loose thing (#358). */
type GardenVerb = TapHit["kind"] | Reach | WalkIntoEvent["did"] | Exclude<CarryDone["did"], "land">;

/** The walk-in garden for the signed-in learner. */
export function LearnerGardenWalk({ lang, onExit, onWater }: { lang: string; onExit: () => void; onWater: (minutes: number) => void }) {
  const [focus] = useState(takeFocus);
  useEffect(() => track("garden_opened"), []);
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
  // The learner's own garden (the same plants as the 2D garden) and today's visitors. The walk is a snapshot of
  // them as it opens, so they are worked out once, in tasks of their own: in render, with every deck word studied,
  // the two took about 120 ms in one task at CPU 10× (#459).
  const [opened, setOpened] = useState<{ source: PlantSource; visitors: LearnerVisitors } | null>(null);
  useEffect(() => {
    if (!learner || opened) return;
    let alive = true;
    void (async () => {
      await yieldToBrowser();
      if (!alive) return;
      const source = plantsFromLearner(learner);
      await yieldToBrowser();
      if (alive) setOpened({ source, visitors: learnerVisitors(learner) });
    })();
    return () => {
      alive = false;
    };
  }, [learner, opened]);
  const source = opened?.source ?? null;
  const visitors = opened?.visitors ?? null;
  const store = useStore();
  const now = useNow();
  // The door in the hedge (#315): open for good once opened; until then the key hides in the garden once "key" brought it,
  // always in the same place for this learner and course, and the world helps once it has waited a few days (#334).
  // Until the learner loads there is no garden to walk (`source` is null), so "locked" is never shown then.
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
  // The toys (#360), worked out once, when the walk first has its learner: the walk is a snapshot of the day it opens.
  // Set while rendering (React's way to keep state from a prop's first value): the walk's snapshot never sees it missing.
  const [toys, setToys] = useState<ToysWalk | null>(null);
  if (learner && !toys) setToys({ day: dayNumber(now) });
  // Watering is today's practice: the rest of today's practice, or more once it is done,
  // named as Today names it, and worked out with the clock, so a walk open past midnight starts the new day.
  // Until the learner loads there are no plants (`source` is null), so nothing to water either.
  const chunk = learner ? nextChunk(learner, now) : null;
  const water = learner && chunk ? { label: chunkLabel(chunk), start: () => onWater(nextChunk(learner).minutes) } : undefined;
  const [hint] = useState(() => ({ show: !hintSeen(), moved: markHintSeen }));
  // The gardener's notes (#654): the ones unlocked by the words known as the walk opens, as the visitors are.
  // A note is read once it is opened; the list syncs to the learner's other devices.
  const read = learner?.course.notes_read;
  const notes = useMemo(() => {
    if (!visitors) return undefined;
    const list = unlockedNotes(courseNotes(lang), visitors.facts.known);
    const isKnown = (lemma: string) => visitors.lemmas.has(lemma);
    const opened = (id: string) => {
      if (read?.includes(id)) return;
      // A write the server refuses is told by the refused-writes notice (#253); the note was still read here.
      readNote(store, lang, id).catch((e) => console.error("note read not saved", e));
    };
    // `?? []`: before the learner loads, nothing has been read.
    return { list, read: read ?? [], isKnown, opened };
  }, [visitors, read, store, lang]);
  return <GardenWalk lang={lang} source={source} visitors={visitors} door={door} toys={toys ?? undefined} notes={notes} onExit={onExit} water={water} focus={focus} onTap={onTap} hint={hint} />;
}

/** The time of day on the wall clock: the garden has no other way to change it (#646). */
function clockTime(): TimeOfDay {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? "day" : h >= 18 && h < 21 ? "dusk" : "night";
}

/** The walk's small icons, drawn in pixels like its frames: emoji and font glyphs each come in another style. */
const GLYPH = {
  left: ["...#...", "..#....", ".#.....", "#######", ".#.....", "..#....", "...#..."],
  right: ["...#...", "....#..", ".....#.", "#######", ".....#.", "....#..", "...#..."],
  close: ["#.....#", ".#...#.", "..#.#..", "...#...", "..#.#..", ".#...#.", "#.....#"],
  soundOn: ["...#....#..", "..##..#..#.", "####...#..#", "####...#..#", "####...#..#", "..##..#..#.", "...#....#.."],
  soundOff: ["...#.......", "..##..#...#", "####...#.#.", "####....#..", "####...#.#.", "..##..#...#", "...#......."],
  drop: ["...#...", "..###..", ".#####.", ".#####.", "#######", "#######", ".#####.", "..###.."],
} satisfies Record<string, readonly string[]>;

/** A walk icon at 2 px a pixel: the stroke of the pixel font beside it. */
const Glyph = ({ name }: { name: keyof typeof GLYPH }) => <PixelIcon rows={GLYPH[name]} cell={2} />;

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
  shake: "Shake the plant",
  "lift-pebble": "Pick up the pebble",
  throw: "Throw it",
  blow: "Blow the dandelion",
  snuff: "Blow out the lantern",
  light: "Light the lantern",
  well: "Drop it in the well",
  seek: "Found you",
  read: "Read the note",
  stool: "Sit on the stool",
  diary: "Read the diary",
};
/** An open hand, in pixels: try the door, pick up the key. */
const HAND = ["....#.....", "..#.#.#...", "..#.#.#...", "..#.#.#.#.", "..#.#.#.#.", "#.#######.", "##########", ".#########", "..#######.", "...#####..", "...#####.."];
const REACH_ICON: Record<Reach, readonly string[]> = {
  try: HAND,
  key: HAND,
  open: ["..###.......", ".#...#......", ".#...#######", ".#...#..#.#.", "..###...#.#."],
  sit: ["#.......", "#.......", "#.......", "########", "#......#", "#......#"],
  stand: ["...#...", "..###..", ".#####.", "#######", "..###..", "..###..", "..###.."],
  // A small plant, shaking.
  shake: [".#..#..#.", "#..###..#", ".#.#.#.#.", "#...#...#", "....#....", "..#####..", "...###..."],
  "lift-pebble": HAND,
  // An arc, coming down.
  throw: ["..######....", ".#......#...", "#........#..", "#........#..", "#......#####", "#.......###.", "#........#.."],
  // A dandelion clock, on its stem.
  blow: ["..#.#.#..", ".#.###.#.", "..#####..", "#.#####.#", "..#####..", ".#.###.#.", "..#.#.#..", "....#....", "....#....", "....#...."],
  // Puffs of air at a small flame.
  snuff: ["..........#.", "####......##", ".........###", "#####....###", ".........###", "####......#."],
  // A flame.
  light: ["...#...", "...##..", "..###..", ".#####.", ".#####.", "#######", "#######", ".#####.", "..###.."],
  // A stone, dropping into a well.
  well: ["....##....", "....##....", "..........", "....##....", "..........", "#........#", "#........#", "##########", "##########"],
  // An open eye: I see you.
  seek: ["...####...", ".##....##.", "#...##...#", "#..####..#", "#...##...#", ".##....##.", "...####..."],
  // A note on its nail, with lines of writing.
  read: ["....##....", "#########.", "#.......##", "#.#####..#", "#.......##", "#.####...#", "#........#", "#.#####..#", "#........#", "##########"],
  // A three-legged stool.
  stool: ["########", "########", ".#..#.#.", ".#..#.#.", "#...#..#", "#...#..#"],
  // A book, its ribbon hanging out.
  diary: [".#########", "##.......#", "#.#......#", "#.#.####.#", "#.#......#", "#.#.###..#", "#.#......#", "##########", "....#.....", "....#....."],
};

/** Carry's actions (#358, sceneCarry.ts CarryAct): counted when done, not when pressed. */
const CARRY_ACTS = new Set<Reach>(["lift-pebble", "throw", "well"] satisfies CarryAct[]);
/** The toys' actions (#360, sceneToys.ts ToyAct). */
const TOY_ACTS = new Set<Reach>(["blow"] satisfies ToyAct[]);

/** The landing page's walk: today's wind and dandelion clocks. */
const showcaseToysNow = (): ToysWalk => ({ day: dayNumber(Date.now()) });

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

/** How far (m) round the walker the words' clips load ahead, and how often (ms) that is looked at again: a walk covers about 4 m in that time. */
const CLIPS_NEAR = { metres: 8, everyMs: 1000 };
/** How often (ms) at most the thing under a mouse is looked for: each look casts a ray through the garden. */
const HOVER_MS = 150;

/**
 * Loads the clips a tap may soon say (#754), while sound is on: the words near the walker, and the one under
 * the mouse. Returns the pointer-move handler for the mouse. Nothing here runs in the frame loop.
 */
function useClipsAhead(scene: RefObject<GardenScene | null>, wrap: RefObject<HTMLDivElement | null>, tag: string, sound: boolean) {
  const on = sound && clipsOn();
  useEffect(() => {
    if (!on) return;
    const look = () => {
      if (scene.current) prefetchClips(scene.current.wordsNear(CLIPS_NEAR.metres), tag, "garden");
    };
    look();
    const t = setInterval(look, CLIPS_NEAR.everyMs);
    return () => clearInterval(t);
  }, [on, scene, tag]);
  const lastHover = useRef(0);
  return (e: React.PointerEvent) => {
    // A mouse with no button down: a touch or a drag is not pointing at something to tap.
    if (!on || e.pointerType !== "mouse" || e.buttons !== 0 || !scene.current || !wrap.current) return;
    if (e.timeStamp - lastHover.current < HOVER_MS) return;
    lastHover.current = e.timeStamp;
    const r = wrap.current.getBoundingClientRect();
    const word = hoverWord(scene.current.pickAny(e.clientX - r.left, e.clientY - r.top, r.width, r.height));
    if (word) void loadClip(word, tag);
  };
}

/** The word a tap on this would say, if any (onPointerUp below). */
function hoverWord(hit: TapHit | null): string | null {
  switch (hit?.kind) {
    case "visitor":
      return hit.v.word;
    case "plant":
      return hit.p.lemma;
    case "tree":
      return hit.t.lemma;
    case "scenery":
      return hit.s.view.word;
    default:
      return null;
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

/** The landing page's walk has no learner, so no notes in the shed. */
const NO_NOTES = { list: [], read: [], isKnown: () => false, opened: () => {} };

/** The landing page's walk: the door stays locked, and there is nothing to save. */
const SHOWCASE_DOOR = { state: "locked" as const, open: () => {} };

/** Without `water` it is view-only (the landing page): no watering, no sessions. */
export function GardenWalk({
  lang,
  source,
  visitors,
  door = SHOWCASE_DOOR,
  toys: toysGiven,
  notes = NO_NOTES,
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
  /** The lawn toys (#360). Without it (the landing page), today's clocks. */
  toys?: ToysWalk;
  /**
   * The gardener's notes on the shed's nails (#654): the unlocked ones, the ids of those read, whether the learner
   * knows a lemma (its words are clear), and what to do once one is opened. Without it (the landing page) the nails are bare.
   */
  notes?: { list: readonly Note[]; read: readonly string[]; isKnown: (lemma: string) => boolean; opened: (id: string) => void };
  onExit: () => void;
  /** Starts practice; `label` says what it starts. */
  water?: { label: string; start: () => void };
  focus?: Focus | null;
  /** A tap met something in the walk (or open ground to walk to), or the action button did something: what, for counting (#335). */
  onTap?: (verb: GardenVerb) => void;
  /** Whether the controls hint shows, and what to do once the viewer first moves while it shows. */
  hint?: { show: boolean; moved: () => void };
}) {
  const [time, setTime] = useState<TimeOfDay>(clockTime);
  // Follow the clock while the walk is open, so evening comes in at 18:00 for someone walking then.
  // Once a minute is soon enough: the light changes only at the hour.
  useEffect(() => {
    const t = setInterval(() => setTime(clockTime()), 60_000);
    return () => clearInterval(t);
  }, []);
  // For a plant's card: its planting date has the year only when that was another year.
  const [openedAt] = useState(Date.now);
  const [hint, setHint] = useState(hintFirst.show);
  const [sound] = useSound();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tag = language(lang).tag;
  // A shaken plant (#357): counted, said to screen readers and, with sound on, its forms said one by one.
  const [shook, setShook] = useState<Shook | null>(null);
  // What the action button last found hiding (#379), for screen readers. Any other tap or press ends it.
  const [found, setFound] = useState<Hider | null>(null);
  const onShake = (p: PlacedPlant, forms: string[]) => {
    onTap?.("shake");
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
  };
  const [showcaseToys] = useState(showcaseToysNow);
  // What a toy just did (#360), told to screen readers for a few seconds. Played with is counted.
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
  };
  const toys = { walk: toysGiven ?? showcaseToys, done: toyDone };
  // The one card open over the walk, if any: a plant's or a note's (#654), never both, so closing one never shows another (#875).
  const [card, setCard] = useState<{ is: "plant"; p: PlacedPlant } | { is: "note"; note: Note } | null>(null);
  const selected = card?.is === "plant" ? card.p : null;
  const note = card?.is === "note" ? card.note : null;
  // A plant the scene opens (a tap, Next plant) replaces any card; the scene closes only its own.
  const onSelect = (p: PlacedPlant | null) => setCard((c) => (p ? { is: "plant", p } : c?.is === "plant" ? null : c));
  const openNote = (id: string) => {
    const n = notes.list.find((n) => n.id === id);
    // The scene shows only the notes it was given, so its id is always one of them.
    if (!n) throw new Error(`no note "${id}"`);
    scene.current?.select(null);
    setCard({ is: "note", note: n });
    setHint(false);
    notes.opened(id);
  };
  // The diary's pages (#858), the unlocked ones in the order they came: its card turns through them.
  const pages = useMemo(() => notes.list.filter((n) => n.diary), [notes.list]);
  const turnPage = (n: Note) => {
    setCard({ is: "note", note: n });
    notes.opened(n.id);
    scene.current?.readDiary(n.id);
  };
  const closeNote = () => {
    setCard(null);
    canvas.current?.focus({ preventScroll: true });
  };
  // Escape closes whichever card is open before it would leave the garden (#874): focus may be on the scene, after a drag.
  const closeCard = () => {
    if (card?.is === "plant") scene.current!.select(null);
    else closeNote();
  };
  // The scene takes these once, as the walk opens; a note opened during the walk turns read where it is by itself.
  const placed = useMemo(() => placeNotes(notes.list, notes.read), [notes.list, notes.read]);
  const { data, scene, ready, failed, progress, labels, spoken, reach, holding, company, stars, heard } = useGardenScene({ lang, source, visitors, door, walkInto, toys, focus, time, wrap, canvas, onFocused: () => setHint(false), onSelect, onShake, onCarry: carryDone, notes: { ...placed, open: openNote } });
  // With sound on, the well's echo (#335 S6) says its word once, as it rises.
  const echoed = spoken.find((l) => l.kind === "echo");
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
  // the scene) takes focus to the card, so a screen reader reads it (#266).
  const dialog = useRef<HTMLDivElement>(null);
  const selectedId = selected?.id;
  useEffect(() => {
    if (selectedId && !dialog.current!.contains(document.activeElement)) dialog.current!.focus({ preventScroll: true });
  }, [selectedId]);
  // A long press on a plant shakes it (#357); on anything else it does nothing.
  const onHold = (clientX: number, clientY: number) => {
    if (!scene.current || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    const hit = scene.current.pickAny(clientX - r.left, clientY - r.top, r.width, r.height);
    if (hit?.kind === "plant") scene.current.shake(hit.p);
  };
  // With nothing in reach the action button goes (#835). If it had focus, focus fell to the page: give it back to the walk, so Tab starts there.
  useEffect(() => {
    if (!reach && document.activeElement === document.body) canvas.current?.focus({ preventScroll: true });
  }, [reach]);
  const { onPointerDown, onPointerMove, onPointerCancel, endDrag, stick } = useWalkInput({ scene, wrap, open: card !== null, onClose: closeCard, onExit, onMove: () => moved(), onHold });
  const hover = useClipsAhead(scene, wrap, tag, sound);

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
    setFound(null);
    const r = wrap.current.getBoundingClientRect();
    const hit = scene.current.pickAny(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (hit?.kind !== "visitor" && hit?.kind !== "plant") scene.current.select(null);
    // Any tap puts a note away.
    setCard((c) => (c?.is === "note" ? null : c));
    if (!hit) return; // nothing there: already deselected above
    onTap?.(hit.kind);
    // A thing in reach acts at once; from afar, once you have walked up to it. A plant's card opens; a visitor may answer
    // (the awake frog croaks one of your known words, never its own name), in a bubble and, with sound on, its recorded sound (#739).
    const answer = scene.current.tap(hit, visitors?.known ?? []);
    if (hit.kind === "walk") moved();
    else if (hit.kind !== "visitor" && hit.kind !== "plant") setHint(false);
    // With sound on, a visitor, an orchard tree or the garden itself says its word; a plant's card says its own.
    if (!sound || hit.kind === "plant") return;
    if (answer) void animalSays(answer.sound);
    else {
      const word = hoverWord(hit);
      if (word) void speak(word, tag);
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

  // Next plant opens the card after the last one seen, so pressing it again after closing a card goes on round the garden.
  const lastSeen = useRef<PlacedPlant | null>(null);
  useEffect(() => {
    if (selected) lastSeen.current = selected;
  }, [selected]);
  const nextPlant = () => {
    const ps = data?.l.plants;
    if (!ps?.length || !scene.current) return;
    const i = lastSeen.current ? ps.indexOf(lastSeen.current) : -1;
    scene.current.select(ps[(i + 1) % ps.length], true);
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
        aria-label="Your word garden in 3D. Use W, A, S and D or the arrow keys to walk. Drag to look around. Tab to the Next plant button to open a plant's card."
        onPointerDown={onPointerDown}
        onPointerMove={(e) => {
          onPointerMove(e);
          hover(e);
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
      {/* The door's quiet line, for screen readers: the drawn labels are hidden from them. They also hear where the key lies, and when it is at their feet;
          what they hold (#358); who comes to sit with them on the bench (#362); and a fruit that fell (#359). */}
      <div className="sr-only" role="status">
        {spokenStatus(reach, spoken, door.state, holding, shook, company, heard, landed, toyNews, { near: reach === "seek" && scene.current ? scene.current.hider() : null, found }, lang, stars)}
      </div>
      <WalkLabels store={labels} selectedId={selected?.id} lang={lang} />

      <div className="gw-top">
        <button className="gw-btn" onClick={onExit} aria-label="Back">
          <Glyph name="left" /> <span className="gw-tool-label">Back</span>
        </button>
        <div className="gw-stats" aria-live="polite">
          {/* One span: as flex items, the parts would lose the spaces between them. On a phone the two counts stack (.gw-dot). */}
          <span>
            {data &&
              (stats.total ? (
                <>
                  <span>{plural(stats.total, "plant")}</span>
                  <span className="gw-dot"> · </span>
                  <span>{stats.bloom} in bloom</span>
                </>
              ) : (
                "No plants yet"
              ))}
            {data && data.seeds > 0 && <span className="gw-seeds"> · {plural(data.seeds, "seed")} ready</span>}
          </span>
        </div>
        <div className="gw-tools">
          <WalkSound />
        </div>
      </div>

      <WalkLoading store={progress} />

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
            <Glyph name="close" />
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
              <span className="muted small gw-bed">Planted on {echoDate(selected.planted, openedAt, "en-GB")}.</span>
            </div>
          </div>
          {sound && (
            <div className="row">
              <button
                className="gw-btn gw-listen"
                onClick={() => {
                  // The plant hears its name and perks up for a moment (#60).
                  scene.current?.nod(selected);
                  void speak(selected.lemma, tag);
                }}
              >
                <Glyph name="soundOn" /> Listen
              </button>
            </div>
          )}
        </div>
      )}

      {note && <NoteCard note={note} lang={lang} isKnown={notes.isKnown} onClose={closeNote} pages={note.diary ? pages : null} onTurn={turnPage} />}

      <div className="gw-bottom">
        {holding && !selected && (
          <div className="gw-hand" aria-hidden="true">
            <ArtIcon art={PEBBLE} />
          </div>
        )}
        {reach && !selected && !note && (
          <button
            className="gw-btn gw-icon gw-act"
            aria-label={REACH_NAME[reach]}
            onClick={() => {
              setFound(reach === "seek" && scene.current ? scene.current.hider() : null);
              scene.current?.act(reach);
              // Carry's and the toys' verbs are counted when they are done (carryDone, toyDone): a press may find nothing left to do. A shake is counted by onShake.
              if (!CARRY_ACTS.has(reach) && !TOY_ACTS.has(reach) && reach !== "shake") onTap?.(reach);
              if (reach !== "shake") setShook(null);
              // After the door opens, the key is picked up, something is thrown or put down or a toy is played with, there may be nothing in reach:
              // keep keyboard focus in the walk, not lost to the page. Picking up keeps the button, for what comes next (a throw).
              if (reach === "open" || reach === "key" || reach === "seek" || ((CARRY_ACTS.has(reach) || TOY_ACTS.has(reach)) && reach !== "lift-pebble")) canvas.current?.focus({ preventScroll: true });
            }}
          >
            <PixelIcon rows={REACH_ICON[reach]} />
          </button>
        )}
        {/* For keyboard and screen-reader players only: it shows while it has focus. Others find plants by walking (#710). */}
        {ready && !selected && stats.total > 0 && (
          <button className="gw-btn sr-only gw-skip" onClick={nextPlant}>
            Next plant <Glyph name="right" />
          </button>
        )}
        {/* Named for what it starts, with no count of thirsty plants: Today keeps missed days from piling up, and so does the walk (#263). */}
        {water && stats.total > 0 && !selected && (
          <button className="gw-btn gw-water" onClick={water.start}>
            <Glyph name="drop" /> {water.label}
          </button>
        )}
      </div>

      <Joystick onMove={stick} />
    </div>
  );
}

/**
 * A gardener's note (#654), on its scrap of paper: only the note is in the course's language. A word whose lemma the
 * learner knows is clear; the rest are faint but still readable, never hidden, and there is nothing to look up.
 */
/** The loading line. Its percent changes on each load chunk, so it renders on its own, not with all of GardenWalk (#727). */
function WalkLoading({ store }: { store: Store<number | null> }) {
  const pct = useSyncExternalStore(store.subscribe, store.get);
  return (
    pct !== null && (
      <div className="gw-loading" role="status">
        Loading your garden… {pct}%
      </div>
    )
  );
}

/** Whether two frames show the same labels with the same words, in any order: then only their places, opacities and stacking differ. */
function sameLabels(a: readonly Label[], b: readonly Label[]): boolean {
  return (
    a.length === b.length &&
    a.every((l) => {
      const m = b.find((m) => m.id === l.id);
      return m !== undefined && l.text === m.text && l.kind === m.kind && l.gloss === m.gloss && l.known === m.known && l.gender === m.gender && l.thought === m.thought && l.where?.text === m.where?.text && l.where?.word === m.where?.word;
    })
  );
}

/** A label's opacity, or null for those that keep their own (a line, the well's echo). */
function labelOpacity(l: Label): number | null {
  if (l.kind === "echo" || l.kind === "say" || l.kind === "line" || l.kind === "far") return null;
  if (l.kind === "petal" || l.kind === "tree" || l.kind === "fruit" || l.where || l.kind === "visitor" || l.kind === "scenery") return l.near;
  return 0.35 + l.near * 0.65;
}

/**
 * The names and tags over the scene. They move on every walking frame, so they render on their own, not with all of GardenWalk (#713).
 * React renders only a new set of labels; a move is written straight to each span's `translate`, `opacity` and `z-index` (#729): React's style writes cost ~1 ms a frame on an old laptop.
 * The plants' names come nearest first, so their order changes as you walk: z-index keeps the scene's order of what shows over what.
 */
function WalkLabels({ store, selectedId, lang }: { store: Store<Label[]>; selectedId: string | undefined; lang: string }) {
  const layer = useRef<HTMLDivElement>(null);
  const set = useRef<Label[]>([]);
  const shown = useSyncExternalStore(store.subscribe, () => {
    const all = store.get();
    if (!sameLabels(all, set.current)) set.current = all;
    return set.current;
  });
  // The layer's size, from a ResizeObserver: reading it as a new set renders would force a layout (#729).
  const size = useRef<{ w: number; h: number } | null>(null);
  const placeAll = useRef(() => {});
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      size.current = { w: e.contentRect.width, h: e.contentRect.height };
      placeAll.current();
    });
    ro.observe(layer.current!);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const div = layer.current!;
    const spans = new Map(shown.map((l, i) => [l.id, div.children[i] as HTMLElement]));
    const dpr = devicePixelRatio;
    // What each span has now, so a label that did not change is not written again.
    const done = new Map<string, { at: string; op: string; z: string }>();
    const place = () => {
      const all = store.get();
      // A new set: React renders it, and this effect runs again for it.
      if (!sameLabels(all, shown)) return;
      // Not measured yet: the observer's first call places them, before the first paint.
      if (!size.current) return;
      const { w, h } = size.current;
      all.forEach((l, i) => {
        const el = spans.get(l.id)!;
        let d = done.get(l.id);
        if (!d) done.set(l.id, (d = { at: "", op: "", z: "" }));
        // On whole device pixels, as `left` and `top` were laid out: the pixel font stays sharp.
        const at = `${Math.round(l.x * w * dpr) / dpr}px ${Math.round(l.y * h * dpr) / dpr}px`;
        if (d.at !== at) el.style.translate = d.at = at;
        const o = labelOpacity(l);
        if (o !== null && d.op !== String(o)) el.style.opacity = d.op = String(o);
        if (d.z !== String(i)) el.style.zIndex = d.z = String(i);
      });
    };
    // The observer places them all again on a resize.
    placeAll.current = place;
    place();
    return store.subscribe(place);
  }, [shown, store]);
  return (
    <div className="gw-labels" aria-hidden="true" ref={layer}>
      {shown.map((l) =>
        l.kind === "petal" ? (
          // A form falling from a shaken plant (#357), or a leaf for a word with none.
          <span key={l.id} className="gw-petal" lang={lang}>
            {l.text || <LeafMark />}
          </span>
        ) : l.kind === "echo" ? (
          // The well's echo (#335 S6): the day it was met, then the word, both in the course language (#650).
          <span key={l.id} className="gw-echo" lang={lang}>
            {l.gloss}: <i>{l.text}</i>.
          </span>
        ) : l.kind === "far" ? (
          // A line from no thing near (the far light's answer, #858): no bubble pointing at something, but words rising like the echo's, in the course language.
          <span key={l.id} className="gw-echo" lang={lang}>
            <i>{l.text}</i>
          </span>
        ) : l.kind === "say" || l.kind === "line" ? (
          // A line with a gloss (a joke's) is in the course language; the door's lines are English.
          <span key={l.id} className="gw-say" lang={l.kind === "line" && l.gloss === undefined ? "en" : lang}>
            {l.text}
          </span>
        ) : l.thought !== undefined ? (
          // A tapped thing's thought (#864): its tag, with the line under it, all in the course language.
          <span key={l.id} className="gw-tag gw-thought" lang={lang}>
            {l.known ? (
              <>
                <LeafMark />
                <i>{l.text}</i>
              </>
            ) : (
              <>
                <i>{l.text}</i>
                <small lang="en"> · {l.gloss}</small>
              </>
            )}
            <span className="gw-thought-line">{l.thought}</span>
          </span>
        ) : l.kind === "tree" || l.kind === "fruit" || l.where || ((l.kind === "visitor" || l.kind === "scenery") && !l.known) ? (
          <span key={l.id} className="gw-tag" lang={lang}>
            <i>{l.text}</i>
            {/* A visitor found hiding (#379) says where it was in place of its meaning. */}
            <small lang="en"> · {l.where ? <Where where={l.where} lang={lang} /> : l.gloss}</small>
          </span>
        ) : (
          <span key={l.id} className={selectedId === l.id ? "gw-label on" : "gw-label"}>
            {l.known && <LeafMark />}
            {l.gender && <StakeMark gender={l.gender} />}
            {l.text}
          </span>
        ),
      )}
    </div>
  );
}

/** A gardener's note on its card; a page of the diary (#858) also turns to the diary's other `pages` (null: a note from the shed or the stile). */
function NoteCard({ note, lang, isKnown, onClose, pages, onTurn }: { note: Note; lang: string; isKnown: (lemma: string) => boolean; onClose: () => void; pages: readonly Note[] | null; onTurn: (n: Note) => void }) {
  const card = useRef<HTMLDivElement>(null);
  // Focus moves to the card as it opens, so a screen reader reads it.
  useEffect(() => card.current!.focus({ preventScroll: true }), [note.id]);
  const at = pages ? pages.indexOf(note) : -1;
  return (
    <div
      className={pages ? "gw-note gw-diary" : "gw-note"}
      role="dialog"
      aria-label={pages ? `A page of the gardener's diary, page ${at + 1} of ${pages.length}` : "A note from the gardener"}
      ref={card}
      tabIndex={-1}
    >
      <button className="gw-close" onClick={onClose} aria-label="Close">
        <Glyph name="close" />
      </button>
      <p className="gw-note-text" lang={lang}>
        {noteInk(note, isKnown).map((ink, i) =>
          ink.style === "faint" ? (
            <span key={i} className="gw-note-faint">
              {ink.text}
            </span>
          ) : ink.style === "struck" ? (
            // A screen reader may say nothing of a strike, so it hears "crossed out" before the word.
            <del key={i} className="gw-note-struck">
              <span className="sr-only" lang="en">
                crossed out:{" "}
              </span>
              {ink.text}
            </del>
          ) : (
            ink.text
          ),
        )}
      </p>
      {pages && (
        <div className="gw-note-pages">
          <button onClick={() => onTurn(pages[at - 1])} disabled={at === 0}>
            <Glyph name="left" /> Earlier page
          </button>
          <button onClick={() => onTurn(pages[at + 1])} disabled={at === pages.length - 1}>
            Later page <Glyph name="right" />
          </button>
        </div>
      )}
    </div>
  );
}

/** A small pixel-art icon from rows of "#" (drawn) and "." (empty), in the button's colour: 32 px square, or `cell` px a pixel. */
function PixelIcon({ rows, cell }: { rows: readonly string[]; cell?: number }) {
  const w = Math.max(...rows.map((r) => r.length));
  return (
    <svg viewBox={`-1 -1 ${w + 2} ${rows.length + 2}`} width={cell ? (w + 2) * cell : 32} height={cell ? (rows.length + 2) * cell : 32} aria-hidden="true" shapeRendering="crispEdges">
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

/** The app's sound toggle (Sound.tsx), with the walk's pixel speaker. */
function WalkSound() {
  const [on, set] = useSound();
  return (
    <button className="gw-btn gw-icon" onClick={() => set(!on)} aria-pressed={!on} aria-label="Mute sound" title={on ? "Sound is on. Click to turn it off." : "Sound is off. Click to turn it on."}>
      <Glyph name={on ? "soundOn" : "soundOff"} />
    </button>
  );
}

/** The thumb stick's base: a disc of 24 × 24 pixels with a rim, like the walk's frames. */
const STICK_CELLS = 24;
/** Each cell's distance from the middle, in cells, picks whether it is drawn. */
const stickPath = (drawn: (d: number) => boolean) =>
  pixelPath(Array.from({ length: STICK_CELLS }, (_, y) => Array.from({ length: STICK_CELLS }, (_, x) => (drawn(Math.hypot(x + 0.5 - STICK_CELLS / 2, y + 0.5 - STICK_CELLS / 2)) ? "#" : ".")).join("")));
const STICK_RIM = stickPath((d) => d <= 12 && d > 10.5);
const STICK_FILL = stickPath((d) => d <= 10.5);

/** A thumb stick for touch screens. Hidden where there is a mouse. */
function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const active = useRef<number | null>(null);
  // How far the knob goes from the middle, in px: its edge to the base's rim (.gw-stick is 96 px, .gw-knob 40).
  const R = 30;
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
      <svg viewBox={`0 0 ${STICK_CELLS} ${STICK_CELLS}`} shapeRendering="crispEdges">
        <path className="gw-stick-fill" d={STICK_FILL} />
        <path className="gw-stick-rim" d={STICK_RIM} />
      </svg>
      <div className="gw-knob" style={{ transform: `translate(${knob[0]}px, ${knob[1]}px)` }} />
    </div>
  );
}
