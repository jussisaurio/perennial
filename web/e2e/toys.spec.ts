import { expect, test, type Page } from "./test";
import { pinDetail, type Drawn } from "./helpers";

// #360, lawn toys: blow a dandelion clock by the fence. The playwright config
// asks for reduced motion: the seeds fade on the clock. Where the wind takes
// things is unit-tested (garden/toys.test.ts).

/** The renderer's parts these tests read: the seeds as drawn (sceneToys.ts). The clocks are the game's (toys.ts Clocks). */
type ToyScene = Drawn & { toys: { seeds: { visible: boolean } } };

const DAY = new Date("2026-06-01T12:00:00");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(DAY);
  await page.setViewportSize({ width: 1280, height: 800 });
  // Low detail: software WebGL on CI draws it faster, and every click waits for frames.
  await pinDetail(page, "low");
});

async function openWalk(page: Page) {
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

const toysNow = (page: Page) =>
  page.evaluate(() => {
    const s = window.__garden as unknown as ToyScene;
    return { blown: window.__garden.game.clocks.blown, seeds: s.toys.seeds.visible };
  });

/** Stand 1.5 m in front of the clock on the back fence, facing it; return where it shows on the page (pixels). */
const facingClock = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<[number, number]>((done) => {
        const g = window.__garden.game;
        const s = window.__garden as unknown as Drawn;
        const h = g.clocks.heads.find((h) => h.id === "base:0")!;
        // Forward is -z at yaw 0: the back fence is that way.
        Object.assign(g.me, { x: h.x, z: h.z + 1.5, yaw: 0, pitch: -Math.atan2(1.05 - 0.25, 1.5) });
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const v = new s.tmp.constructor(h.x, 0.25, h.z).project(s.camera);
            const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
            done([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
          }),
        );
      }),
  );

test("a tap walks up to a dandelion clock and blows it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?demo=es:3#/today");
  await openWalk(page);
  expect((await toysNow(page)).blown.every((b) => !b)).toBe(true);

  // A tap on the clock from 1.5 m: you walk up to it, and it is blown.
  await page.mouse.click(...(await facingClock(page)));
  await expect.poll(async () => (await toysNow(page)).blown[0], { timeout: 15_000 }).toBe(true);
  expect((await toysNow(page)).seeds).toBe(true);
  // A screen reader hears what happened.
  await expect(page.getByRole("status").filter({ hasText: "The seeds fly away on the wind." })).toHaveCount(1);
  // Blown, it has nothing more to give this walk: no button for it.
  await expect(page.getByRole("button", { name: "Blow the dandelion" })).toHaveCount(0);
  // The seeds fade, and are gone.
  await expect.poll(async () => (await toysNow(page)).seeds, { timeout: 15_000 }).toBe(false);
  expect(errors).toEqual([]);
});
