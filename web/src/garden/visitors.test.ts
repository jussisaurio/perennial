import { describe, expect, test } from "bun:test";
import { layout, type GardenPlant } from "./world";
import {
  catBreak,
  fencePickets,
  fencePoint,
  frogCroak,
  GNOME_CAUGHT,
  GNOME_TURN,
  gnomePose,
  gnomeTag,
  heronDay,
  learnerFacts,
  milestoneLine,
  MILESTONES,
  NO_FACTS,
  RARE_CAP,
  snailLap,
  PICKETS_PER_M,
  VISITORS,
  visitor,
  visitorsFor,
  visitorViews,
  welcomeBack,
  type LearnerFacts,
} from "./visitors";

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min).getTime();
const days = Array.from({ length: 365 }, (_, d) => new Date(2026, 0, 1 + d, 12));
const facts = (reviews: number[], now: number, known = 0) => learnerFacts(reviews, known, now, new Set());

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
  test("garden-word visitors come once their word is learned, every day, and do not count toward the cap (#209)", () => {
    const learned: LearnerFacts = { ...NO_FACTS, garden: new Set(["snail", "frog", "cat", "bird", "dog", "fish", "butterfly"]) };
    for (const d of days) {
      const none = visitorsFor(NO_FACTS, d).present;
      for (const id of ["snail", "frog", "bird", "dog", "fish", "butterfly"] as const) expect(none).not.toContain(id);
      const t = visitorsFor(learned, d).present;
      expect(t).toEqual(expect.arrayContaining(["snail", "frog", "cat", "bird", "dog", "fish", "butterfly"]));
      expect(t.filter((id) => visitor(id).rare).length).toBeLessThanOrEqual(RARE_CAP);
    }
    // One word, one visitor.
    expect(visitorsFor({ ...NO_FACTS, garden: new Set(["cat"]) }, days[0]).present.filter((id) => visitor(id).garden)).toEqual(["cat"]);
    expect(visitorsFor({ ...NO_FACTS, garden: new Set(["dog", "sun"]) }, days[0]).present.filter((id) => visitor(id).garden)).toEqual(["dog"]);
  });

  test("perro, pez and mariposa bring the dog, the fish and the butterfly, with their words (#209 phase B)", () => {
    for (const g of ["dog", "fish", "butterfly"] as const) {
      expect(VISITORS.find((d) => d.garden === g)?.id).toBe(g);
      expect(visitorsFor({ ...NO_FACTS, garden: new Set([g]) }, days[0]).present).toContain(g);
    }
    expect(visitorViews(["dog", "fish", "butterfly"], "es").map((v) => v.word)).toEqual(["el perro", "el pez", "la mariposa"]);
    expect(visitorViews(["dog", "fish", "butterfly"], "de").map((v) => v.word)).toEqual(["der Hund", "der Fisch", "der Schmetterling"]);
  });

  test("a visitor stays all day", () => {
    for (const d of days) {
      const morning = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 5);
      const night = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 55);
      expect(visitorsFor(NO_FACTS, morning)).toEqual(visitorsFor(NO_FACTS, night));
    }
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
    expect(visitorsFor(NO_FACTS, days[0], "all").present).toEqual(["snail", "gnome", "frog", "moth", "cat", "heron", "toadstool", "bird", "dog", "fish", "butterfly"]);
    expect(visitorsFor(NO_FACTS, days[0], ["cat"]).present).toEqual(["cat"]);
  });
});

