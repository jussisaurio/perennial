import { describe, expect, test } from "bun:test";
import { createEmptyCard, fsrs as tsFsrs, Rating, type Grade as TsGrade } from "ts-fsrs";
import { DAY_MS } from "./day";
import { FSRS, replay, type Grade } from "./fsrs";

const f = new FSRS();

describe("FSRS-6", () => {
  test("R(S, S) = 0.9 and interval at 0.9 equals S", () => {
    expect(f.retrievability(10, 10)).toBeCloseTo(0.9, 6);
    expect(f.interval(10, 0.9)).toBeCloseTo(10, 6);
  });

  test("higher retention means shorter intervals", () => {
    expect(f.interval(10, 0.95)).toBeLessThan(f.interval(10, 0.9));
  });

  test("initial state follows the weights", () => {
    expect(f.init(3).s).toBeCloseTo(2.3065, 4);
    expect(f.init(1).s).toBeCloseTo(0.212, 4);
  });

  test("matches ts-fsrs on a multi-day review sequence", () => {
    // Day-granular reviews with ts-fsrs short-term learning disabled, so both
    // implementations take the long-term path.
    const ref = tsFsrs({ enable_short_term: false, enable_fuzz: false });
    let card = createEmptyCard(new Date(2026, 0, 1));
    const seq: [number, Grade][] = [
      [0, 3],
      [3, 3],
      [10, 1],
      [12, 3],
      [20, 4],
      [60, 3],
    ];
    let m = f.init(seq[0][1]);
    card = ref.next(card, new Date(2026, 0, 1), seq[0][1] as TsGrade).card;
    for (let i = 1; i < seq.length; i++) {
      const [day, g] = seq[i];
      m = f.next(m, day - seq[i - 1][0], g);
      card = ref.next(card, new Date(2026, 0, 1 + day), g as unknown as TsGrade).card;
      expect(m.s).toBeCloseTo(card.stability, 2);
      expect(m.d).toBeCloseTo(card.difficulty, 2);
    }
    expect(Rating.Good).toBe(3);
  });

  test("forgetting reduces stability, same-day pass never reduces it", () => {
    const m = { s: 20, d: 5 };
    expect(f.next(m, 20, 1).s).toBeLessThan(20);
    expect(f.next(m, 0.01, 3).s).toBeGreaterThanOrEqual(20);
  });

  test("replay is order-independent and deterministic", () => {
    const t0 = Date.UTC(2026, 0, 1);
    const log = [
      { ts: t0, grade: 3 as Grade },
      { ts: t0 + 2 * DAY_MS, grade: 3 as Grade },
      { ts: t0 + 9 * DAY_MS, grade: 1 as Grade },
    ];
    const a = replay(f, log, 0.9, "x");
    const b = replay(f, [...log].reverse(), 0.9, "x");
    expect(a).toEqual(b);
    expect(a!.lapses).toBe(1);
    expect(a!.reps).toBe(3);
  });
});
