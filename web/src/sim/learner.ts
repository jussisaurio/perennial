// A simulated learner (#928): the app's own planner, session, memory and Today
// rule, run over years of practice, with what the learner knows written down
// day by day. The story's pacing (garden/notes) is checked against these
// traces (#883), so no browser has to play the game for months.
//
// Run `bun run sim:learners` (src/sim/regenerate.ts) again after a change to
// the planner or the session (core/session.ts, data/practice.ts), the memory
// (core/memory.ts, core/fsrs.ts, core/scheduler.ts), the course order
// (content/order.ts, data/learner.ts) or a deck: the traces are then stale.
//
// The learner is kept small on purpose:
// - A card with a memory is remembered with the chance FSRS gives at that
//   moment (core/memory.ts recall): then Good (3), else Again (1). Never Hard
//   or Easy, never "Already know it", Undo, pause or sound off.
// - A new word's quick check, a few cards after its card, is passed at
//   QUICK_CHECK. A skill's first practice stands in for a due reading review,
//   and is passed at FIRST_PRACTICE times the reading's recall (#853).
// - Each card takes its planned time (core/session.ts COSTS), give or take 30%.
// - Practice starts at 19:00 and runs without a break.

import type { ChangeMessage } from "@tanstack/react-db";
import { memKey, readMemory, recall } from "../core/memory";
import { COSTS, Session, type Task } from "../core/session";
import { indexWords, type LoadedDeck, type WordsPart } from "../data/deckIndex";
import { Learners, type Learner } from "../data/learner";
import { DAILY_MINUTES, nextChunk, sessionPlan } from "../data/practice";
import { COURSE_DEFAULTS, type CourseRow, type ReviewRow, type Skill } from "../data/rows";
import type { GardenWord } from "../deck/schema";
import { courseNotes } from "../garden/notes/read";
import { rng } from "../lib/seed";
import { runAll } from "../lib/yield";
import type { Store } from "../data/store";
import { gardenBrought, knownWords } from "../ui/visitors";
import type { Pattern, Trace, TraceDay } from "./trace";

/** A Monday, so `weekdays` starts with a full week. */
const START = { year: 2026, month: 0, date: 5 };
const PRACTICE_HOUR = 19;
const BREAK = { from: 40, days: 14 };
/** Guessed: the word's card was a few cards ago, so most learners still have it. */
const QUICK_CHECK = 0.85;
/** A first listening or typing practice is harder than reading the same word (#853). */
const FIRST_PRACTICE: Record<Exclude<Skill, "read">, number> = { listen: 0.8, write: 0.6 };
/** Each card takes its planned time times 0.7 to 1.3. */
const SPREAD = 0.6;

function practises(pattern: Pattern, day: number, weekday: number): boolean {
  if (pattern === "weekdays") return weekday !== 0 && weekday !== 6;
  if (pattern === "break") return day < BREAK.from || day >= BREAK.from + BREAK.days;
  return true;
}

/** A table that is ready at once and sends the rows given to it: all of a store that Learners reads. */
class Table<T extends object> {
  private listener: ((changes: ChangeMessage<T>[]) => void) | null = null;
  private readonly initial: ChangeMessage<T>[];
  constructor(initial: ChangeMessage<T>[] = []) {
    this.initial = initial;
  }
  subscribeChanges(cb: (changes: ChangeMessage<T>[]) => void) {
    this.listener = cb;
    cb(this.initial);
    return { unsubscribe() {} };
  }
  onFirstReady() {
    return () => {};
  }
  isReady() {
    return true;
  }
  insert(key: string, value: T) {
    // !: Learners subscribes to every table when it is made.
    this.listener!([{ type: "insert", key, value }]);
  }
}

/** Learners builds its first learner in slices: wait for it once, and every later get() is at once. */
function firstLearner(learners: Learners, lang: string, deck: LoadedDeck): Promise<Learner> {
  return new Promise((done) => {
    const off = learners.subscribe(() => {
      const l = learners.get(lang, deck);
      if (!l) return;
      off();
      done(l);
    });
    // The first get() starts the build.
    if (learners.get(lang, deck)) throw new Error("the first learner was built at once");
  });
}

