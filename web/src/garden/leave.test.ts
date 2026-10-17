import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { dayNumber } from "../core/day";
import { basket, bowlNow, findAt, hang, leave, NO_LEFT, onBoard, pickUp, resolve, ROWS, walked, type Fruit, type LeaveFacts, type Left } from "./leave";
import { layout } from "./world";

// Calendar days in local time: pinned to a zone with a clock change, so the
// late-evening and DST cases below mean the same on every machine.
const zone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Madrid";
});
afterAll(() => {
  process.env.TZ = zone;
});

const NONE: LeaveFacts = { brought: {} };
/** 11 Oct 2026, local: the day the crumbs go in the bowl. */
const DAY = () => dayNumber(new Date(2026, 9, 11, 18, 0));
const crumbs = (day = DAY()): Left => leave(NO_LEFT, "crumbs", day);
const after = (nights: number, facts = NONE, left = crumbs()) => resolve(left, { day: left.bowl!.day + nights }, facts);

describe("resolve: the more nights away, the stranger the guest", () => {
  test("0 nights: nothing yet, the crumbs are still in the bowl", () => {
    expect(after(0)).toBeNull();
    expect(bowlNow(crumbs(), DAY(), NONE)).toEqual({ kind: "holds", thing: "crumbs" });
  });

  test("1 night: a sparrow, and a feather, a twig or a seed by the gate post", () => {
    expect(after(1)).toMatchObject({ row: { guest: "sparrow", at: "post" }, nights: 1 });
    expect(["feather", "twig", "seed"]).toContain(after(1)!.find);
    // Two nights are still the first tier.
    expect(after(2)?.row.guest).toBe("sparrow");
  });

  test("a learner who comes back every day does not find the same thing every time", () => {
    const finds = new Set(Array.from({ length: 30 }, (_, i) => after(1, NONE, crumbs(DAY() + i))!.find));
    expect([...finds].sort()).toEqual(["feather", "seed", "twig"]);
  });

  test("3 nights: the mouse, with an acorn or a button by the shed", () => {
    const o = after(3)!;
    expect(o.row).toMatchObject({ guest: "mouse", at: "shed" });
    expect(["acorn", "button"]).toContain(o.find);
  });

  test("14 nights: the hedgehog", () => {
    expect(after(14)).toMatchObject({ row: { guest: "hedgehog" }, find: "leaf" });
  });

  test("42 nights: the fox, and months away give nothing more", () => {
    expect(after(42)).toMatchObject({ row: { guest: "fox" }, find: "ribbon" });
    expect(after(400)?.row.guest).toBe("fox");
  });

  test("a longer gap never gives a lower tier", () => {
    let last = 0;
    for (let n = 1; n <= 60; n++) {
      const tier = after(n)!.row.nights;
      expect(tier).toBeGreaterThanOrEqual(last);
      last = tier;
    }
  });

  test("a fruit left gives the same tiers; the seed (day and thing) picks the variant, the same on every device", () => {
    const apple = leave(NO_LEFT, "es.w.apple1", DAY());
    expect(after(14, NONE, apple)?.row.guest).toBe("hedgehog");
    expect(after(3, NONE, apple)).toEqual(after(3, NONE, apple));
    // Over a month of days, both of the mouse's finds come up.
    const finds = new Set(Array.from({ length: 30 }, (_, i) => after(3, NONE, crumbs(DAY() + i))!.find));
    expect([...finds].sort()).toEqual(["acorn", "button"]);
  });
});

describe("resolve: who comes is who lives here", () => {
  test("the dog shares the mouse's tier once it lives in the garden; before that, its row is skipped", () => {
    const days = Array.from({ length: 40 }, (_, i) => DAY() + i);
    const guests = (facts: (day: number) => LeaveFacts) => new Set(days.map((d) => after(3, facts(d), crumbs(d))!.row.guest));
    // Never brought: only the mouse.
    expect(guests(() => NONE)).toEqual(new Set(["mouse"]));
    // Brought long before: the seed picks the mouse or the dog.
    expect(guests(() => ({ brought: { dog: DAY() - 100 } }))).toEqual(new Set(["mouse", "dog"]));
    // Brought after the night it would have come: not yet.
    expect(guests((d) => ({ brought: { dog: d + 4 } }))).toEqual(new Set(["mouse"]));
  });

  test("every tier has a row that needs nobody: day 1 works with no visitors", () => {
    for (const nights of [1, 3, 14, 42]) expect(ROWS.some((r) => r.nights === nights && !r.needs)).toBe(true);
  });
});

