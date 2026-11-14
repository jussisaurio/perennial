// SCRATCH (#1177): not for merge. How fast the walk runs at low detail on CI's software WebGL.
import { pinDetail } from "./helpers";
import { openToday, TIMES, walkReady } from "./spots";
import { test } from "./test";

for (const [i, time] of (["day", "dusk", "day", "dusk"] as const).entries())
  test(`measure ${i} ${time}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.clock.setFixedTime(TIMES[time]);
    await pinDetail(page, "low");
    const t0 = Date.now();
    await openToday(page, "es:30", null);
    await page.getByRole("button", { name: "Walk in your garden" }).click();
    await walkReady(page);
    const ready = Date.now() - t0;
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      type S = { renderer: { render: (a: unknown, b: unknown) => void; getContext: () => WebGL2RenderingContext }; scene: unknown; camera: unknown; game: { elapsed: number } };
      const s = window.__garden as unknown as S;
      const t0 = performance.now();
      const e0 = s.game.elapsed;
      let n = 0;
      const gaps: number[] = [];
      let last = t0;
      await new Promise<void>((done) => {
        const f = () => {
          n++;
          const now = performance.now();
          gaps.push((now - last) / 1000);
          last = now;
          if (now - t0 < 8000) requestAnimationFrame(f);
          else done();
        };
        requestAnimationFrame(f);
      });
      const sum = (cap: number) => +(gaps.reduce((a, d) => a + Math.min(d, cap), 0) / ((last - t0) / 1000)).toFixed(3);
      const caps = Object.fromEntries([0.1, 0.2, 0.3, 0.4, 0.5, 1].map((c) => [c, sum(c)]));
      const sorted = [...gaps].sort((a, b) => a - b);
      const pct = (q: number) => +sorted[Math.floor(q * (sorted.length - 1))].toFixed(3);
      const dist = { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: pct(1), over100: gaps.filter((d) => d > 0.1).length, over300: gaps.filter((d) => d > 0.3).length };
      const wall = (performance.now() - t0) / 1000;
      const game = s.game.elapsed - e0;
      const gl = s.renderer.getContext();
      const px = new Uint8Array(4);
      const ms: number[] = [];
      for (let k = 0; k < 9; k++) {
        const a = performance.now();
        s.renderer.render(s.scene, s.camera);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        ms.push(performance.now() - a);
      }
      ms.sort((a, b) => a - b);
      return { fps: +(n / wall).toFixed(2), gamePerSec: +(game / wall).toFixed(3), caps, dist, drawMs: +ms[4].toFixed(1), w: gl.drawingBufferWidth };
    });
    console.log(`MEASURE ${time} ${JSON.stringify({ ...r, readyMs: ready })}`);
  });
