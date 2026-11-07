import { expect, test } from "./test";
import { pinDetail } from "./helpers";

// A right-click menu takes the key presses, so the walk never hears the key
// go up. Opening one must stop the walk, or the walker turns forever.

test("a right-click menu stops a held turn", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  await pinDetail(page, "low");
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  const yaw = () => page.evaluate(() => (window as unknown as { __garden: { yaw: number } }).__garden.yaw);

  await page.keyboard.down("ArrowLeft");
  const start = await yaw();
  await expect.poll(yaw).not.toBe(start);
  // The key stays down: with a real menu open, its key up never reaches the page.
  await page.locator("canvas").click({ button: "right" });
  const after = await yaw();
  await page.waitForTimeout(500);
  expect(await yaw()).toBe(after);
});
