import { describe, expect, test } from "bun:test";
import { DAY_MS } from "../core/day";
import { fsrs } from "../core/scheduler";
import { NEW_WORD_MS } from "../core/session";
import type { Grade } from "../core/fsrs";
import type { Skill } from "../data/rows";
import { report, type StoredCourse, type StoredReview } from "./report";

// Noon UTC: the same local day in every time zone from UTC-11 to UTC+11.
const day = (n: number, hours = 0) => Date.UTC(2026, 0, 5, 12) + n * DAY_MS + hours * 3_600_000;
const NOW = day(30);

let ids = 0;
function review(word: string, at: number, grade: Grade, more: Partial<StoredReview> = {}): StoredReview {
  const iso = new Date(at).toISOString();
  return { id: `r${ids++}`, word_id: word, skill: "read" as Skill, grade, kind: "review", reviewed_at: iso, duration_ms: 5_000, received_at: iso, ...more };
}

function course(reviews: StoredReview[], more: Partial<StoredCourse> = {}): StoredCourse {
  return { user_id: "0123456789abcdef", lang: "es", retention: 0.9, reviews, resolve: (id) => (id === "alias" ? "a" : id), notes: [], notesRead: [], noteReads: [], ...more };
}

describe("calibration: FSRS's prediction before each answer against the answer", () => {
  test("an answer at the word's stability is predicted at 0.9; first answers and 'Already know it' have no prediction", () => {
    // FSRS's forgetting curve passes 0.9 when the days since the last answer equal the stability.
    const s = fsrs.init(3).s;
    const later = day(0) + s * DAY_MS;
    const r = report(
      [
        course([
          review("a", day(0), 3),
          review("b", day(0), 3),
          review("c", day(0), 3),
          // "alias" is word a under another id: its memory is a's. Hard (2) is remembered too.
          review("alias", later, 2),
          review("b", later, 1),
          review("c", later, 4, { kind: "known" }),
        ]),
      ],
      NOW,
    );
    const c = r.calibration;
    expect(c.all.n).toBe(2);
    expect(c.all.predicted).toBeCloseTo(0.9, 6);
    expect(c.all.actual).toBe(0.5);
    expect(c.all.bias).toBeCloseTo(-0.4, 6);
    expect(c.all.ece).toBeCloseTo(0.4, 6);
    expect(c.sameDay.n).toBe(0);
    expect(c.laterDay.n).toBe(2);
    expect(c.buckets).toEqual([{ from: 0.9, to: 0.95, n: 2, predicted: c.all.predicted, actual: 0.5 }]);
    expect(c.bySkill.read?.n).toBe(2);
  });

  test("an answer a minute after the last one is predicted near 1, and counted as under a day", () => {
    const r = report([course([review("a", day(0), 3), review("a", day(0) + 60_000, 3)])], NOW);
    expect(r.calibration.sameDay.n).toBe(1);
    expect(r.calibration.all.predicted).toBeGreaterThan(0.99);
    expect(r.calibration.all.actual).toBe(1);
  });
});

describe("practice days: minutes, visits and the days between", () => {
  test("a new word counts at least its planned time, as Today counts it; 5 minutes is a done day", () => {
    const r = report(
      [
        course([
          // Day 0: five new words, a minute each: the day's 5 minutes.
          ...["a", "b", "c", "d", "e"].map((w, i) => review(w, day(0) + i * 60_000, 3, { duration_ms: 60_000 })),
          // Day 1: an old word for 30 s and a new word in 1 s, which counts as NEW_WORD_MS.
          review("a", day(1), 3, { duration_ms: 30_000 }),
          review("f", day(1) + 30_000, 3, { duration_ms: 1_000 }),
        ]),
      ],
      NOW,
    );
    const k = r.courses[0]!;
    expect(k.practiceDays).toBe(2);
    expect(k.daysDone).toBe(1);
    expect(k.daysShort).toBe(1);
    const short = (30_000 + NEW_WORD_MS) / 60_000;
    expect(k.minutes.median).toBeCloseTo((5 + short) / 2, 9);
  });

  test("gaps between practice days, visits split by 30 quiet minutes, and days since the last", () => {
    const r = report(
      [
        course([
          review("a", day(0), 3),
          review("a", day(0) + 10 * 60_000, 3), // the same visit
          review("a", day(0, 2), 3), // two hours later: a new visit
          review("a", day(1), 3),
          review("a", day(4), 3),
          review("a", day(15), 3),
        ]),
      ],
      day(17),
    );
    const k = r.courses[0]!;
    expect(k.visits).toBe(5);
    expect(k.gaps).toEqual({ n: 3, median: 3, max: 11, oneDay: 1, twoToSix: 1, weekOrMore: 1 });
    expect(k.daysSinceLast).toBe(2);
    expect(k.user).toBe("01234567");
  });
});

describe("courses left out", () => {
  test("a course whose answers reached the server weeks after they were made is a demo, and counted as left out", () => {
    const sent = new Date(NOW).toISOString();
    const demo = course([review("a", day(0), 3, { received_at: sent }), review("a", day(3), 3, { received_at: sent })]);
    const live = course([review("a", day(0), 3)]);
    const r = report([demo, live], NOW);
    expect(r.leftOutDemo).toBe(1);
    expect(r.courses.length).toBe(1);
    expect(r.calibration.all.n).toBe(0);
  });
});

describe("notes: when one comes and when it is read", () => {
  test("a note comes when the known count reaches its mark; the lag runs from then to its first read", () => {
    // Two "Easy" answers a day apart make a word known (stability over a week, two answers).
    const r = report(
      [
        course([review("a", day(0), 4), review("a", day(1), 4), review("b", day(0), 4), review("b", day(2), 4)], {
          notes: [
            { id: "one", unlockAt: 1 },
            { id: "two", unlockAt: 2 },
            { id: "three", unlockAt: 3 },
          ],
          notesRead: ["one", "two"],
          noteReads: [
            { note: "one", at: day(1, 2) }, // two hours after it came
            { note: "two", at: day(5) }, // three days after
          ],
        }),
      ],
      NOW,
    );
    const n = r.courses[0]!.notes;
    expect(n).toEqual({ came: 2, read: 2, timed: 2, sameDay: 1, medianLagDays: (2 / 24 + 3) / 2 });
  });
});
