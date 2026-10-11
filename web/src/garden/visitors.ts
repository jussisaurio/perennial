// Garden visitors: small animals and things that come and go. Each one is a
// word in the course language (with its article), shown as a small tag in the
// walk and a tooltip in the 2D strip. Visitor words never join reviews, stats,
// the Words list, Next plant or the session summary: they are just for fun.
// Pure functions, so they are easy to test. Rules: docs/voice.md and issue #69.

import { rareDay } from "../ui/whimsy";
import type { Layout } from "./world";

export type VisitorId = "snail" | "cat" | "toadstool" | "bird";

/** What we know about the learner, from review dates only. */
export interface LearnerFacts {
  /** The first review ever (ms), or null for a new learner. */
  firstReview: number | null;
  /** The last review before today (ms). */
  lastBeforeToday: number | null;
  /** The last review on a day before the day of `lastBeforeToday` (ms). */
  prevBeforeLast: number | null;
  /** Words the learner knows. For later visitors (frog, gnome). */
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
  /** Rare visitors count toward the cap of two at once. */
  rare: boolean;
  /** "approach": the tag shows when you come near. "tap": only when you tap it (small or moving things). */
  tag: "approach" | "tap";
  /** Is it here today? Stable for the whole calendar day. */
  schedule: (c: Ctx) => boolean;
}

/** A break this long (in calendar days) brings the cat. */
export const CAT_BREAK = 5;
/** At most this many rare visitors at once. The snail does not count. */
export const RARE_CAP = 2;

/** In priority order: when more than two rare visitors are due, the first ones stay. */
export const VISITORS: readonly VisitorDef[] = [
  { id: "snail", words: { es: "el caracol", de: "die Schnecke" }, gloss: "snail", rare: false, tag: "tap", schedule: () => true },
  { id: "cat", words: { es: "el gato", de: "die Katze" }, gloss: "cat", rare: true, tag: "approach", schedule: ({ facts, now }) => catBreak(facts, now) !== null },
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

/** A dev-only override: "all", or a list of visitor ids. */
export type VisitorOverride = "all" | VisitorId[] | null;

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
