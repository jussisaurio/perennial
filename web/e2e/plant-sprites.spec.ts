import { expect, test } from "./test";

// Two drawings of one plant must agree (#1109). The walk draws a far plant from
// its small sprite and a near one from its full-size sprite, and cuts both at
// half alpha (scenePlants.ts). A small sprite that lost a part the full-size one
// keeps, such as a thin stem, made the plant seem to grow as you walked up to it.
// The painters need OffscreenCanvas, which bun's tests do not have: so a browser.

test("render.same-outline: a plant's small sprite has the shape of its full-size sprite", async ({ page }) => {
  await page.goto("/");
  const pops = await page.evaluate(async () => {
    const { drawPlants } = await import(/* @vite-ignore */ "/src/garden/plantCanvas.ts");
    const { genome, rareOf } = await import(/* @vite-ignore */ "/src/ui/plant.tsx");
    const { LOW_W, LOW_H, HI_W } = await import(/* @vite-ignore */ "/src/garden/textures.ts");
    // Three words of each flower, and one of each rare flower.
    const words: string[] = [];
    const seen = new Map<string, number>();
    for (let i = 0; words.length < 7 * 3 + 4; i++) {
      const w = `w${i}`;
      const kind = rareOf(w) ?? genome(w).flower;
      const n = seen.get(kind) ?? 0; // the first word of this kind
      if (n < (rareOf(w) ? 1 : 3)) words.push(w);
      seen.set(kind, n + 1);
    }
    const S = HI_W / LOW_W;
    const found: string[] = [];
    for (const lemma of words)
      for (const stage of ["sprout", "bud", "bloom"] as const)
        for (const growth of [0.05, 0.25, 0.5, 0.75, 1]) {
          const lo = drawPlants([{ lemma, growth, stage }], 1, LOW_W, LOW_H).data;
          const hi = drawPlants([{ lemma, growth, stage }], 1, HI_W, LOW_H * S).data;
          // Each small pixel: is it drawn (the walk keeps alpha from 0.5), and how much of its square the full-size sprite draws.
          const drawn = (x: number, y: number) => lo[(y * LOW_W + x) * 4 + 3] >= 128;
          const cover = (x: number, y: number) => {
            let n = 0;
            for (let v = y * S; v < (y + 1) * S; v++) for (let u = x * S; u < (x + 1) * S; u++) if (hi[(v * HI_W + u) * 4 + 3] >= 128) n++;
            return n / (S * S);
          };
          const near = (x: number, y: number, f: (x: number, y: number) => boolean) => {
            for (let v = Math.max(0, y - 1); v <= Math.min(LOW_H - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(LOW_W - 1, x + 1); u++) if (f(u, v)) return true;
            return false;
          };
          // A part the full-size sprite draws solid at this size, with nothing drawn near it in the small one; and the other way round.
          let missing = 0;
          let extra = 0;
          for (let y = 0; y < LOW_H; y++)
            for (let x = 0; x < LOW_W; x++) {
              if (cover(x, y) >= 0.5 && !near(x, y, drawn)) missing++;
              if (drawn(x, y) && !near(x, y, (u, v) => cover(u, v) > 0)) extra++;
            }
          // One pixel may go: where the full-size sprite covers about half of it (a petal's tip), the small one
          // can fall just under the cut. A lost stem or bud misses more.
          if (missing > 1 || extra) found.push(`${lemma} ${stage} ${growth}: missing ${missing}, extra ${extra}`);
        }
    return found;
  });
  expect(pops).toEqual([]);
});
