// The story as one simulated learner meets it (#928): each story event
// (garden/story.ts) on the day the learner of a trace (sim/trace.ts) meets it,
// how much of its text they can read that day, and the pacing metrics the
// story loop tunes (docs/story-loop.md). Pure; the command is sim/storySim.ts.
//
// A trace knows only the learner's words, so this assumes what they do:
// - A note is read on the day it comes.
// - A thought is seen on the day it comes: the learner taps its thing that
//   day. The stool stands on the hill, and the way up opens from the walk
//   after the hill's note (docs/garden-play.md, "After note n08"), so its
//   lines wait until the next day.
// - The frog's lines are heard on the day they come, once the frog lives here.
// - A count once reached stays reached. A note once found stays found
//   (notes/read.ts); a thought or frog line that hides again for a day after a
//   word is forgotten is left out.

import { noteInk, type Ink } from "../garden/notes/read";
import type { Note } from "../garden/notes/note";
import type { StoryEvent } from "../garden/story";
import type { VisitorId } from "../garden/visitors";
import { dayKnowing, onDay, type Trace } from "./trace";

/** A course's story, as the projector reads it. */
export interface CourseStory {
  events: readonly StoryEvent[];
  /** The gardener's own words, lower case: in the notes, in no deck (notes/es.ts). Never known, so a share leaves them out, as notes.test.ts does. */
  gardener: ReadonlySet<string>;
}

/** The text an event shows, if it shows one. */
export function written(e: StoryEvent): Pick<Note, "text" | "forms"> | null {
  if (e.kind === "note") return e.note;
  if (e.kind === "thought") return e.thought;
  if (e.kind === "frog") return e.line;
  return null;
}

/**
 * A course's story: its events, and the words of its notes that are in no deck (`lemmas`: the deck's, lower case).
 * Besides the gardener's names (Migas, saltavallas, lucero), this catches a note word that matches no deck
 * word or form (es seto, al; de Hecke): the app never shows those clear either.
 */
export function courseStory(events: readonly StoryEvent[], lemmas: ReadonlySet<string>): CourseStory {
  const gardener = new Set<string>();
  for (const e of events) {
    if (e.kind !== "note") continue;
    for (const ink of noteInk(e.note, (l) => lemmas.has(l))) if (ink.style === "faint") gardener.add(ink.text.toLowerCase());
  }
  return { events, gardener };
}

/** The three kinds of story event (docs/direction.md, "Density"). */
type Tier = "big" | "small" | "texture";

/**
 * A note is a big beat. A thought or frog line that needs a fact from the notes (garden/facts.ts) follows a
 * beat: a small one. The rest is texture. A visitor or the key tells and needs no fact, so it counts as texture.
 */
function tier(e: StoryEvent): Tier {
  if (e.kind === "note") return "big";
  const assumes = e.kind === "thought" ? e.thought.assumes : e.kind === "frog" ? e.line.assumes : undefined;
  // `?.`: a line that needs no fact leaves `assumes` out.
  return assumes?.length ? "small" : "texture";
}

/** A story event on the day the learner meets it. */
export interface Met {
  day: number;
  /** Known words at the end of that day. */
  known: number;
  event: StoryEvent;
  tier: Tier;
  /** A note's, thought's or frog line's words as they read that day. */
  ink?: Ink[];
  /** The share of those words the learner knows that day, without the crossed-out words and the gardener's. */
  share?: number;
}

/** Days with nothing new, from and to (both quiet). */
export interface Quiet {
  from: number;
  to: number;
}

interface Metrics {
  /** Days from each note to the next. */
  noteGaps: { from: string; to: string; days: number }[];
  /** The longest run of days with nothing new. */
  longestQuiet: Quiet | null;
  /** New things a week, from week 1 to the week the story ends (the door, or the trace's last day). */
  perWeek: number;
  /** Weeks with nothing new. */
  quietWeeks: number[];
  /** How many new things of each kind. */
  tiers: Record<Tier, number>;
  /** Days that bring more than CLUMP notes at once. */
  clumps: { day: number; notes: string[] }[];
  /** Thoughts that stay on their thing while the story moves on (STALE). */
  stale: { thing: string; text: string; from: number; until: number; notes: number }[];
  /** The day the last note comes and the mouse door opens, or null if the trace stops first. */
  doorDay: number | null;
}

export interface Projection {
  /** Every event the learner meets, by day; on a day, its notes last. */
  met: Met[];
  /** Events the learner never meets: past where the trace stops. */
  unmet: StoryEvent[];
  /** The story's last day: the door's, or the trace's last day if it stops first. */
  end: number;
  metrics: Metrics;
}

/** More notes than this on one day is a clump (#928: "at most 2 notes on one day"). */
const CLUMP = 2;
/** A line is stale once this many notes come while it shows, over at least this many weeks: the owner's "many weeks while the story moves on". */
const STALE = { notes: 2, weeks: 8 };

/** The day the way up the hill is open, given the day its note comes: the next walk, so the next day. */
export const hillOpens = (noteDay: number | null): number | null => (noteDay === null ? null : noteDay + 1);

/** The week of a day: days 1–7 are week 1. */
export const weekOf = (day: number): number => Math.ceil(day / 7);

