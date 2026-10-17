import { expect, test, type Page } from "./test";
import { standBy } from "./helpers";

// #376, the goat in impossible places: on its days it stands somewhere no goat
// could get. Its tag says what it is; a screen reader hears where it stands.
// Look away and back, and it has gone.

/** The parts of the dev-only scene handle (window.__garden) this test reads and moves. */
type GoatScene = {
  yaw: number;
  guests: { sprites: { v: { id: string }; body: { at: { x: number; y: number; z: number }; visible: boolean } }[] };
};

const goat = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __garden: GoatScene }).__garden;
    const { at, visible } = s.guests.sprites.find((o) => o.v.id === "goat")!.body;
    return { at, visible };
  });

/** Turn round by half a turn. */
const turnRound = (page: Page) => page.evaluate(() => ((window as unknown as { __garden: GoatScene }).__garden.yaw += Math.PI));

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-01T12:00:00"));
  await page.setViewportSize({ width: 1280, height: 720 });
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("a goat stands somewhere no goat could get, with its tag; look away and back, and it has gone", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?demo=es:3&visitors=goat#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  const status = page.locator(".sr-only[role=status]");
  const tag = page.locator(".gw-tag").filter({ hasText: "la cabra" });

  // It is well off the ground: on a hedge, a roof, a sign or the back of the bench.
  const { at } = await goat(page);
  expect(at.y).toBeGreaterThan(0.7);
  await standBy(page, { ...at, y: at.y + 0.3 }, 3);
  await expect(tag).toBeVisible();
  await expect(status).toHaveText(/^A goat stands on (top of the hedge|the roof of the shed|top of the sign|the back of the bench)\.$/);

  // Look away for a moment, and back: it has gone, and nothing says where.
  await turnRound(page);
  await expect.poll(async () => (await goat(page)).visible, { timeout: 5_000 }).toBe(false);
  await turnRound(page);
  await expect(tag).toHaveCount(0);
  await expect(status).not.toHaveText(/goat/);
  expect(errors).toEqual([]);
});
