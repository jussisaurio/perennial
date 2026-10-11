import { describe, expect, test } from "bun:test";
import { layout, type GardenPlant } from "./world";
import {
  catBreak,
  dayNumber,
  fencePickets,
  fencePoint,
  learnerFacts,
  NO_FACTS,
  RARE_CAP,
  snailFraction,
  snailPicket,
  VISITORS,
  visitor,
  visitorsFor,
  visitorViews,
  welcomeBack,
  type LearnerFacts,
} from "./visitors";

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min).getTime();
const days = Array.from({ length: 365 }, (_, d) => new Date(2026, 0, 1 + d, 12));
const facts = (reviews: number[], now: number, known = 0) => learnerFacts(reviews, known, now);

describe("visitor words", () => {
  test("every visitor has a Spanish and a German word with its article, and a plain gloss", () => {
    for (const v of VISITORS) {
      expect(v.words.es).toMatch(/^(el|la) \p{L}+$/u);
      expect(v.words.de).toMatch(/^(der|die|das) \p{Lu}\p{L}+$/u);
      expect(v.gloss).toMatch(/^[a-z]+$/);
    }
  });

  test("a visitor whose noun the learner knows is marked, checked without the article", () => {
    const known = new Set(["gato"]);
    const views = visitorViews(["snail", "cat"], "es", (n) => known.has(n));
    expect(views.map((v) => [v.word, v.known])).toEqual([
      ["el caracol", false],
      ["el gato", true],
    ]);
    // A course with no visitor words: the animals still come, without a tag.
    expect(visitorViews(["snail"], "fr")[0]).toMatchObject({ word: null, known: false });
  });
});

describe("who visits today", () => {
  test("the snail is always there and does not count toward the cap", () => {
    for (const d of days) {
      const t = visitorsFor(NO_FACTS, d);
      expect(t.present[0]).toBe("snail");
      expect(t.present.filter((id) => visitor(id).rare).length).toBeLessThanOrEqual(RARE_CAP);
    }
  });

  test("a visitor stays all day", () => {
    for (const d of days) {
      const morning = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 5);
      const night = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 55);
      expect(visitorsFor(NO_FACTS, morning)).toEqual(visitorsFor(NO_FACTS, night));
    }
  });

  test("the bird comes about one day in two", () => {
    const n = days.filter((d) => visitorsFor(NO_FACTS, d).present.includes("bird")).length;
    expect(n).toBeGreaterThan(365 * 0.35);
    expect(n).toBeLessThan(365 * 0.65);
  });

  test("the toadstool comes about one day in seven, and more often in autumn", () => {
    const has = (d: Date) => visitorsFor(NO_FACTS, d).present.includes("toadstool");
    const autumn = days.filter((d) => d.getMonth() >= 8 && d.getMonth() <= 10);
    const rest = days.filter((d) => d.getMonth() < 8 || d.getMonth() > 10);
    const a = autumn.filter(has).length / autumn.length;
    const r = rest.filter(has).length / rest.length;
    expect(r).toBeGreaterThan(0.06);
    expect(r).toBeLessThan(0.25);
    expect(a).toBeGreaterThan(0.2);
    expect(a).toBeLessThan(0.5);
  });

  test("never more than two rare visitors: the cat stays, the last one waits", () => {
    // Away for ten days: the cat is there every day; toadstool and bird share the rest.
    for (const d of days) {
      const f: LearnerFacts = { ...NO_FACTS, firstReview: d.getTime() - 100 * 86_400_000, lastBeforeToday: d.getTime() - 10 * 86_400_000 };
      const t = visitorsFor(f, d);
      expect(t.present).toContain("cat");
      expect(t.present.filter((id) => visitor(id).rare).length).toBeLessThanOrEqual(RARE_CAP);
      if (t.present.includes("toadstool")) expect(t.present).not.toContain("bird");
    }
  });

  test("the dev override shows everyone, or only the ones asked for", () => {
    expect(visitorsFor(NO_FACTS, days[0], "all").present).toEqual(["snail", "cat", "toadstool", "bird"]);
    expect(visitorsFor(NO_FACTS, days[0], ["cat"]).present).toEqual(["cat"]);
  });
});

