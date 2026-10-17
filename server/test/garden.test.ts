import { expect, test } from "bun:test";
import { NO_LEFT, NO_POT, POT_LIMITS, type GardenLeft, type GardenPot } from "perennial-contract";
import { latestDay, leftProblem, mergeLeft, mergePot, potProblem } from "../src/garden";

const NOW = Date.UTC(2026, 9, 16, 12);
const DAY = Math.floor(NOW / 86_400_000);
const left = (n: number, day: number, more: Partial<NonNullable<GardenLeft["bowl"]>> = {}, rest: Partial<GardenLeft> = {}): GardenLeft => ({
  ...NO_LEFT,
  n,
  bowl: { thing: "crumbs", day, seen: null, found: false, ...more },
  ...rest,
});

test("the newest thing left wins, whichever device's write arrives first", () => {
  const old = left(1, DAY - 3, { seen: DAY - 2, found: true }, { kept: ["feather"] });
  const now = left(2, DAY);
  expect(mergeLeft(old, now)).toMatchObject({ n: 2, bowl: now.bowl, kept: ["feather"] });
  // A device that has not seen the new one yet: nothing goes back.
  expect(mergeLeft(now, { ...old, kept: ["feather"] })).toMatchObject({ n: 2, bowl: now.bowl, kept: ["feather"] });
});

test("for the same thing, the first day it was seen wins, and found stays found", () => {
  const a = left(1, DAY - 5, { seen: DAY - 1 });
  const b = left(1, DAY - 5, { seen: DAY - 3, found: true }, { kept: ["acorn"] });
  expect(mergeLeft(a, b).bowl).toEqual({ thing: "crumbs", day: DAY - 5, seen: DAY - 3, found: true });
  expect(mergeLeft(b, a).bowl).toEqual({ thing: "crumbs", day: DAY - 5, seen: DAY - 3, found: true });
  expect(mergeLeft(b, left(1, DAY - 5)).bowl?.seen).toBe(DAY - 3);
});

test("two devices that each left something as the same n: the first to arrive stays", () => {
  const first = left(3, DAY);
  const second = left(3, DAY, { thing: "es.w.apple" });
  expect(mergeLeft(first, second).bowl?.thing).toBe("crumbs");
});

test("what is kept only grows; the newest arrangement of the hooks wins, holding only kept things, once each", () => {
  const stored = left(1, DAY - 2, {}, { kept: ["feather", "acorn"], hooks: ["feather", null, null], arranged: 1 });
  const sent = left(1, DAY - 2, {}, { kept: ["leaf", "leaf"], hooks: ["leaf", "leaf", "ribbon"], arranged: 2 });
  expect(mergeLeft(stored, sent)).toMatchObject({ kept: ["feather", "acorn", "leaf"], hooks: ["leaf", null, null], arranged: 2 });
  // Taking things off the hooks is the learner's to do.
  expect(mergeLeft(stored, { ...stored, hooks: [null, null, null], arranged: 2 }).hooks).toEqual([null, null, null]);
  // A device that has not seen the newest arrangement leaves it as it is.
  expect(mergeLeft(stored, { ...stored, hooks: [null, null, null], arranged: 0 }).hooks).toEqual(["feather", null, null]);
});

test("refused: a day in the future (the device's clock), seen before it was left, a bowl without a count", () => {
  expect(leftProblem(left(1, DAY), NOW)).toBeNull();
  // A learner in UTC+14 is a day ahead of UTC.
  expect(leftProblem(left(1, latestDay(NOW)), NOW)).toBeNull();
  expect(leftProblem(left(1, DAY + 2), NOW)).toBe("clock");
  expect(leftProblem(left(1, DAY, { seen: DAY + 2 }), NOW)).toBe("clock");
  expect(leftProblem(left(1, DAY, { seen: DAY - 1 }), NOW)).toMatchObject({ path: ["garden_left", "bowl", "seen"] });
  expect(leftProblem({ ...NO_LEFT, n: 1 }, NOW)).toMatchObject({ path: ["garden_left", "bowl"] });
  expect(leftProblem({ ...left(1, DAY), n: 0 }, NOW)).toMatchObject({ path: ["garden_left", "bowl"] });
  expect(leftProblem(NO_LEFT, NOW)).toBeNull();
});

// ---- Two seeds, one pot (#387) ----

const pot = (sown: number, out: number, seeds: string[], day: number | null, hatched: GardenPot["hatched"] = []): GardenPot => ({ sown, out, seeds, day, hatched });
const catBird = { base: "cat", trait: "bird" };

test("the pot: the value with more sown wins, then more let out; on a tie the stored one stays", () => {
  const one = pot(1, 0, ["cat"], null);
  const two = pot(2, 0, ["cat", "bird"], DAY);
  const out = pot(2, 1, [], null, [catBird]);
  const again = pot(3, 1, ["dog"], null, [catBird]);
  expect(mergePot(one, two)).toBe(two);
  expect(mergePot(two, one)).toBe(two);
  expect(mergePot(two, out)).toBe(out);
  // A device that has not seen the creature let out yet: nothing goes back.
  expect(mergePot(out, two)).toBe(out);
  expect(mergePot(again, out)).toBe(again);
  // Two devices each sowed a different first seed: the first to arrive stays.
  expect(mergePot(one, pot(1, 0, ["frog"], null))).toBe(one);
  expect(mergePot(NO_POT, one)).toBe(one);
});

test("the pot: refused when its seeds do not follow from the counts, a day comes without two seeds, or the list is wrong", () => {
  expect(potProblem(NO_POT, NOW)).toBeNull();
  expect(potProblem(pot(2, 0, ["cat", "bird"], DAY), NOW)).toBeNull();
  expect(potProblem(pot(3, 1, ["dog"], null, [catBird]), NOW)).toBeNull();
  expect(potProblem(pot(2, 0, ["cat"], null), NOW)).toMatchObject({ path: ["garden_pot", "seeds"] });
  expect(potProblem(pot(3, 0, ["cat", "bird"], DAY), NOW)).toMatchObject({ path: ["garden_pot", "seeds"] });
  expect(potProblem(pot(1, 0, ["cat"], DAY), NOW)).toMatchObject({ path: ["garden_pot", "day"] });
  expect(potProblem(pot(2, 0, ["cat", "bird"], null), NOW)).toMatchObject({ path: ["garden_pot", "day"] });
  expect(potProblem(pot(2, 1, [], null), NOW)).toMatchObject({ path: ["garden_pot", "hatched"] });
  // Past the limit, only the newest are listed.
  const many = Array.from({ length: POT_LIMITS.hatched }, () => catBird);
  expect(potProblem(pot(2 * (POT_LIMITS.hatched + 5), POT_LIMITS.hatched + 5, [], null, many), NOW)).toBeNull();
  expect(potProblem(pot(2, 0, ["cat", "bird"], latestDay(NOW)), NOW)).toBeNull();
  expect(potProblem(pot(2, 0, ["cat", "bird"], DAY + 2), NOW)).toBe("clock");
});