describe("residents: the gnome, the frog and the moth", () => {
  const knows = (known: number) => ({ ...NO_FACTS, known });
  test("the gnome comes at 50 known words and stays; the frog with its word, or at 150 known words as before #209", () => {
    for (const d of days) {
      expect(visitorsFor(knows(49), d).present).not.toContain("gnome");
      expect(visitorsFor(knows(50), d).present).toContain("gnome");
      expect(visitorsFor(knows(149), d).present).not.toContain("frog");
      expect(visitorsFor(knows(150), d).present).toContain("frog"); // a learner who had it keeps it
      expect(visitorsFor({ ...NO_FACTS, garden: new Set(["frog"]) }, d).present).toContain("frog");
      // The moth is at its lantern every evening (the walk shows it at dusk and night only).
      expect(visitorsFor(NO_FACTS, d).present).toContain("moth");
    }
  });

  test("residents do not count toward the cap: two rare visitors can still come", () => {
    const f: LearnerFacts = { ...knows(500), firstReview: days[0].getTime() - 400 * 86_400_000, garden: new Set(["snail", "frog", "cat", "bird"]) };
    let both = 0;
    for (const d of days) {
      const t = visitorsFor({ ...f, lastBeforeToday: d.getTime() - 10 * 86_400_000 }, d);
      expect(t.present).toEqual(expect.arrayContaining(["snail", "gnome", "frog", "moth", "cat"]));
      const rare = t.present.filter((id) => visitor(id).rare);
      expect(rare.length).toBeLessThanOrEqual(RARE_CAP);
      if (rare.length === 2) both++;
    }
    // The rare ones now are the heron (a day a month) and the mushroom (about a day a week): some days bring both.
    expect(both).toBeGreaterThan(0);
  });
});

describe("the heron (one day a month)", () => {
  test("exactly one day in each month, the same for everyone, and it stays all day", () => {
    for (let m = 0; m < 24; m++) {
      const y = 2026 + Math.floor(m / 12);
      const month = m % 12;
      const len = new Date(y, month + 1, 0).getDate();
      const on = Array.from({ length: len }, (_, i) => new Date(y, month, i + 1, 9)).filter((d) => visitor("heron").schedule({ facts: NO_FACTS, now: d }));
      expect(on.length).toBe(1);
      expect(on[0].getDate()).toBe(heronDay(y, month));
      expect(visitor("heron").schedule({ facts: NO_FACTS, now: new Date(y, month, heronDay(y, month), 23, 50) })).toBe(true);
    }
  });

  test("not always the same day of the month", () => {
    const set = new Set(Array.from({ length: 12 }, (_, m) => heronDay(2026, m)));
    expect(set.size).toBeGreaterThan(4);
  });

  test("on its day it comes, before the toadstool", () => {
    const d = new Date(2026, 4, heronDay(2026, 4), 12);
    expect(visitorsFor(NO_FACTS, d).present).toContain("heron");
    expect(visitorsFor(NO_FACTS, d).present.filter((id) => visitor(id).rare)[0]).toBe("heron");
  });
});

describe("the gnome plays statues", () => {
  test("faces you while you look; looks away when you don't; caught for a moment when you look back", () => {
    expect(gnomePose("front", true, 0, 5)).toBe("front");
    expect(gnomePose("front", false, 1, 0)).toBe("front"); // a quick glance away is not enough
    expect(gnomePose("front", false, GNOME_TURN + 0.1, 0)).toBe("side");
    expect(gnomePose("side", true, 0, 0.2)).toBe("side"); // caught
    expect(gnomePose("side", true, 0, GNOME_CAUGHT + 0.1)).toBe("front");
  });

  test("its name shows only while it faces you", () => {
    expect(gnomeTag("front")).toBe(1);
    expect(gnomeTag("side")).toBe(0);
  });
});

describe("the frog's croak", () => {
  const now = new Date(2026, 9, 11, 20);
  test("its sound, then one word the learner knows", () => {
    expect(frogCroak(["casa"], "es", 0, now)).toBe("croac… casa");
    expect(frogCroak(["Haus"], "de", 3, now)).toBe("quak… Haus");
  });

  test("never its own name, in any case", () => {
    for (let tap = 0; tap < 50; tap++) {
      expect(frogCroak(["rana", "casa", "Rana"], "es", tap, now)).toBe("croac… casa");
      expect(frogCroak(["Frosch", "Haus"], "de", tap, now)).toBe("quak… Haus");
    }
    expect(frogCroak(["rana"], "es", 0, now)).toBe("croac…");
    expect(frogCroak([], "es", 0, now)).toBe("croac…");
  });

  test("different words over a few taps, the same order all day", () => {
    const known = ["casa", "perro", "agua", "sol", "mesa", "libro", "calle", "noche"];
    const said = new Set(Array.from({ length: 12 }, (_, i) => frogCroak(known, "es", i, now)));
    expect(said.size).toBeGreaterThan(3);
    for (const w of said) expect(known).toContain(w.replace("croac… ", ""));
    expect(frogCroak(known, "es", 5, new Date(2026, 9, 11, 23))).toBe(frogCroak(known, "es", 5, now));
  });
});

