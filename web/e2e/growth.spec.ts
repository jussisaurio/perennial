import { expect, test, type Page } from "@playwright/test";
import { answer, kicker, reveal, startCourse } from "./helpers";

// #200: after a good answer the word's plant is planted or grows, and only then comes the next card.
test.use({ reducedMotion: "no-preference" });

const moment = (page: Page) => page.locator(".growth");
const cardId = (page: Page) => page.locator(".session").getAttribute("data-card");

test("a new word's seed is planted, then the next card; a tap skips the moment", async ({ page }) => {
  await page.clock.install();
  await startCourse(page);
  await page.locator("button.start").click();
  await reveal(page);
  const first = await cardId(page);
  await page.keyboard.press("1"); // New to me
  await expect(moment(page)).toHaveAttribute("data-kind", "plant");
  expect(await cardId(page)).toBe(first); // the card waits for the seed
  await expect(moment(page)).toHaveCount(0);
  await expect(page.locator(".session")).not.toHaveAttribute("data-card", first!);

  // With the clock stopped the moment cannot end by itself: only the tap ends it.
  await reveal(page);
  const second = await cardId(page);
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000));
  await page.keyboard.press("2"); // I knew it
  await expect(moment(page)).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(moment(page)).toHaveCount(0);
  await expect(page.locator(".session")).not.toHaveAttribute("data-card", second!);
});

test("a remembered quick check waters the plant; a forgotten one moves straight on", async ({ page }) => {
  await startCourse(page);
  await page.locator("button.start").click();
  for (let i = 0; i < 4; i++) {
    await reveal(page);
    await page.keyboard.press("1");
    await expect(moment(page)).toHaveCount(0); // each seed planted
  }
  await expect(kicker(page)).toHaveText(/quick check/);
  await reveal(page);
  await page.keyboard.press("2"); // I remembered: seed → sprout
  await expect(moment(page)).toHaveAttribute("data-kind", "water");
  await expect(moment(page)).toHaveCount(0);
  await expect(kicker(page)).toHaveText(/quick check/);
  await reveal(page);
  const forgot = await cardId(page);
  await page.keyboard.press("1"); // I forgot: nothing grows
  await expect(page.locator(".session")).not.toHaveAttribute("data-card", forgot!);
  await expect(moment(page)).toHaveCount(0);
});

test("the setting 'Next card right away' skips the moment", async ({ page }) => {
  await startCourse(page);
  await page.goto("/#/settings");
  await page.getByRole("radio", { name: "Next card right away" }).click();
  await page.goto("/");
  await page.locator("button.start").click();
  await answer(page, "1");
  await expect(moment(page)).toHaveCount(0);
  await answer(page, "2");
  await expect(moment(page)).toHaveCount(0);
  // It is kept for this device.
  await page.goto("/#/settings");
  await expect(page.getByRole("radio", { name: "Next card right away" })).toHaveAttribute("aria-checked", "true");
});
