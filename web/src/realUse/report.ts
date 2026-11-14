// What real practice says (#984): FSRS's predicted recall against what
// happened, how often a learner comes back, how much of the day's minutes
// they do, and how soon they read a note once it comes. Pure: cli.ts reads the
// rows from a database. docs/real-use.md says how to read the numbers.

import { dayNumber, DAY_MS } from "../core/day";
import { memKey, MemoryLog, recall, wordState } from "../core/memory";
import { countedMs, dayDone } from "../data/practice";
import type { ReviewRow } from "../data/rows";

/** A review as stored, with when the server got it. */
export type StoredReview = Pick<ReviewRow, "id" | "word_id" | "skill" | "grade" | "kind" | "reviewed_at" | "duration_ms"> & { received_at: string };

export interface StoredCourse {
  user_id: string;
  lang: string;
  retention: number;
  reviews: readonly StoredReview[];
  /** A word id to the word its memory is kept under: deck aliases and the learner's own words linked to the deck (data/learner.ts links). */
  resolve: (id: string) => string;
  /** The course's notes and the known count at which each comes (garden/notes). */
  notes: readonly { id: string; unlockAt: number }[];
  /** course.notes_read: every note read, also from before reads had times. */
  notesRead: readonly string[];
  /** When each note was first read (use_event, since #984). */
  noteReads: readonly { note: string; at: number }[];
}

/** A new visit starts after this long with no answer. */
const VISIT_GAP_MS = 30 * 60_000;
/** A review that reached the server this long after it was made was not made live: a demo course writes its whole made-up history at once (server/src/demo.ts). */
const LATE_MS = DAY_MS;
/** Edges of the calibration buckets, by predicted recall. Narrow near the top, where most reviews are. */
const EDGES = [0, 0.5, 0.7, 0.8, 0.85, 0.9, 0.95, 1];

interface Calibration {
  /** Reviews with a prediction. */
  n: number;
  /** Mean predicted recall. */
  predicted: number;
  /** Share remembered. */
  actual: number;
}

interface CalibrationReport {
  all: Calibration & { bias: number; ece: number };
  /** Since the word's last answer: under a day (the same session or day), or a day or more (a real wait). */
  sameDay: Calibration;
  laterDay: Calibration;
  bySkill: Partial<Record<ReviewRow["skill"], Calibration>>;
  buckets: (Calibration & { from: number; to: number })[];
}

interface CourseReport {
  /** The first 8 characters of the user id: enough to tell learners apart. */
  user: string;
  lang: string;
  reviews: number;
  firstDay: string;
  lastDay: string;
  daysSinceLast: number;
  practiceDays: number;
  visits: number;
  /** Whole days from one practice day to the next: 1 is the next day. */
  gaps: { n: number; median: number | null; max: number | null; oneDay: number; twoToSix: number; weekOrMore: number };
  /** Per practice day, counted as Today counts them (data/practice.ts countedMs). */
  minutes: { median: number; mean: number };
  /** Practice days that reached the day's minutes, and days stopped short of them. */
  daysDone: number;
  daysShort: number;
  notes: NotesReport;
}

interface NotesReport {
  /** Notes that came: the known count reached their unlockAt. */
  came: number;
  read: number;
  /** Reads with a time (use_event), and of those, how many on the day the note came. */
  timed: number;
  sameDay: number;
  /** Median days from a note coming to its first read. */
  medianLagDays: number | null;
}

export interface Report {
  generatedAt: string;
  timeZone: string;
  courses: CourseReport[];
  /** Courses left out: most of their reviews reached the server over a day late, the mark of a demo. */
  leftOutDemo: number;
  calibration: CalibrationReport;
}

const ts = (iso: string) => Date.parse(iso);

function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  // !: both indexes are inside a non-empty list.
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A demo course: most of its reviews were not sent as they were made. */
function isDemo(c: Pick<StoredCourse, "reviews">): boolean {
  const late = c.reviews.filter((r) => ts(r.received_at) - ts(r.reviewed_at) > LATE_MS).length;
  return late * 2 > c.reviews.length;
}

type Prediction = { p: number; remembered: boolean; skill: ReviewRow["skill"]; elapsed: number };

/**
 * Replays one course in time order. Before each answer it notes what FSRS
 * predicted for it (a word and skill with an earlier answer; "Already know
 * it" is no test of recall), and after it, the known count.
 */
