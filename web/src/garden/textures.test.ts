import { expect, test } from "bun:test";
import { HI_H, HI_LEVELS, HI_W, LOW_H, LOW_LEVELS, LOW_W } from "./textures";

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
