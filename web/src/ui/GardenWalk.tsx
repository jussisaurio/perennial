// The garden you can walk in. Every word you have started is a plant in a
// raised bed; walk the paths, read the names, click a plant to hear it.
// The three.js scene loads only when this screen opens. The plants come from
// garden/plants.ts, shared with the 2D garden, so a word looks the same in both.

import "@fontsource/pixelify-sans/500.css";
import "@fontsource/pixelify-sans/700.css";
// The gardener's hand, for the notes in the shed (#673).
import "@fontsource/patrick-hand/400.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { language } from "../content/languages";
import { openDoor, readNote, useLearner, useStore } from "../data/learner";
import { chunkLabel, nextChunk } from "../data/practice";
import { track } from "../observability";
import { DOOR_LINES, keyHelp, keySpot, type KeySpot, type PlacedPlant } from "../garden/world";
import { plantsFromLearner, stageSentence, THIRSTY, type PlantSource } from "../garden/plants";
import type { DoorState, Label, Reach, TimeOfDay, WalkIntoEvent } from "../garden/scene";
import type { TapHit } from "../garden/scenePart";
import type { Hider } from "../garden/sceneVisitors";
import type { Hideout } from "../garden/kinds/kind";
import { EMPTY_WALK } from "../content/voice";
import { echoDate } from "../garden/well";
import { takeFocus, type Focus } from "./gardenFocus";
import { WordPlant } from "./plant";
import { speak, speakAll } from "./speech";
import { useSound } from "./Sound";
import { plural } from "./format";
import { useNow } from "./useNow";
import { yieldToBrowser } from "../lib/yield";
import { useGardenScene, useWalkInput, type Store } from "./useGardenScene";
import { dayNumber } from "../core/day";
import { gardenBroughtAt, learnerVisitors, type LearnerVisitors } from "./visitors";
import type { PixelArt } from "../garden/visitorArt";
import type { CarryAct, CarryDone, Held } from "../garden/sceneCarry";
import { LOOSE_ART } from "../garden/carryArt";
import type { ToyAct, ToyDone } from "../garden/sceneToys";
import type { Raised } from "../garden/lookout";
import type { ToysWalk } from "../garden/toys";
import { inLang } from "../garden/nouns";
import { GNOME_WORD, type Companion } from "../garden/bench";
import { PixelRects } from "./pixel";
import { brushNote, wakeAudio, whistle } from "./chime";
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
 * shaken plant (#357); who answered a call (#377); a visitor's own line (#376:
 * the goat up high, the mole caught); the door's line; a lantern that is out,
 * and the stars once every one is (#361); what a thing thrown or put down did where it
 * landed (#358); what they hold. Things in the world, never instructions (#334).
 */
function spokenStatus(reach: Reach | null, labels: readonly Label[], state: DoorState, held: HandView | null, shook: Shook | null, called: string[] | null, company: Companion | null, heard: string | null, landed: string | null, toy: ToyDone | null, raised: Raised | null, seek: Seek, lang: string, stars: boolean): ReactNode {
  if (company) return COMPANY_LINE[company](lang);
  if (reach === "key") return "The key is here.";
  // What a toy just did (#360), for a few seconds.
  if (toy) return "The seeds fly away on the wind.";
  // What the far light did as the lookout's lantern went up (#683), for a few seconds.
  if (raised) return RAISED_LINE[raised];
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
  if (called) return called.length ? called.join(" ") : "Only the wind answers.";
  if (heard) return heard;
  // A joke's line is in the course language, and its gloss is what it means (scene.ts showLine); the door's line is English.
  const quiet = labels.find((l) => l.kind === "line");
  const line = spokenLine(quiet?.gloss ?? quiet?.text, state);
  if (!line && reach === "light") return stars ? "Every lantern is out. Stars shine over the hills." : "This lantern is out.";
  // The stile (#714): it goes nowhere until the note that tells of the hill, but you can look. Then over it, the hill (#722).
  if (!line && (reach === "climb" || reach === "over")) return "Wooden steps go over the back fence.";
  if (!line && reach === "down") return "You stand on the steps, above the fence. Past it, an old path goes up a small hill.";
  if (!line && reach === "back") return "You stand on a small hill past the fence. Far away, across the valley, there is a small house.";
  if (line) return line;
  // Nothing held: what the last thing thrown or put down did, if anything.
  if (!held) return landed;
  return `You hold ${held.name}.`;
}

/** The lookout's lantern raised (#683), as a screen reader hears it: at night the far light shines across the valley, and once it answers. */
const RAISED_LINE: Record<Raised, string> = {
  dusk: "You raise the lantern.",
  steady: "You raise the lantern. Far away, a small light shines.",
  blink: "You raise the lantern. Far away, the small light blinks twice.",
};

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
  call: "Call",
  well: "Drop it in the well",
  seek: "Found you",
  read: "Read the note",
  raise: "Raise the lantern",
  climb: "Climb the stile",
  down: "Climb down",
  over: "Climb over the stile",
  back: "Walk back to the garden",
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
  // A whistle, and its sound.
  call: ["..........#..#", "...........#..", "######..####..", "#.....##....#.", "######.#....#.", ".......#....#.", "........####.."],
  // A stone, dropping into a well.
  well: ["....##....", "....##....", "..........", "....##....", "..........", "#........#", "#........#", "##########", "##########"],
  // An open eye: I see you.
  seek: ["...####...", ".##....##.", "#...##...#", "#..####..#", "#...##...#", ".##....##.", "...####..."],
  // A note on its nail, with lines of writing.
  read: ["....##....", "#########.", "#.......##", "#.#####..#", "#.......##", "#.####...#", "#........#", "#.#####..#", "#........#", "##########"],
  // A lantern, held up high.
  raise: ["..#####..", "...###...", "..#...#..", "..#.#.#..", "..#...#..", "...###...", "....#....", "....#....", "...###...", "..#####.."],
  // Steps, going up; and going down again.
  climb: ["......###", "......#..", "....###..", "....#....", "..###....", "..#......", "###......"],
  down: ["###......", "..#......", "..###....", "....#....", "....###..", "......#..", "......###"],
  // Steps, up and over.
  over: ["...###...", "...#.#...", ".###.###.", ".#.....#.", "##.....##"],
  // Steps, going down: back over the stile.
  back: ["###......", "..#......", "..###....", "....#....", "....###..", "......#..", "......###"],
};

/** Carry's actions (#358, sceneCarry.ts CarryAct): counted when done, not when pressed. */
const CARRY_ACTS = new Set<Reach>(["lift-pebble", "throw", "well"] satisfies CarryAct[]);
/** Picking up a loose thing keeps the action button, for what comes next (a throw). */
const LIFTS = new Set<Reach>(["lift-pebble"] satisfies CarryAct[]);
/** The toys' actions (#360, sceneToys.ts ToyAct). */
const TOY_ACTS = new Set<Reach>(["blow"] satisfies ToyAct[]);

/** What you hold (#358), drawn small by the action button, and said to screen readers. */
type HandView = { art: PixelArt; name: string };

const handView = (h: Held): HandView => ({ art: LOOSE_ART[h], name: `the ${h}` });

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
    setCalled(null);
  };
  const toys = { walk: toysGiven ?? showcaseToys, done: toyDone };
  // The note open on its card (#654), if any.
  const [note, setNote] = useState<Note | null>(null);
  const openNote = (id: string) => {
    const n = notes.list.find((n) => n.id === id);
    // The scene shows only the notes it was given, so its id is always one of them.
    if (!n) throw new Error(`no note "${id}"`);
    scene.current?.select(null);
    setNote(n);
    setHint(false);
    notes.opened(id);
  };
  // The scene takes these once, as the walk opens; a note opened during the walk turns read where it is by itself.
  const placed = useMemo(() => placeNotes(notes.list, notes.read), [notes.list, notes.read]);
  const { data, scene, ready, failed, progress, labels, spoken, selected, reach, hand, company, stars, heard, raised } = useGardenScene({ lang, source, visitors, door, walkInto, toys, focus, time, wrap, canvas, onFocused: () => setHint(false), onShake, onCarry: carryDone, onCall, notes: { ...placed, open: openNote } });
  const held = hand && handView(hand);
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
    setNote(null);
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
      case "joke":
        // The mouse door, or the sundial at night (#364): its quiet line, from wherever you stand.
        scene.current.tapJoke(hit.j);
        setHint(false);
        return;
      case "note":
        // A gardener's note (#654): its card opens; from afar, once you have walked up to the shed.
        scene.current.tapNote(hit.id);
        setHint(false);
        return;
      case "carry":
        // A loose thing to pick up; holding one, the well, the water to throw it in, or the ground to put it down (#358). From afar, once you have walked up to it.
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

  const closeNote = () => {
    setNote(null);
    canvas.current?.focus({ preventScroll: true });
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
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
      {/* The door's quiet line, for screen readers: the drawn labels are hidden from them. They also hear where the key lies, and when it is at their feet;
          what they hold (#358); who comes to sit with them on the bench (#362); and a fruit that fell (#359). */}
      <div className="sr-only" role="status">
        {spokenStatus(reach, spoken, door.state, held, shook, called, company, heard, landed, toyNews, raised && raised.r, { near: reach === "seek" && scene.current ? scene.current.hider() : null, found }, lang, stars)}
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

      {note && !selected && <NoteCard note={note} lang={lang} isKnown={notes.isKnown} onClose={closeNote} />}

      <div className="gw-bottom">
        {held && !selected && (
          <div className="gw-hand" aria-hidden="true">
            <ArtIcon art={held.art} />
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
              if (reach !== "call") setCalled(null);
              // After the door opens, the key is picked up, something is thrown or put down or a toy is played with, there may be nothing in reach:
              // keep keyboard focus in the walk, not lost to the page. Picking up keeps the button, for what comes next (a throw).
              if (reach === "open" || reach === "key" || reach === "seek" || ((CARRY_ACTS.has(reach) || TOY_ACTS.has(reach)) && !LIFTS.has(reach))) canvas.current?.focus({ preventScroll: true });
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
      return m !== undefined && l.text === m.text && l.kind === m.kind && l.gloss === m.gloss && l.known === m.known && l.gender === m.gender && l.where?.text === m.where?.text && l.where?.word === m.where?.word;
    })
  );
}

/** A label's opacity, or null for those that keep their own (a line, the well's echo). */
function labelOpacity(l: Label): number | null {
  if (l.kind === "echo" || l.kind === "say" || l.kind === "line") return null;
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
        ) : l.kind === "say" || l.kind === "line" ? (
          // A line with a gloss (a joke's) is in the course language; the door's lines are English.
          <span key={l.id} className="gw-say" lang={l.kind === "line" && l.gloss === undefined ? "en" : lang}>
            {l.text}
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

function NoteCard({ note, lang, isKnown, onClose }: { note: Note; lang: string; isKnown: (lemma: string) => boolean; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  // Focus moves to the card as it opens, so a screen reader reads it and Escape closes it.
  useEffect(() => card.current!.focus({ preventScroll: true }), [note.id]);
  return (
    <div
      className="gw-note"
      role="dialog"
      aria-label="A note from the gardener"
      ref={card}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // Only the card closes: the walk's own Escape would leave the garden.
        e.stopPropagation();
        onClose();
      }}
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
