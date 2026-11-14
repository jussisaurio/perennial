import { expect, test, type Page } from "./test";
import { aimAtGround, pinDetail, walker } from "./helpers";

async function openWalk(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  await pinDetail(page, "low");
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

// A right-click menu takes the key presses, so the walk never hears the key
// go up. Opening one must stop the walk, or the walker turns forever.

test("a right-click menu stops a held turn", async ({ page }) => {
  await openWalk(page);
  const yaw = () => page.evaluate(() => window.__garden.game.me.yaw);

  await page.keyboard.down("ArrowLeft");
  const start = await yaw();
  await expect.poll(yaw).not.toBe(start);
  // The key stays down: with a real menu open, its key up never reaches the page.
  await page.locator("canvas").click({ button: "right" });
  const after = await yaw();
  await page.waitForTimeout(500);
  expect(await yaw()).toBe(after);
});

// A right-click is for the browser's menu, not a tap: on CI it walked to the
// spot under the pointer and turned the walker that way (#798).
test("a right-click on open ground does not walk you there", async ({ page }) => {
  await openWalk(page);
  const { x, y, kind } = await aimAtGround(page, 0);
  expect(kind).toBe("walk");
  const before = await walker(page);
  await page.mouse.click(x, y, { button: "right" });
  expect(await walker(page)).toEqual(before);
});