describe("the calendar day turns over at midnight, local time", () => {
  test("left just after midnight in a walk that opened the day before: the bowl holds it, with no night counted yet", () => {
    const opened = dayNumber(new Date(2026, 9, 11, 23, 58));
    const left = crumbs(dayNumber(new Date(2026, 9, 12, 0, 2)));
    expect(bowlNow(left, opened, NONE)).toEqual({ kind: "holds", thing: "crumbs" });
    expect(resolve(left, { day: opened + 1 }, NONE)).toBeNull();
    expect(resolve(left, { day: opened + 2 }, NONE)?.nights).toBe(1);
  });

  test("left late in the evening: one night by just after midnight, not before", () => {
    const late = crumbs(dayNumber(new Date(2026, 9, 11, 23, 59)));
    expect(resolve(late, { day: dayNumber(new Date(2026, 9, 11, 23, 59, 59)) }, NONE)).toBeNull();
    expect(resolve(late, { day: dayNumber(new Date(2026, 9, 12, 0, 1)) }, NONE)?.nights).toBe(1);
  });

  test("across the clock change (25 Oct in Madrid, a 25-hour day), nights are still calendar days", () => {
    const left = crumbs(dayNumber(new Date(2026, 9, 24, 22, 0)));
    expect(resolve(left, { day: dayNumber(new Date(2026, 9, 25, 23, 30)) }, NONE)?.nights).toBe(1);
    expect(resolve(left, { day: dayNumber(new Date(2026, 9, 26, 0, 30)) }, NONE)?.nights).toBe(2);
    // And spring's 23-hour day.
    const spring = crumbs(dayNumber(new Date(2027, 2, 27, 23, 0)));
    expect(resolve(spring, { day: dayNumber(new Date(2027, 2, 28, 0, 5)) }, NONE)?.nights).toBe(1);
    expect(resolve(spring, { day: dayNumber(new Date(2027, 2, 29, 0, 5)) }, NONE)?.nights).toBe(2);
  });
});

describe("nothing is lost: a find waits, the same, until it is picked up", () => {
  test("once the garden is walked after the night, the nights stop counting: the sparrow's find is still there weeks later", () => {
    const seen = walked(crumbs(), DAY() + 1)!;
    expect(seen.bowl!.seen).toBe(DAY() + 1);
    const first = resolve(seen, { day: DAY() + 1 }, NONE)!;
    expect(resolve(seen, { day: DAY() + 30 }, NONE)).toEqual(first);
    expect(first.row.guest).toBe("sparrow");
    // Walked again: nothing changes.
    expect(walked(seen, DAY() + 5)).toBeNull();
  });

  test("walking the garden on the same day changes nothing; nor does it after the find is picked up", () => {
    expect(walked(crumbs(), DAY())).toBeNull();
    const found = pickUp(walked(crumbs(), DAY() + 1)!, "feather");
    expect(walked(found, DAY() + 9)).toBeNull();
    expect(bowlNow(found, DAY() + 9, NONE)).toEqual({ kind: "empty" });
  });

  test("picked up, it is kept; it hangs on a hook the learner picks, and moves to another", () => {
    let l = pickUp(walked(crumbs(), DAY() + 1)!, "feather");
    expect(l.kept).toEqual(["feather"]);
    expect(onBoard(l)).toEqual(["feather"]);
    l = hang(l, 2, "feather");
    expect(l.hooks).toEqual([null, null, "feather"]);
    expect(onBoard(l)).toEqual([]);
    // Hung on another hook, it leaves the first; a thing hung over it goes back on the board.
    l = hang(l, 0, "feather");
    expect(l.hooks).toEqual(["feather", null, null]);
    l = { ...l, kept: [...l.kept, "acorn"] };
    l = hang(l, 0, "acorn");
    expect(l.hooks).toEqual(["acorn", null, null]);
    expect(onBoard(l)).toEqual(["feather"]);
    // A second feather adds nothing to keep.
    expect(pickUp(leave(l, "crumbs", DAY() + 2), "feather").kept).toEqual(["feather", "acorn"]);
  });

  test("leaving counts up, so every device can tell which thing is the newest", () => {
    const l = leave(pickUp(walked(crumbs(), DAY() + 1)!, "feather"), "crumbs", DAY() + 1);
    expect(l.n).toBe(2);
    expect(l.bowl).toEqual({ thing: "crumbs", day: DAY() + 1, seen: null, found: false });
  });
});

test("the basket: the crumbs, then at most three fruits", () => {
  const fruit = (kind: Fruit["kind"]): Fruit => ({ id: `es.w.${kind}`, lemma: kind, gloss: kind, kind });
  expect(basket([]).map((t) => t.id)).toEqual(["crumbs"]);
  expect(basket([fruit("apple"), fruit("pear"), fruit("plum"), fruit("fig")]).map((t) => t.id)).toEqual(["crumbs", "es.w.apple", "es.w.pear", "es.w.plum"]);
});

test("every find lies inside the fence, clear of the pond, in a small garden and a big one", () => {
  for (const n of [3, 400]) {
    const l = layout(Array.from({ length: n }, (_, i) => ({ id: `w${i}`, lemma: `w${i}`, gloss: "", pos: "noun", rank: i, s: 1, r: 1, stage: "sprout" as const, growth: 0.2, listen: false, write: false, forms: [] })));
    for (const spot of ["post", "shed", "hedge", "corner", "far"] as const) {
      const p = findAt(l, spot);
      expect(p.x > l.bounds.minX && p.x < l.bounds.maxX && p.z > l.bounds.minZ && p.z < l.bounds.maxZ).toBe(true);
      expect(Math.hypot(p.x - l.pond.x, p.z - l.pond.z)).toBeGreaterThan(l.pond.r + 0.3);
    }
  }
});