function replayCourse(c: StoredCourse): { predictions: Prediction[]; knownAt: { at: number; count: number }[] } {
  const log = new MemoryLog(c.retention, c.resolve);
  const sorted = [...c.reviews].sort((a, b) => ts(a.reviewed_at) - ts(b.reviewed_at));
  const predictions: Prediction[] = [];
  const knownAt: { at: number; count: number }[] = [];
  const known = new Set<string>();
  for (const r of sorted) {
    const at = ts(r.reviewed_at);
    const word = c.resolve(r.word_id);
    const before = log.get(memKey(word, r.skill));
    if (r.kind === "review" && before?.reps) predictions.push({ p: recall(before, at), remembered: r.grade > 1, skill: r.skill, elapsed: at - before.lastTs });
    log.set({ ...r, user_id: c.user_id, lang: c.lang, sentence_id: null });
    log.rows();
    const isKnown = wordState(log.get(memKey(word, "read"))) === "known";
    const size = known.size;
    if (isKnown) known.add(word);
    else known.delete(word);
    if (known.size !== size) knownAt.push({ at, count: known.size });
  }
  return { predictions, knownAt };
}

function calibrate(ps: readonly Prediction[]): Calibration {
  const n = ps.length;
  if (!n) return { n, predicted: 0, actual: 0 };
  return { n, predicted: ps.reduce((a, x) => a + x.p, 0) / n, actual: ps.filter((x) => x.remembered).length / n };
}

function calibration(ps: readonly Prediction[]): CalibrationReport {
  const all = calibrate(ps);
  const buckets = EDGES.slice(1).map((to, i) => {
    // !: i + 1 edges come before `to`.
    const from = EDGES[i]!;
    // The top bucket holds a prediction of exactly 1.
    return { from, to, ...calibrate(ps.filter((x) => x.p >= from && (x.p < to || (to === 1 && x.p === 1)))) };
  });
  const ece = all.n ? buckets.reduce((a, b) => a + (b.n / all.n) * Math.abs(b.actual - b.predicted), 0) : 0;
  const bySkill: CalibrationReport["bySkill"] = {};
  for (const skill of ["read", "listen", "write"] as const) {
    const of = ps.filter((x) => x.skill === skill);
    if (of.length) bySkill[skill] = calibrate(of);
  }
  return {
    all: { ...all, bias: all.actual - all.predicted, ece },
    sameDay: calibrate(ps.filter((x) => x.elapsed < DAY_MS)),
    laterDay: calibrate(ps.filter((x) => x.elapsed >= DAY_MS)),
    bySkill,
    buckets: buckets.filter((b) => b.n),
  };
}

function notesOf(c: StoredCourse, knownAt: readonly { at: number; count: number }[]): NotesReport {
  const cameAt = new Map<string, number>();
  for (const n of c.notes) {
    // The first time the known count reached the note's mark: it hangs in the shed from then.
    const hit = knownAt.find((k) => k.count >= n.unlockAt);
    if (hit) cameAt.set(n.id, hit.at);
  }
  const lags: number[] = [];
  let sameDay = 0;
  for (const r of c.noteReads) {
    const came = cameAt.get(r.note);
    // A read of a note that never came by this count: a retune moved it past the learner (garden/notes/read.ts). No lag to tell.
    if (came === undefined) continue;
    lags.push((r.at - came) / DAY_MS);
    if (dayNumber(r.at) === dayNumber(came)) sameDay++;
  }
  return { came: cameAt.size, read: c.notesRead.length, timed: lags.length, sameDay, medianLagDays: median(lags) };
}

function courseReport(c: StoredCourse, knownAt: readonly { at: number; count: number }[], now: number): CourseReport {
  const sorted = [...c.reviews].sort((a, b) => ts(a.reviewed_at) - ts(b.reviewed_at));
  const seen = new Set<string>();
  const perDay = new Map<number, number>();
  let visits = 0;
  let last = -Infinity;
  for (const r of sorted) {
    const at = ts(r.reviewed_at);
    if (at - last > VISIT_GAP_MS) visits++;
    last = at;
    const word = c.resolve(r.word_id);
    const day = dayNumber(at);
    // ?? 0: the day's first answer.
    perDay.set(day, (perDay.get(day) ?? 0) + countedMs(r.duration_ms, !seen.has(word)));
    seen.add(word);
  }
  const days = [...perDay.keys()].sort((a, b) => a - b);
  const gaps = days.slice(1).map((d, i) => d - days[i]!); // !: i is inside days
  const ms = [...perDay.values()];
  const done = ms.filter(dayDone).length;
  // !: a course in the report has reviews (report() skips the others).
  const first = ts(sorted[0]!.reviewed_at);
  const lastAt = ts(sorted.at(-1)!.reviewed_at);
  return {
    user: c.user_id.slice(0, 8),
    lang: c.lang,
    reviews: sorted.length,
    firstDay: new Date(first).toISOString().slice(0, 10),
    lastDay: new Date(lastAt).toISOString().slice(0, 10),
    daysSinceLast: dayNumber(now) - dayNumber(lastAt),
    practiceDays: days.length,
    visits,
    gaps: {
      n: gaps.length,
      median: median(gaps),
      max: gaps.length ? Math.max(...gaps) : null,
      oneDay: gaps.filter((g) => g === 1).length,
      twoToSix: gaps.filter((g) => g >= 2 && g <= 6).length,
      weekOrMore: gaps.filter((g) => g >= 7).length,
    },
    // !: a course with reviews has a practice day.
    minutes: { median: median(ms)! / 60_000, mean: ms.reduce((a, b) => a + b, 0) / ms.length / 60_000 },
    daysDone: done,
    daysShort: ms.length - done,
    notes: notesOf(c, knownAt),
  };
}

