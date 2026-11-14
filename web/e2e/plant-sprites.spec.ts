import { expect, test } from "./test";

// Two drawings of one plant must agree (#1109). The walk draws a far plant from
// its small sprite, a near one from its full-size sprite, and one right in
// front of you from its near sprite (#1154), and cuts each at half alpha
// (scenePlants.ts). A small sprite that lost a part the full-size one keeps,
// such as a thin stem, made the plant seem to grow as you walked up to it.
// The painters need OffscreenCanvas, which bun's tests do not have: so a browser.

test("render.same-outline: a plant's small, full-size and near sprites have one shape", async ({ page }) => {
  await page.goto("/");
  const pops = await page.evaluate(async () => {
    const { drawPlants } = await import(/* @vite-ignore */ "/src/garden/plantCanvas.ts");
    const { genome, rareOf } = await import(/* @vite-ignore */ "/src/ui/plant.tsx");
    const { LOW_W, LOW_H, HI_W, HI_H, NEAR_W } = await import(/* @vite-ignore */ "/src/garden/textures.ts");
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
    // Each sprite against the next bigger one, which the walk swaps it for: w × h, and the bigger one S times that.
    const pairs = [
      { name: "small", w: LOW_W, h: LOW_H, S: HI_W / LOW_W },
      { name: "full-size", w: HI_W, h: HI_H, S: NEAR_W / HI_W },
    ];
    const found: string[] = [];
    for (const { name, w, h, S } of pairs)
      for (const lemma of words)
        for (const stage of ["sprout", "bud", "bloom"] as const)
          for (const growth of [0.05, 0.25, 0.5, 0.75, 1]) {
            const lo = drawPlants([{ lemma, growth, stage }], 1, w, h).data;
            const hi = drawPlants([{ lemma, growth, stage }], 1, w * S, h * S).data;
            // Each pixel of the smaller sprite: is it drawn (the walk keeps alpha from 0.5), and how much of its square the bigger one draws.
            const drawn = (x: number, y: number) => lo[(y * w + x) * 4 + 3] >= 128;
            const covers = new Float32Array(w * h);
            for (let y = 0; y < h; y++)
              for (let x = 0; x < w; x++) {
                let n = 0;
                for (let v = y * S; v < (y + 1) * S; v++) for (let u = x * S; u < (x + 1) * S; u++) if (hi[(v * w * S + u) * 4 + 3] >= 128) n++;
                covers[y * w + x] = n / (S * S);
              }
            const cover = (x: number, y: number) => covers[y * w + x];
            const near = (x: number, y: number, f: (x: number, y: number) => boolean) => {
              for (let v = Math.max(0, y - 1); v <= Math.min(h - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(w - 1, x + 1); u++) if (f(u, v)) return true;
              return false;
            };
            // A part the bigger sprite draws solid at the smaller one's size, with nothing drawn near it in the smaller one; and the other way round.
            let missing = 0;
            let extra = 0;
            for (let y = 0; y < h; y++)
              for (let x = 0; x < w; x++) {
                if (cover(x, y) >= 0.5 && !near(x, y, drawn)) missing++;
                if (drawn(x, y) && !near(x, y, (u, v) => cover(u, v) > 0)) extra++;
              }
            // One pixel may go: where the bigger sprite covers about half of it (a petal's tip), the smaller one
            // can fall just under the cut. A lost stem or bud misses more.
            if (missing > 1 || extra) found.push(`${name} ${lemma} ${stage} ${growth}: missing ${missing}, extra ${extra}`);
          }
    return found;
  });
  expect(pops).toEqual([]);
});
