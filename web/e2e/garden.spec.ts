import { expect, test } from "@playwright/test";
import { startCourse } from "./helpers";

test("walk-in garden: every word is a plant; next plant, listen, time of day, and back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Pin the quality: software rendering here is slow and would switch to low by itself.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "normal"));
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page).toHaveURL(/#\/garden$/);
  await expect(page.getByText(/30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20000 });

  await page.getByRole("button", { name: "Next plant →" }).click();
  const card = page.getByRole("dialog", { name: /^The plant for / });
  await expect(card).toBeVisible();
  const first = await card.getAttribute("aria-label");
  await expect(card.getByRole("button", { name: /Listen/ })).toBeVisible();
  await card.getByRole("button", { name: "Next plant →" }).click();
  await expect(card).not.toHaveAttribute("aria-label", first!);
  await page.getByRole("button", { name: "Previous plant" }).click();
  await expect(card).toHaveAttribute("aria-label", first!);

  const time = page.getByRole("button", { name: /^Time of day: / });
  const before = await time.textContent();
  await time.click();
  await expect(time).not.toHaveText(before!);

  // Quality toggles and is remembered; trackpad swipes look around instead of scrolling.
  await page.getByRole("button", { name: "Quality: Normal quality" }).click();
  await expect(page.getByRole("button", { name: "Quality: Low quality" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("garden-quality"))).toBe("low");
  await page.mouse.move(400, 300);
  await page.mouse.wheel(-200, 50);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Escape closes the card first, then leaves the garden.
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/today$/);
  expect(errors).toEqual([]);
});

test("the garden tab opens the garden; an empty garden offers the first session", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Garden" }).click();
  await expect(page.getByText("Your garden is empty")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Learn my first words" })).toBeVisible();
});

test("2D garden: a big garden scrolls; arrows page through it; a plant opens in the 3D garden", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/?demo=es#/today");
  const strip = page.locator(".garden-scroll");
  await expect(page.locator(".garden.scrolls")).toBeVisible({ timeout: 30_000 });
  const scrollLeft = () => strip.evaluate((el) => el.scrollLeft);
  // The demo learner's words sync in over a moment: wait until the garden stops growing.
  const width = () => strip.evaluate((el) => el.scrollWidth);
  await expect.poll(async () => {
    const a = await width();
    await page.waitForTimeout(500);
    return a === (await width()) && a > 2000;
  }, { timeout: 30_000 }).toBe(true);
  const max = await strip.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(await scrollLeft()).toBeGreaterThan(max - 2); // opens on the newest growth
  // Only plants in view are drawn, however big the garden.
  expect(await page.locator(".garden svg > g").count()).toBeLessThan(120);

  // At the end, "later" is disabled. It pages back, then "later" appears.
  await expect(page.getByRole("button", { name: "Later words" })).toBeDisabled();
  await page.getByRole("button", { name: "Earlier words" }).click();
  await expect.poll(scrollLeft).toBeLessThan(max - 300);
  await expect(page.getByRole("button", { name: "Later words" })).toBeEnabled();

  // A click opens the card; its link opens the plant in 3D.
  const box = (await strip.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 150);
  const card = page.locator(".plant-tip");
  await expect(card).toBeVisible();
  const word = (await card.locator("strong").textContent())!;
  await card.getByRole("button", { name: /View in garden/ }).click();
  await expect(page.getByRole("dialog", { name: `The plant for ${word}` })).toBeVisible({ timeout: 20_000 });
});
