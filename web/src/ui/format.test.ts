import { expect, test } from "bun:test";
import { longDay, refusedLine, shortDay } from "./format";

// #253 review: each reason keeps its own advice, whatever order they came in.
test("refusals for a wrong clock and for other reasons are told apart", () => {
  expect(refusedLine({ count: 1, clock: 1 })).toBe("1 answer was not saved, because the date or time on this device is wrong. Set the correct date and time, then answer again.");
  expect(refusedLine({ count: 2, clock: 0 })).toBe("2 changes were not saved. The server did not accept them.");
  expect(refusedLine({ count: 3, clock: 2 })).toBe(
    "2 answers were not saved, because the date or time on this device is wrong. Set the correct date and time, then answer again. 1 other change was not saved. The server did not accept it.",
  );
});

// #480: the same words as the Intl date it replaces, on every day of a year.
test("longDay says the date as toLocaleDateString does", () => {
  for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d.setDate(d.getDate() + 1)) {
    expect(longDay(d)).toBe(d.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" }));
  }
});

// Pinned words, not Intl's: ICU versions differ ("1 Sep" here, "1 Sept" on CI's Node), and the strip shows ours.
test("shortDay says the day and the month's first three letters", () => {
  expect(shortDay(new Date(2026, 9, 3))).toBe("3 Oct");
  expect(shortDay(new Date(2026, 8, 1))).toBe("1 Sep");
  expect(shortDay(new Date(2026, 11, 31))).toBe("31 Dec");
});
