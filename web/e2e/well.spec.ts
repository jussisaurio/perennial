import { expect, test, type Page } from "./test";
import { standBy } from "./helpers";

// #335 S6, the wishing well: carry a pebble from the pond, through the open
// door, to the well at the far end of the orchard's path, and drop it in. A
// moment later the echo answers with a word met long ago and the day it was
// met, and a screen reader hears it too. Nothing here is saved.

type Spot = { x: number; z: number };
/** The parts of the dev-only scene handle (window.__garden) these tests read and move. */
type WellScene = {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  layout: { gate: Spot; bounds: { maxZ: number }; orchard: Spot & { d: number }; well: Spot & { r: number } };
  carry: { held: number | null };
  camera: unknown;
  tmp: { constructor: new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } } };
};

const scene = (page: Page) => page.evaluate(() => (window as unknown as { __garden: WellScene }).__garden);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-17T12:00:00"));
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
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
  await page.goto("/#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  const act = (name: string) => page.getByRole("button", { name, exact: true });
  const status = page.locator(".sr-only[role=status]");

  // Pick up a pebble by the pond.
  const pebble = await page.evaluate(async () => {
    const { pebbleHome } = await import(/* @vite-ignore */ "/src/garden/carry.ts");
    return pebbleHome((window as unknown as { __garden: { layout: Parameters<typeof pebbleHome>[0] } }).__garden.layout, 0);
  });
  await standBy(page, { ...pebble, y: 0.03 }, 0.8);
  await act("Pick up the pebble").click();
  await expect(status).toHaveText("You hold the pebble.");

  // Walk through the door with it, facing the orchard (+z is yaw π).
  const { layout } = await scene(page);
  await page.evaluate((at) => Object.assign((window as unknown as { __garden: WellScene }).__garden, at), { x: layout.gate.x, z: layout.bounds.maxZ - 0.6, yaw: Math.PI, pitch: -0.1 });
  const inside = layout.orchard.z - layout.orchard.d / 2 + 0.8;
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await scene(page)).z, { timeout: 20_000 }).toBeGreaterThan(inside);
  await page.keyboard.up("KeyW");
  expect((await scene(page)).carry.held).not.toBeNull();

  // The well stands at the end of the path, straight ahead: a tap on it walks there and drops the pebble in.
  const at = await page.evaluate(() => {
    const s = (window as unknown as { __garden: WellScene }).__garden;
    const v = new s.tmp.constructor(s.layout.well.x, 0.6, s.layout.well.z).project(s.camera);
    const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height] as const;
  });
  await page.mouse.click(...at);
  await expect(status).toHaveText("It falls a long way. Plop.", { timeout: 20_000 });
  await expect(page.locator(".gw-hand")).toHaveCount(0);

  // A moment later, the echo: the day the word was met, then the word, in the course language.
  const echo = page.locator(".gw-echo");
  await expect(echo).toHaveText(/^\d{1,2} [A-Z][a-z]+( \d{4})?: .+\.$/);
  const word = await echo.locator('[lang="es"]').textContent();
  await expect(status).toContainText("An echo from the well: ");
  await expect(status.locator('[lang="es"]')).toHaveText(word!);

  // Another pebble waits by the pond (pebbles never run out). Brought to the well, the action button drops it in, and the echo answers again.
  await standBy(page, { ...pebble, y: 0.03 }, 0.8);
  await act("Pick up the pebble").click();
  await page.evaluate(() => {
    const s = (window as unknown as { __garden: WellScene }).__garden;
    Object.assign(s, { x: s.layout.well.x, z: s.layout.well.z - 1.4, yaw: Math.PI, pitch: -0.1 });
  });
  await act("Drop it in the well").click();
  await expect(status).toHaveText("It falls a long way. Plop.");
  await expect(status).toContainText("An echo from the well: ");
  expect(errors).toEqual([]);
});
