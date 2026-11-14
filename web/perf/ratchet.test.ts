import { expect, test } from "bun:test";
import { ratchet, type Baseline, type Numbers } from "./ratchet.ts";

const n = (worst: number, overMs: number, inp: number): Numbers => ({ worst, overMs, inp });
const baseline: Baseline = { machine: "M", screens: { Session: n(40, 200, 42) } };

test("a number over the limit in every run fails", () => {
  const { worse, baseline: next } = ratchet(baseline, [{ screen: "Session", median: n(80, 200, 42), best: n(70, 190, 40) }], ["Session"]);
  expect(worse).toEqual(["Session: worst 40 → 80 ms (best run 70, limit 60)"]);
  expect(next.screens.Session).toEqual(n(40, 200, 42));
});

test("a number under the limit in one run does not fail: that slow run can be the machine", () => {
  const { worse, baseline: next } = ratchet(baseline, [{ screen: "Session", median: n(80, 200, 42), best: n(45, 190, 40) }], ["Session"]);
  expect(worse).toEqual([]);
  expect(next).toEqual(baseline);
});

test("a clearly better median is stored; a little better keeps the stored number", () => {
  const { worse, updated, baseline: next } = ratchet(baseline, [{ screen: "Session", median: n(36, 120, 42), best: n(30, 100, 40) }], ["Session"]);
  expect(worse).toEqual([]);
  expect(updated).toEqual(["Session: overMs 200 → 120 ms"]);
  expect(next.screens.Session).toEqual(n(40, 120, 42));
});

test("a new screen is stored, and a screen that is no longer measured is dropped", () => {
  const { baseline: next } = ratchet(baseline, [{ screen: "Words", median: n(13, 7, 0), best: n(12, 5, 0) }], ["Words"]);
  expect(next).toEqual({ machine: "M", screens: { Words: n(13, 7, 0) } });
});

test("a screen not run this time (--only) keeps its numbers", () => {
  const { baseline: next } = ratchet(baseline, [], ["Session", "Words"]);
  expect(next).toEqual(baseline);
});
