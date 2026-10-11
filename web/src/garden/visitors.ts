// Garden visitors: small animals and things that come and go. Each one is a
// word in the course language (with its article), shown as a small tag in the
// walk and a tooltip in the 2D strip. Visitor words never join reviews, stats,
// the Words list, Next plant or the session summary: they are just for fun.
// Pure functions, so they are easy to test. Rules: docs/voice.md and issue #69.

import { daily, rareDay } from "../ui/whimsy";
import type { Layout } from "./world";

export type VisitorId = "snail" | "gnome" | "frog" | "moth" | "cat" | "heron" | "toadstool" | "bird";

/** What we know about the learner, from review dates only. */
export interface LearnerFacts {
  /** The first review ever (ms), or null for a new learner. */
  firstReview: number | null;
  /** The last review before today (ms). */
  lastBeforeToday: number | null;
  /** The last review on a day before the day of `lastBeforeToday` (ms). */
  prevBeforeLast: number | null;
  /** Words the learner knows. The gnome and the frog come once there are enough. */
  known: number;
}

export const NO_FACTS: LearnerFacts = { firstReview: null, lastBeforeToday: null, prevBeforeLast: null, known: 0 };

interface Ctx {
  facts: LearnerFacts;
  now: Date;
}

export interface VisitorDef {
  id: VisitorId;
  /** The noun with its article, per course language. */
  words: Record<string, string>;
  /** Plain English, shown small next to the word. */
  gloss: string;
  /**
   * Rare visitors come by chance and count toward the cap of two at once.
   * Residents (snail, gnome, frog, moth) live in the garden once they come:
   * the same place every day (the frog and the moth only at dusk and night).
   * Like the snail and the butterflies in #69, they do not count.
   */
  rare: boolean;
  /** "approach": the tag shows when you come near. "tap": only when you tap it (small or moving things). */
  tag: "approach" | "tap";
  /** Is it here today? Stable for the whole calendar day. */
  schedule: (c: Ctx) => boolean;
  /** It moves in once the learner knows this many words (and the Today screen says so that day). */
  unlock?: number;
}

/** A break this long (in calendar days) brings the cat. */
export const CAT_BREAK = 5;
/** At most this many rare visitors at once. Residents (the snail, gnome, frog and moth) do not count. */
export const RARE_CAP = 2;
/** Known words that bring the gnome, and the frog. */
export const GNOME_KNOWN = 50;
export const FROG_KNOWN = 150;

/**
 * Residents first, then rare visitors in priority order: when more than two
 * are due, the first ones stay. The cat (after a break) comes first, then the
 * monthly heron, so a one-day-in-two bird never keeps the heron away.
 */
export const VISITORS: readonly VisitorDef[] = [
  { id: "snail", words: { es: "el caracol", de: "die Schnecke" }, gloss: "snail", rare: false, tag: "tap", schedule: () => true },
  // At a bed corner, a different one each day.
  { id: "gnome", words: { es: "el gnomo", de: "der Gartenzwerg" }, gloss: "gnome", rare: false, tag: "approach", unlock: GNOME_KNOWN, schedule: ({ facts }) => facts.known >= GNOME_KNOWN },
  // On a lily pad, at dusk and night only.
  { id: "frog", words: { es: "la rana", de: "der Frosch" }, gloss: "frog", rare: false, tag: "approach", unlock: FROG_KNOWN, schedule: ({ facts }) => facts.known >= FROG_KNOWN },
  // Round one lantern, at dusk and night only. Small and moving: tap only.
  { id: "moth", words: { es: "la polilla", de: "die Motte" }, gloss: "moth", rare: false, tag: "tap", schedule: () => true },
  { id: "cat", words: { es: "el gato", de: "die Katze" }, gloss: "cat", rare: true, tag: "approach", schedule: ({ facts, now }) => catBreak(facts, now) !== null },
  { id: "heron", words: { es: "la garza", de: "der Reiher" }, gloss: "heron", rare: true, tag: "approach", schedule: ({ now }) => now.getDate() === heronDay(now.getFullYear(), now.getMonth()) },
  {
    id: "toadstool",
    words: { es: "la seta", de: "der Pilz" },
    gloss: "mushroom",
    rare: true,
    tag: "approach",
    // Autumn (September to November) is mushroom season.
    schedule: ({ now }) => rareDay(now.getMonth() >= 8 && now.getMonth() <= 10 ? 3 : 7, "visitor-toadstool", now),
  },
  { id: "bird", words: { es: "el pájaro", de: "der Vogel" }, gloss: "bird", rare: true, tag: "tap", schedule: ({ now }) => rareDay(2, "visitor-bird", now) },
];

export const visitor = (id: VisitorId): VisitorDef => VISITORS.find((v) => v.id === id)!;

/** The heron's one day this month (1-based). The same for everyone, so people can ask "did you see the heron?". */
export function heronDay(year: number, month: number): number {
  const days = new Date(year, month + 1, 0).getDate();
  return daily(
    Array.from({ length: days }, (_, i) => i + 1),
    "visitor-heron",
    new Date(year, month, 1),
  );
}

