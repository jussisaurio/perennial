import { expect, test } from "bun:test";
import { HI_COLS, HI_H, HI_LEVELS, HI_W, hiSlots, LOW_COLS, LOW_H, LOW_LEVELS, LOW_PER_SHEET, LOW_W, lowSheetHeights } from "./textures";

// The GPU keeps every sheet's whole size, filled or not (#1107).
test("a garden's sheets of small sprites have a cell for each plant, and only the rows those cells fill", () => {
  for (const plants of [1, LOW_COLS, LOW_COLS + 1, 800, LOW_PER_SHEET, LOW_PER_SHEET + 1, 5000]) {
    const heights = lowSheetHeights(plants);
    const cells = heights.reduce((n, h) => n + (h / LOW_H) * LOW_COLS, 0);
    expect(cells).toBeGreaterThanOrEqual(plants);
    // Only the last row may have empty cells.
    expect(cells - plants).toBeLessThan(LOW_COLS);
  }
});

test("a small garden gets a full-size slot for every plant; a big one gets 210", () => {
  for (const plants of [1, 20, 21, 22, 209]) {
    const slots = hiSlots(plants);
    expect(slots % HI_COLS).toBe(0);
    expect(slots).toBeGreaterThanOrEqual(plants);
    expect(slots - plants).toBeLessThan(HI_COLS);
  }
  for (const plants of [210, 211, 5000]) expect(hiSlots(plants)).toBe(210);
});

// The page copies each sprite's mipmaps into place at x >> level (scenePlants.ts copyLevels):
// every level of a cell must be whole pixels, and there are as many levels as halve that way (#1091).
test("each sprite's mipmap levels halve its cell exactly, down to an odd side", () => {
  for (const [w, h, levels] of [
    [LOW_W, LOW_H, LOW_LEVELS],
    [HI_W, HI_H, HI_LEVELS],
  ]) {
    const last = levels - 1;
    expect([(w >> last) << last, (h >> last) << last]).toEqual([w, h]);
    // One more level would split a pixel.
    expect((w >> last) % 2 === 1 || (h >> last) % 2 === 1).toBe(true);
  }
});