/** Runs one learner for up to `maxDays` days, or until they reach the door. */
export async function simulate({ deck: part, pattern, seed, maxDays }: { deck: WordsPart; pattern: Pattern; seed: number; maxDays: number }): Promise<Trace> {
  // Days start at local midnight (core/day.ts): pinned to UTC, so every machine writes the same trace.
  if (new Date(0).getTimezoneOffset() !== 0) throw new Error("run the simulation with TZ=UTC");
  const lang = part.lang;
  const deck = indexWords(part, lang);
  const door = courseNotes(lang).find((n) => n.beat === "door")!.unlockAt; // !: every course has a door (notes/read.ts)
  const random = rng(seed);
  const spread = (ms: number) => ms * (1 - SPREAD / 2 + SPREAD * random());

  const startAt = new Date(START.year, START.month, START.date);
  const course: CourseRow = { user_id: "u", lang, minutes: DAILY_MINUTES, retention: COURSE_DEFAULTS.retention, door_open: false, notes_read: [], created_at: startAt.toISOString() };
  const review = new Table<ReviewRow>();
  const collections = { course: new Table([{ type: "insert", key: lang, value: course }]), review, word_state: new Table(), user_word: new Table(), user_sentence: new Table() };
  // Learners reads only these tables' subscribeChanges, onFirstReady and isReady, and onDispose.
  const learners = new Learners({ collections, onDispose() {} } as unknown as Pick<Store, "collections" | "onDispose">);
  let l = await firstLearner(learners, lang, deck);

  let now = 0;
  let reviews = 0;
  /** The chance this answer is remembered, read before it is recorded. */
  const chance = (task: Extract<Task, { kind: "review" }>) => {
    const m = l.memory.get(memKey(task.wordId, task.skill));
    if (m?.reps) return recall(m, now);
    if (task.skill === "read") return QUICK_CHECK;
    // !: a first practice comes in place of its word's due reading review (core/session.ts), so the reading has a memory.
    return FIRST_PRACTICE[task.skill] * recall(readMemory(l, task.wordId)!, now);
  };
  /** One chunk of `minutes`, as useSessionRunner runs it. Returns its active time. */
  const chunk = (minutes: number) => {
    const session = new Session(sessionPlan(l, minutes, true, now), minutes * 60_000);
    let active = 0;
    // A new word's card time goes with its quick check's answer, as in the app.
    const introMs = new Map<string, number>();
    for (let task = session.next(active); task; task = session.next(active)) {
      const ms = spread(task.kind === "intro" ? COSTS.intro - COSTS.read : COSTS[task.skill]);
      active += ms;
      now += ms;
      if (task.kind === "intro") {
        introMs.set(task.wordId, ms);
        session.report(task, {});
        continue;
      }
      const grade = random() < chance(task) ? 3 : 1;
      // ?? 0: no card of its own before this answer (anything but a quick check).
      const duration = Math.round(ms + (introMs.get(task.wordId) ?? 0));
      introMs.delete(task.wordId);
      const id = `r${reviews++}`;
      review.insert(id, { id, user_id: "u", lang, word_id: task.wordId, skill: task.skill, grade, kind: "review", reviewed_at: new Date(now).toISOString(), duration_ms: duration, sentence_id: null });
      // !: built once already, so every later get() is at once.
      l = learners.get(lang, deck)!;
      session.report(task, { grade });
    }
    return active;
  };

  const days: TraceDay[] = [];
  let known = new Set<string>();
  let brought = new Set<GardenWord>();
  let doorDay: number | null = null;
  for (let day = 1; day <= maxDays && doorDay === null; day++) {
    const date = new Date(START.year, START.month, START.date + day - 1, PRACTICE_HOUR);
    if (!practises(pattern, day, date.getDay())) continue;
    now = date.getTime();
    let active = 0;
    // Today: chunks until the day's minutes are done, as Home offers them.
    for (let c = nextChunk(l, now); c.state !== "done"; c = nextChunk(l, now)) {
      const before = reviews;
      active += chunk(c.minutes);
      if (reviews === before) throw new Error(`day ${day}: a chunk with no answers`);
    }
    if (pattern === "more") active += chunk(nextChunk(l, now).minutes);
    const after = runAll(knownWords(l.studied, l.memory));
    const garden = gardenBrought(l);
    const gained = [...after.lemmas].filter((w) => !known.has(w)).sort();
    const lost = [...known].filter((w) => !after.lemmas.has(w)).sort();
    const came = [...garden].filter((g) => !brought.has(g)).sort();
    days.push({ day, minutes: Math.round(active / 6_000) / 10, known: after.count, ...(gained.length ? { gained } : {}), ...(lost.length ? { lost } : {}), ...(came.length ? { brought: came } : {}) });
    known = after.lemmas;
    brought = garden;
    if (after.count >= door) doorDay = day;
  }
  return { lang, pattern, seed, start: startAt.toISOString().slice(0, 10), words: deck.words.length, door, doorDay, days };
}
