import { expect, test, type Page } from "./test";
import { pinDetail, readRowsAgain, standBy, type Drawn } from "./helpers";

// #335 S6, the wishing well: carry a pebble from the pond, through the open
// door, to the well at the far end of the orchard's path, and drop it in. A
// moment later the echo answers with a word met long ago and the day it was
// met, and a screen reader hears it too. Nothing here is saved.

/** How far along z the walker is, what they hold, and the layout. */
const scene = (page: Page) =>
  page.evaluate(() => {
    const g = window.__garden.game;
    return { z: g.me.z, held: g.pebbles.held, layout: g.layout };
  });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-17T12:00:00"));
  // Low detail: software WebGL on CI draws it faster, and every click waits for frames.
  await pinDetail(page, "low");
});

test("carry a pebble through the door to the well and drop it in: the echo says an old word and its day", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?demo=es:30#/today");
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(async () => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    await postWrite([{ type: "course.upsert", row: { lang: "es", door_open: true } }]);
  });
  // The demo already moved the page to /#/today, so going there again would not reload it.
  await readRowsAgain(page);
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  const act = (name: string) => page.getByRole("button", { name, exact: true });
  const status = page.locator(".sr-only[role=status]");

  // Pick up a pebble by the pond.
  const pebble = await page.evaluate(async () => {
    const { pebbleHome } = await import(/* @vite-ignore */ "/src/garden/carry.ts");
    return pebbleHome(window.__garden.game.layout, 0);
  });
  await standBy(page, { ...pebble, y: 0.03 }, 0.8);
  await act("Pick up the pebble").click();
  await expect(status).toHaveText("You hold the pebble.");

  // Walk through the door with it, facing the orchard (+z is yaw π).
  const { layout } = await scene(page);
  await page.evaluate((at) => Object.assign(window.__garden.game.me, at), { x: layout.gate.x, z: layout.bounds.maxZ - 0.6, yaw: Math.PI, pitch: -0.1 });
  const inside = layout.orchard.z - layout.orchard.d / 2 + 0.8;
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await scene(page)).z, { timeout: 20_000 }).toBeGreaterThan(inside);
  await page.keyboard.up("KeyW");
  expect((await scene(page)).held).not.toBeNull();

  // The well stands at the end of the path, straight ahead: a tap on it walks there and drops the pebble in.
  const at = await page.evaluate(() => {
    const s = window.__garden as unknown as Drawn;
    const { well } = window.__garden.game.layout;
    const v = new s.tmp.constructor(well.x, 0.6, well.z).project(s.camera);
    const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height] as const;
  });
  await page.mouse.click(...at);
  await expect(status).toHaveText("It falls a long way. Plop.", { timeout: 20_000 });
  await expect(page.locator(".gw-hand")).toHaveCount(0);

  // A moment later, the echo: the day the word was met, then the word, in the course language.
  const echo = page.locator(".gw-echo");
  await expect(echo).toHaveText(/^\d{1,2} de [a-z]+( de \d{4})?: .+\.$/);
  const word = await echo.locator("i").textContent();
  await expect(status).toContainText("An echo from the well. It says one of your old words: ");
  await expect(status.locator('[lang="es"]')).toHaveText(word!);

  // Another pebble waits by the pond (pebbles never run out). Brought to the well, the action button drops it in, and the echo answers again.
  await standBy(page, { ...pebble, y: 0.03 }, 0.8);
  await act("Pick up the pebble").click();
  await page.evaluate(() => {
    const g = window.__garden.game;
    Object.assign(g.me, { x: g.layout.well.x, z: g.layout.well.z - 1.4, yaw: Math.PI, pitch: -0.1 });
  });
  await act("Drop it in the well").click();
  await expect(status).toHaveText("It falls a long way. Plop.");
  await expect(status).toContainText("An echo from the well. It says one of your old words: ");
  expect(errors).toEqual([]);
});
