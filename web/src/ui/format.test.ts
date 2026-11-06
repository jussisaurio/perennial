import { expect, test } from "bun:test";
import { longDay, refusedLine } from "./format";

// #253 review: each reason keeps its own advice, whatever order they came in.
test("refusals for a wrong clock and for other reasons are told apart", () => {
  expect(refusedLine({ count: 1, clock: 1, gardenClock: 0 })).toBe("1 answer was not saved, because the date or time on this device is wrong. Set the correct date and time, then answer again.");
  expect(refusedLine({ count: 2, clock: 0, gardenClock: 0 })).toBe("2 changes were not saved. The server did not accept them.");
  // A garden change from a fast clock (#351) gets the same advice, in its own words.
  expect(refusedLine({ count: 2, clock: 0, gardenClock: 1 })).toBe(
    "1 change in the garden was not saved, because the date or time on this device is wrong. Set the correct date and time. 1 other change was not saved. The server did not accept it.",
  );
  expect(refusedLine({ count: 3, clock: 2, gardenClock: 0 })).toBe(
    "2 answers were not saved, because the date or time on this device is wrong. Set the correct date and time, then answer again. 1 other change was not saved. The server did not accept it.",
  );
});

// #480: the same words as the Intl date it replaces, on every day of a year.
test("longDay says the date as toLocaleDateString does", () => {
  for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d.setDate(d.getDate() + 1)) {
    expect(longDay(d)).toBe(d.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" }));
  }
});