describe("the milestone line", () => {
  test("only on the day a milestone is crossed", () => {
    expect(milestoneLine(49, 50)).toBe("You know 50 words. Someone has arrived in the garden.");
    expect(milestoneLine(40, 55)).toBe("You know 50 words. Someone has arrived in the garden.");
    expect(milestoneLine(50, 52)).toBeNull(); // crossed on an earlier day
    expect(milestoneLine(30, 30)).toBeNull();
    expect(milestoneLine(0, 0)).toBeNull();
    // Words forgotten today: no line.
    expect(milestoneLine(51, 49)).toBeNull();
  });

  test("the gnome's count says someone arrived too; other counts only notice", () => {
    expect(milestoneLine(49, 50)).toBe("You know 50 words. Someone has arrived in the garden.");
    expect(milestoneLine(149, 150)).toBe("You know 150 words. The garden noticed.");
    expect(milestoneLine(24, 25)).toBe("You know 25 words. The garden noticed.");
    expect(milestoneLine(99, 101)).toBe("You know 100 words. The garden noticed.");
    expect(milestoneLine(498, 503)).toBe("You know 500 words. The garden noticed.");
    // Two at once (a big import): the higher one.
    expect(milestoneLine(20, 60)).toBe("You know 50 words. Someone has arrived in the garden.");
  });

  test("plain and calm: no exclamation marks", () => {
    for (const m of MILESTONES) expect(milestoneLine(m - 1, m)).not.toMatch(/!/);
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
    // Said on Today, which has no bench: the line makes sense on its own (#270).
    expect(away(7)).toBe("Welcome back. A cat sat in the garden while you were away.");
    expect(away(30)).toBe("Welcome back. A cat sat in the garden while you were away.");
    expect(away(90)).toBe("Welcome back. The garden waited for you.");
    for (const n of [7, 30, 90]) {
      expect(away(n)).not.toMatch(/\d|!|miss/i);
    }
    // Not on the day after coming back.
    const reviews = [at(2026, 5, 1), at(2026, 5, 29)];
    expect(welcomeBack(facts(reviews, now), new Date(now))).toBeNull();
  });
});

describe("the snail's daily lap", () => {
  const plant = (i: number): GardenPlant => ({ id: `w${i}`, lemma: `w${i}`, gloss: "", pos: i % 2 ? "noun" : "verb", rank: i, s: 10, r: 0.9, stage: "bud", growth: 0.5, listen: false, write: false });
  const l = layout(Array.from({ length: 80 }, (_, i) => plant(i)));
  const pickets = fencePickets(l);

  test("one lap a day: at the gate at midnight, halfway at noon, nearly round by night", () => {
    expect(snailLap(new Date(2026, 2, 1, 0, 0))).toBe(0);
    expect(snailLap(new Date(2026, 2, 1, 12, 0))).toBeCloseTo(0.5, 5);
    expect(snailLap(new Date(2026, 2, 1, 23, 59))).toBeGreaterThan(0.99);
    expect(snailLap(new Date(2026, 2, 1, 23, 59, 59, 999))).toBeLessThan(1);
  });

  test("about snail speed: a millimetre or so a second", () => {
    const metresPerSecond = pickets / PICKETS_PER_M / 86_400;
    expect(metresPerSecond).toBeGreaterThan(0.0002);
    expect(metresPerSecond).toBeLessThan(0.005);
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
});
