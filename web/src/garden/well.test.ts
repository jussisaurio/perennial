import { describe, expect, test } from "bun:test";
import { echo, echoDate, type Met } from "./well";

// Noon, 17 October 2026, local time: the walk opened then.
const NOW = new Date(2026, 9, 17, 12).getTime();
/** A word met `days` calendar days before NOW, in the morning. */
const met = (lemma: string, days: number): Met => ({ lemma, at: new Date(2026, 9, 17 - days, 9).getTime() });
/** What the echo says for the first `drops` pebbles of a visit. */
const echoes = (log: Met[], drops = 40, now = NOW) => Array.from({ length: drops }, (_, n) => echo(log, now, n)!.lemma);

describe("the well's echo (#335 S6)", () => {
  test("no words yet: no echo", () => {
    expect(echo([], NOW, 0)).toBeNull();
  });

  test("a few days of words: always the very first word", () => {
    const log = [met("perro", 2), met("casa", 4), met("gato", 0)];
    expect(new Set(echoes(log))).toEqual(new Set(["casa"]));
  });

  test("a week back: only words met a week or more ago", () => {
    const log = [met("casa", 12), met("perro", 7), met("gato", 6), met("sol", 1)];
    expect(new Set(echoes(log))).toEqual(new Set(["casa", "perro"]));
  });

  test("a month back: only words met a month or more ago, once there are some", () => {
    const log = [met("casa", 200), met("perro", 45), met("gato", 29), met("sol", 8)];
    expect(new Set(echoes(log))).toEqual(new Set(["casa", "perro"]));
  });

  test("a year back: only words met a year or more ago", () => {
    const log = [met("casa", 400), met("perro", 365), met("gato", 300), met("sol", 40)];
    expect(new Set(echoes(log))).toEqual(new Set(["casa", "perro"]));
  });

  test("calendar days: a word met late last night is a day old this morning", () => {
    const late = { lemma: "casa", at: new Date(2026, 9, 9, 23, 30).getTime() };
    const morning = new Date(2026, 9, 16, 7).getTime();
    // Not quite 7 × 24 hours, but seven calendar days: a week back, so "perro" (met 6 days before) is not heard.
    expect(new Set(echoes([late, { lemma: "perro", at: new Date(2026, 9, 10, 9).getTime() }], 40, morning))).toEqual(new Set(["casa"]));
  });

  test("each drop and each visit picks again; the same drop of the same visit says the same word", () => {
    const log = Array.from({ length: 20 }, (_, i) => met(`w${i}`, 40 + i));
    expect(new Set(echoes(log, 10)).size).toBeGreaterThan(3);
    expect(echoes(log, 10)).not.toEqual(echoes(log, 10, NOW + 60_000));
    expect(echoes(log, 10)).toEqual(echoes(log, 10));
    // The order the words come in does not matter.
    expect(echoes([...log].reverse(), 10)).toEqual(echoes(log, 10));
  });

  test("the date: day and month, and the year when it was another year", () => {
    expect(echoDate(met("casa", 5).at, NOW)).toBe("12 October");
    expect(echoDate(met("casa", 400).at, NOW)).toBe("12 September 2025");
  });
});