/** The local calendar day as a whole number, the same all day and safe across clock changes. */
export function dayNumber(t: number | Date): number {
  const d = new Date(t);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** The facts visitorsFor needs, from the learner's review times (ms, any order). */
export function learnerFacts(reviews: Iterable<number>, known: number, now: Date | number = Date.now()): LearnerFacts {
  const today = dayNumber(now);
  let first: number | null = null;
  let last: number | null = null;
  for (const t of reviews) {
    if (first === null || t < first) first = t;
    if (dayNumber(t) < today && (last === null || t > last)) last = t;
  }
  let prev: number | null = null;
  if (last !== null) {
    const lastDay = dayNumber(last);
    for (const t of reviews) if (dayNumber(t) < lastDay && (prev === null || t > prev)) prev = t;
  }
  return { firstReview: first, lastBeforeToday: last, prevBeforeLast: prev, known };
}

/**
 * The cat comes after a break of CAT_BREAK or more calendar days and leaves
 * one day after the first session back. Returns the break length in days, or
 * null when there is no cat.
 */
export function catBreak(f: LearnerFacts, now: Date): number | null {
  if (f.lastBeforeToday === null) return null;
  const today = dayNumber(now);
  const last = dayNumber(f.lastBeforeToday);
  // Still away, or back today.
  if (today - last >= CAT_BREAK) return today - last;
  // The day after the first session back.
  if (today - last === 1 && f.prevBeforeLast !== null) {
    const gap = last - dayNumber(f.prevBeforeLast);
    if (gap >= CAT_BREAK) return gap;
  }
  return null;
}

export interface TodayVisitors {
  /** Who is in the garden today, in VISITORS order. */
  present: VisitorId[];
  /** Calendar days since the first review (0 on that day), or null for a new learner. */
  snailDay: number | null;
}

/** A dev-only override: "all", or a list of visitor ids (the strip-only ones too). */
export type VisitorOverride = "all" | (VisitorId | StripVisitorId)[] | null;

/** Who visits today. Seeded by the calendar date, so a visitor stays all day. */
export function visitorsFor(facts: LearnerFacts, now: Date = new Date(), override: VisitorOverride = null): TodayVisitors {
  const snailDay = facts.firstReview === null ? null : Math.max(0, dayNumber(now) - dayNumber(facts.firstReview));
  if (override) return { present: VISITORS.filter((v) => override === "all" || override.includes(v.id)).map((v) => v.id), snailDay };
  const present: VisitorId[] = [];
  let rare = 0;
  for (const v of VISITORS) {
    if (!v.schedule({ facts, now })) continue;
    if (v.rare && rare >= RARE_CAP) continue;
    if (v.rare) rare++;
    present.push(v.id);
  }
  return { present, snailDay };
}

/** The Today screen line after a break, or null. Never counts days, never guilt (docs/voice.md rule 5). */
export function welcomeBack(facts: LearnerFacts, now: Date = new Date()): string | null {
  if (facts.lastBeforeToday === null) return null;
  // Only on the first day back, not the day after.
  const away = dayNumber(now) - dayNumber(facts.lastBeforeToday);
  if (away >= 60) return "Welcome back. The garden waited for you.";
  if (away >= 7) return "Welcome back. A cat took the bench. It is fine.";
  return null;
}

/** Known-word counts that get one line on the Today screen, on the day they are crossed. */
export const MILESTONES = [25, 50, 100, FROG_KNOWN, 200, 500] as const;

/**
 * The Today screen line on the day the learner's known words cross a
 * milestone: `before` at the start of the day, `now` at the moment. When a
 * visitor moves in at that count, the line says so, but never who: you find
 * it yourself. Null on every other day.
 */
export function milestoneLine(before: number, now: number): string | null {
  let hit = 0;
  for (const m of MILESTONES) if (before < m && now >= m) hit = m;
  if (!hit) return null;
  const arrives = VISITORS.some((v) => v.unlock === hit);
  return arrives ? `You know ${hit} words. Someone has arrived in the garden.` : `You know ${hit} words. The garden noticed.`;
}

// ---- Strip-only visitors: the worm (#58) and the mole (#61) ----

/** Visitors that live only in the 2D strip: the worm in an empty garden, the mole at the far right end. */
export type StripVisitorId = "worm" | "mole";

export const STRIP_VISITORS: Record<StripVisitorId, { words: Record<string, string>; gloss: string }> = {
  worm: { words: { es: "el gusano", de: "der Wurm" }, gloss: "worm" },
  mole: { words: { es: "el topo", de: "der Maulwurf" }, gloss: "mole" },
};

/** The mole looks up at the end of the strip on about one day in this many. */
export const MOLE_ONE_IN = 4;

/** Is the mole at the end of the strip today? Stable all day; the dev override can bring it. */
export function moleVisits(now: Date = new Date(), override: VisitorOverride = null): boolean {
  if (override) return override === "all" || override.includes("mole");
  return rareDay(MOLE_ONE_IN, "visitor-mole", now);
}

/** A strip visitor's word for this course, or null when the course has none. */
export function stripVisitor(id: StripVisitorId, lang: string): { id: StripVisitorId; word: string; gloss: string } | null {
  const v = STRIP_VISITORS[id];
  const word = v.words[lang];
  return word ? { id, word, gloss: v.gloss } : null;
}

/** A visitor as the garden shows it: its word in the course language, if there is one. */
export interface VisitorView {
  id: VisitorId;
  /** Article and noun, e.g. "el caracol". Null for a course with no visitor words. */
  word: string | null;
  gloss: string;
  /** The learner knows this noun as one of their own words: it gets plant-label styling. */
  known: boolean;
  tag: "approach" | "tap";
}

/** Today's visitors for this course. `isKnown` gets the bare noun ("perro", not "el perro"). */
export function visitorViews(present: readonly VisitorId[], lang: string, isKnown: (noun: string) => boolean = () => false): VisitorView[] {
  return present.map((id) => {
    const v = visitor(id);
    const word = v.words[lang] ?? null;
    return { id, word, gloss: v.gloss, known: !!word && isKnown(word.slice(word.indexOf(" ") + 1)), tag: v.tag };
  });
}

// ---- The shy gnome (#54) ----

/** Distances (m): it faces you from afar, turns its back up close, and peeks when you are right behind it. */
export const GNOME_FACE = 4;
export const GNOME_BACK = 2.5;
export const GNOME_PEEK = 1.2;
/** How long its tag comes back when it peeks (s). */
export const GNOME_PEEK_TAG = 1.6;

export type GnomePose = "front" | "side" | "back" | "peek";

/** The gnome's pose for a viewer `d` metres away: front, turning (side), back, or peeking over its shoulder. */
export function gnomePose(d: number): GnomePose {
  return d > GNOME_FACE ? "front" : d > GNOME_BACK ? "side" : d > GNOME_PEEK ? "back" : "peek";
}

/**
 * How much of its tag shows (0 to 1): all of it while it faces you, less as it
 * turns away, none from behind, and all again for a moment when it peeks.
 * `peeking`: seconds since it began to peek.
 */
export function gnomeTag(d: number, peeking: number): number {
  if (d > GNOME_FACE) return 1;
  if (d > GNOME_BACK) return (d - GNOME_BACK) / (GNOME_FACE - GNOME_BACK);
  if (d > GNOME_PEEK) return 0;
  return peeking < GNOME_PEEK_TAG ? 1 : 0;
}

// ---- The frog (#57) ----

/** What a frog says, per course language. */
export const CROAK: Record<string, string> = { es: "croac", de: "quak" };

/**
 * What the frog croaks on its `tap`-th tap today: its sound and one word the
 * learner knows (never its own name), e.g. "croac… casa". A different word on
 * most taps, in the same order all day.
 */
export function frogCroak(known: readonly string[], lang: string, tap: number, now: Date = new Date()): string {
  const sound = CROAK[lang] ?? "croak";
  const own = (visitor("frog").words[lang] ?? "").split(" ").pop()!.toLowerCase();
  const pool = known.filter((w) => w.toLowerCase() !== own);
  return pool.length ? `${sound}… ${daily(pool, `frog-croak-${tap}`, now)}` : `${sound}…`;
}

// ---- The snail's long trip (#55) ----

/** Pickets per metre of fence (the picket texture has four per metre). */
export const PICKETS_PER_M = 4;
/** Half the width of the gate opening, in metres. */
export const GATE_HALF = 1.1;

/** The fence as one path from the right gate post, round the garden, to the left gate post. */
export function fencePath(l: Layout): [number, number][] {
  const b = l.bounds;
  return [
    [l.gate.x + GATE_HALF, b.maxZ],
    [b.maxX, b.maxZ],
    [b.maxX, b.minZ],
    [b.minX, b.minZ],
    [b.minX, b.maxZ],
    [l.gate.x - GATE_HALF, b.maxZ],
  ];
}

export function fencePickets(l: Layout): number {
  const path = fencePath(l);
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return Math.max(1, Math.floor(len * PICKETS_PER_M));
}

/** One picket per calendar day, starting at the gate; back at the gate after a full lap. */
export function snailPicket(day: number, pickets: number): number {
  return ((day % pickets) + pickets) % pickets;
}

/** The snail's place along the whole fence, 0 at the gate to almost 1 at the end of a lap. */
export function snailFraction(day: number, pickets: number): number {
  return snailPicket(day, pickets) / pickets;
}

/** The point on the fence at `picket`, and the direction of the fence there (for "inside"). */
export function fencePoint(l: Layout, picket: number): { x: number; z: number; dx: number; dz: number } {
  const path = fencePath(l);
  let d = (picket + 0.5) / PICKETS_PER_M;
  for (let i = 1; i < path.length; i++) {
    const [x1, z1] = path[i - 1];
    const [x2, z2] = path[i];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (d <= len || i === path.length - 1) {
      const k = len ? Math.min(1, d / len) : 0;
      return { x: x1 + (x2 - x1) * k, z: z1 + (z2 - z1) * k, dx: len ? (x2 - x1) / len : 1, dz: len ? (z2 - z1) / len : 0 };
    }
    d -= len;
  }
  return { x: path[0][0], z: path[0][1], dx: 1, dz: 0 };
}