/** The runs of days with nothing new from day 1 to `end`, given the days that bring something (in order, no repeats). */
export function quietStretches(days: readonly number[], end: number): Quiet[] {
  const out: Quiet[] = [];
  let last = 0;
  for (const d of [...days, end + 1]) {
    if (d - last > 1) out.push({ from: last + 1, to: d - 1 });
    last = d;
  }
  return out;
}

export function projectStory(trace: Trace, story: CourseStory): Projection {
  const reached = (gate: StoryEvent["gate"]): number | null =>
    "known" in gate
      ? dayKnowing(trace, gate.known)
      : // `?.`: a day on which no visitor came leaves `brought` out (sim/trace.ts). `?? null`: never within the trace.
        (trace.days.find((d) => d.brought?.includes(gate.garden))?.day ?? null);
  const all = story.events.map((event) => ({ event, day: reached(event.gate) }));
  type Item = (typeof all)[number];
  const sooner = (a: Item, b: Item) => (b.day !== null && (a.day === null || b.day < a.day) ? b : a);
  /** A visitor comes once, by the first of its gates: a later gate is no new event. */
  const arrival = (v: VisitorId): Item => {
    const gates = all.filter((i) => i.event.kind === "visitor" && i.event.visitor === v);
    if (!gates.length) throw new Error(`the ${v} has no gate`);
    return gates.reduce(sooner);
  };
  const items = all.filter((i) => i.event.kind !== "visitor" || arrival(i.event.visitor) === i);
  const later = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.max(a, b));
  const frog = arrival("frog");
  const hill = items.find((i) => i.event.kind === "note" && i.event.opens.includes("hill"));
  if (!hill) throw new Error("no note opens the hill");
  for (const i of items) {
    if (i.event.kind === "thought" && i.event.thought.thing === "stool") i.day = later(i.day, hillOpens(hill.day));
    if (i.event.kind === "frog") i.day = later(i.day, frog.day);
  }

  const end = trace.doorDay ?? trace.days.at(-1)?.day;
  if (end === undefined) throw new Error(`the ${trace.lang} ${trace.pattern} trace has no days`);
  const met: Met[] = [];
  const unmet: StoryEvent[] = [];
  for (const { event, day } of items) {
    if (day === null || day > end) {
      unmet.push(event);
      continue;
    }
    const { known, lemmas } = onDay(trace, day);
    const text = written(event);
    if (!text) {
      met.push({ day, known, event, tier: tier(event) });
      continue;
    }
    const ink = noteInk(text, (l) => lemmas.has(l));
    const words = ink.filter((i) => i.style !== "struck" && /\p{L}/u.test(i.text) && !story.gardener.has(i.text.toLowerCase()));
    met.push({ day, known, event, tier: tier(event), ink, share: words.filter((i) => i.style === "clear").length / words.length });
  }
  // On a day, its notes last: a checkpoint of the reader's script ends on its note.
  met.sort((a, b) => a.day - b.day || Number(a.event.kind === "note") - Number(b.event.kind === "note"));
  return { met, unmet, end, metrics: metrics(met, end, trace.doorDay) };
}

/** The items of `xs` by their key, in order. */
function groupBy<T, K>(xs: readonly T[], key: (x: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = out.get(k);
    if (list) list.push(x);
    else out.set(k, [x]);
  }
  return out;
}

/** A met event of one kind. */
type MetOf<K extends StoryEvent["kind"]> = Met & { event: Extract<StoryEvent, { kind: K }> };
const isKind =
  <K extends StoryEvent["kind"]>(kind: K) =>
  (m: Met): m is MetOf<K> =>
    m.event.kind === kind;

function metrics(met: readonly Met[], end: number, doorDay: number | null): Metrics {
  const notes = met.filter(isKind("note"));
  const noteGaps = notes.slice(1).map((m, i) => ({ from: notes[i].event.note.id, to: m.event.note.id, days: m.day - notes[i].day }));

  const quiet = quietStretches([...new Set(met.map((m) => m.day))], end);
  const longestQuiet = quiet.reduce<Quiet | null>((best, q) => (!best || q.to - q.from > best.to - best.from ? q : best), null);

  const weeks = weekOf(end);
  const busy = new Set(met.map((m) => weekOf(m.day)));
  const quietWeeks = Array.from({ length: weeks }, (_, i) => i + 1).filter((w) => !busy.has(w));

  const tiers: Record<Tier, number> = { big: 0, small: 0, texture: 0 };
  for (const m of met) tiers[m.tier]++;

  const clumps = [...groupBy(notes, (m) => m.day)].filter(([, ns]) => ns.length > CLUMP).map(([day, ns]) => ({ day, notes: ns.map((m) => m.event.note.id) }));

  const stale: Metrics["stale"] = [];
  for (const [thing, lines] of groupBy(met.filter(isKind("thought")), (m) => m.event.thought.thing)) {
    lines.forEach((m, i) => {
      // The last line stays to the end, and a note on the last day still comes while it shows.
      const until = i + 1 < lines.length ? lines[i + 1].day : end + 1;
      const passed = notes.filter((n) => n.day > m.day && n.day < until).length;
      if (passed >= STALE.notes && until - m.day >= STALE.weeks * 7) stale.push({ thing, text: m.event.thought.text, from: m.day, until, notes: passed });
    });
  }
  return { noteGaps, longestQuiet, perWeek: met.length / weeks, quietWeeks, tiers, clumps, stale, doorDay };
}