describe("the cat (after a break)", () => {
  const first = at(2026, 0, 1);
  test("not for a new learner, nor after a short break", () => {
    expect(catBreak(facts([], at(2026, 5, 1)), new Date(at(2026, 5, 1)))).toBeNull();
    const now = at(2026, 5, 10);
    expect(catBreak(facts([first, at(2026, 5, 6)], now), new Date(now))).toBeNull(); // 4 days
  });

  test("after 5 calendar days away, while still away, and on the day back", () => {
    const now = at(2026, 5, 10);
    const f = facts([first, at(2026, 5, 5, 23)], now);
    expect(catBreak(f, new Date(now))).toBe(5);
    expect(visitorsFor(f, new Date(now)).present).toContain("cat");
    // Back today: a review this morning does not send the cat away.
    const back = facts([first, at(2026, 5, 5), at(2026, 5, 10, 8)], now);
    expect(catBreak(back, new Date(now))).toBe(5);
  });

  test("leaves one day after the first session back", () => {
    const reviews = [first, at(2026, 5, 1), at(2026, 5, 12, 9)]; // back on the 12th after 11 days
    expect(catBreak(facts(reviews, at(2026, 5, 13)), new Date(at(2026, 5, 13)))).toBe(11);
    expect(catBreak(facts(reviews, at(2026, 5, 14)), new Date(at(2026, 5, 14)))).toBeNull();
    // Also if the learner practised again on the day after.
    const more = [...reviews, at(2026, 5, 13, 9)];
    expect(catBreak(facts(more, at(2026, 5, 14)), new Date(at(2026, 5, 14)))).toBeNull();
  });

  test("calendar days, not hours: late evening to early morning five days later counts", () => {
    const now = at(2026, 5, 10, 0);
    expect(catBreak(facts([at(2026, 5, 5, 23, 50)], now), new Date(now))).toBe(5);
  });

  test("the welcome line: kind, never a number, by break length", () => {
    const now = at(2026, 5, 30);
    const away = (n: number) => welcomeBack(facts([now - n * 86_400_000], now), new Date(now));
    expect(away(1)).toBeNull();
    expect(away(6)).toBeNull();
    expect(away(7)).toBe("Welcome back. A cat took the bench. It is fine.");
    expect(away(30)).toBe("Welcome back. A cat took the bench. It is fine.");
    expect(away(90)).toBe("Welcome back. The garden waited for you.");
    for (const n of [7, 30, 90]) {
      expect(away(n)).not.toMatch(/\d|!|miss/i);
    }
    // Not on the day after coming back.
    const reviews = [at(2026, 5, 1), at(2026, 5, 29)];
    expect(welcomeBack(facts(reviews, now), new Date(now))).toBeNull();
  });
});

describe("the snail's long trip", () => {
  const plant = (i: number): GardenPlant => ({ id: `w${i}`, lemma: `w${i}`, gloss: "", pos: i % 2 ? "noun" : "verb", rank: i, s: 10, r: 0.9, stage: "bud", growth: 0.5, listen: false, write: false });
  const l = layout(Array.from({ length: 80 }, (_, i) => plant(i)));
  const pickets = fencePickets(l);

  test("one picket per calendar day since the first review, starting at the gate", () => {
    const first = at(2026, 2, 1, 21);
    expect(visitorsFor(facts([first], at(2026, 2, 1, 23)), new Date(at(2026, 2, 1, 23))).snailDay).toBe(0);
    expect(visitorsFor(facts([first], at(2026, 2, 2, 7)), new Date(at(2026, 2, 2, 7))).snailDay).toBe(1);
    // Calendar days, not study days: a long break still moves it.
    expect(visitorsFor(facts([first], at(2026, 2, 15)), new Date(at(2026, 2, 15))).snailDay).toBe(14);
    // A new learner's snail waits at the gate.
    expect(visitorsFor(NO_FACTS, new Date()).snailDay).toBeNull();
  });

  test("wraps round after the length of the fence", () => {
    expect(snailPicket(0, pickets)).toBe(0);
    expect(snailPicket(pickets - 1, pickets)).toBe(pickets - 1);
    expect(snailPicket(pickets, pickets)).toBe(0);
    expect(snailPicket(pickets + 3, pickets)).toBe(3);
    expect(snailFraction(pickets / 2, pickets)).toBeCloseTo(0.5, 1);
  });

  test("the picket is on the fence, starting by the gate and going round", () => {
    const b = l.bounds;
    const start = fencePoint(l, 0);
    expect(start.z).toBe(b.maxZ);
    expect(Math.abs(start.x - l.gate.x)).toBeLessThan(1.5);
    for (let p = 0; p < pickets; p += 7) {
      const { x, z } = fencePoint(l, p);
      const onEdge = Math.abs(x - b.minX) < 1e-6 || Math.abs(x - b.maxX) < 1e-6 || Math.abs(z - b.minZ) < 1e-6 || Math.abs(z - b.maxZ) < 1e-6;
      expect(onEdge).toBe(true);
    }
    // Never in the gate opening.
    const last = fencePoint(l, pickets - 1);
    expect(last.x).toBeLessThan(l.gate.x - 1);
  });

  test("dayNumber counts calendar days across a clock change", () => {
    expect(dayNumber(at(2026, 2, 30, 1)) - dayNumber(at(2026, 2, 28, 23))).toBe(2);
  });
});