/** The report over every course with reviews, as of `now` (ms). Days are local days in the process's time zone. */
export function report(all: readonly StoredCourse[], now: number): Report {
  const courses = all.filter((c) => c.reviews.length);
  const live = courses.filter((c) => !isDemo(c));
  const predictions: Prediction[] = [];
  const reports = live.map((c) => {
    const r = replayCourse(c);
    predictions.push(...r.predictions);
    return courseReport(c, r.knownAt, now);
  });
  return {
    generatedAt: new Date(now).toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    courses: reports,
    leftOutDemo: courses.length - live.length,
    calibration: calibration(predictions),
  };
}

/** Below this many, a rate moves a lot with each new answer: the text says so. */
const THIN = 100;

const f = (x: number) => x.toFixed(3);
const signed = (x: number) => (x >= 0 ? "+" : "") + f(x);
const line = (label: string, c: Calibration) =>
  `  ${label.padEnd(14)} n=${String(c.n).padEnd(6)}${c.n ? ` predicted ${f(c.predicted)}  remembered ${f(c.actual)}  (${signed(c.actual - c.predicted)})` : ""}${c.n && c.n < THIN ? "  thin" : ""}`;

/** The report as short text: a count next to every rate. */
export function text(r: Report): string {
  const c = r.calibration;
  const out = [
    `Real use as of ${r.generatedAt} (days are local days in ${r.timeZone})`,
    `${r.courses.length} course(s) in the report; ${r.leftOutDemo} left out as demos (most answers reached the server over a day late).`,
    `"thin": under ${THIN} answers, so the rate moves a lot with each new one.`,
    "",
    `FSRS calibration: predicted recall at each answer against what happened (remembered − predicted in brackets).`,
    `Expected calibration error ${f(c.all.ece)}.`,
    line("all", c.all),
    line("under a day", c.sameDay),
    line("a day or more", c.laterDay),
    ...(["read", "listen", "write"] as const).flatMap((s) => {
      const of = c.bySkill[s];
      return of ? [line(s, of)] : [];
    }),
    "  by predicted recall:",
    ...c.buckets.map((b) => line(`${b.from.toFixed(2)}–${b.to.toFixed(2)}`, b)),
  ];
  for (const k of r.courses) {
    const g = k.gaps;
    const n = k.notes;
    out.push(
      "",
      `Course ${k.lang}, user ${k.user}: ${k.reviews} answers, ${k.firstDay} to ${k.lastDay}, last practice ${k.daysSinceLast} day(s) ago.`,
      `  practice days ${k.practiceDays}, visits ${k.visits} (a new visit after 30 minutes with no answer)`,
      // ?? "-": one practice day has no gap.
      `  days to the next practice day: n=${g.n}, median ${g.median ?? "-"}, longest ${g.max ?? "-"}; next day ${g.oneDay}, 2–6 days ${g.twoToSix}, a week or more ${g.weekOrMore}`,
      `  minutes a practice day (as Today counts them): median ${k.minutes.median.toFixed(1)}, mean ${k.minutes.mean.toFixed(1)}`,
      `  reached the day's minutes on ${k.daysDone} of ${k.practiceDays} days; stopped short on ${k.daysShort}`,
      `  notes: ${n.came} came, ${n.read} read; ${n.timed} reads with a time, ${n.sameDay} of them on the day the note came, median ${n.medianLagDays === null ? "-" : n.medianLagDays.toFixed(1)} days after it came`,
    );
  }
  return out.join("\n");
}
