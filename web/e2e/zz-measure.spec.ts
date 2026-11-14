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
      await new Promise<void>((done) => {
        const f = () => {
          n++;
          if (performance.now() - t0 < 6000) requestAnimationFrame(f);
          else done();
        };
        requestAnimationFrame(f);
      });
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
      return { fps: +(n / wall).toFixed(2), gamePerSec: +(game / wall).toFixed(3), drawMs: +ms[4].toFixed(1), w: gl.drawingBufferWidth };
    });
    console.log(`MEASURE ${time} ${JSON.stringify({ ...r, readyMs: ready })}`);
  });
