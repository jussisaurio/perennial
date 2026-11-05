import { describe, expect, test } from "bun:test";
import { DAY_MS } from "./day";
import { recordGap } from "./memory";

describe("recordGap: the longest a word has waited and still been remembered", () => {
  const day = (n: number) => Date.UTC(2026, 0, 1) + n * DAY_MS;
  test("news only when the gap is two weeks or more and longer than every gap before it", () => {
    expect(recordGap([day(0), day(3), day(10)], day(33))).toBe(23); // 23 > 7 > 3
    expect(recordGap([day(0), day(30)], day(50))).toBeNull(); // 20 days, but it waited 30 before
    expect(recordGap([day(0), day(3)], day(13))).toBeNull(); // 10 days: not news yet
    expect(recordGap([], day(30))).toBeNull(); // never seen
  });
});
