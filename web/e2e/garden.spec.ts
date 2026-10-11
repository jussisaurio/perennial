import { expect, test } from "@playwright/test";
import { seedGarden } from "./garden-seed";

test("walk-in garden: every word is a plant; next plant, listen, time of day, and back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await seedGarden(page);
  // Pin the quality: software rendering here is slow and would switch to low by itself.
  await page.evaluate(() => localStorage.setItem("garden-quality", "normal"));
  await page.goto("/#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page).toHaveURL(/#\/garden$/);
  await expect(page.getByText(/91 plants · \d+ in bloom/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Water \d+ thirsty plants?/ })).toBeVisible();

  // The most common noun is the first plant you visit.
  await page.getByRole("button", { name: "Next plant →" }).click();
  const card = page.getByRole("dialog", { name: "The plant for casa" });
  await expect(card).toBeVisible();
  await expect(card.getByText("house")).toBeVisible();
  await expect(card.getByRole("button", { name: /Listen/ })).toBeVisible();
  await card.getByRole("button", { name: "Next plant →" }).click();
  await expect(page.getByRole("dialog", { name: "The plant for perro" })).toBeVisible();
  await page.getByRole("button", { name: "Previous plant" }).click();
  await expect(card).toBeVisible();

  const time = page.getByRole("button", { name: /^Time of day: / });
  const before = await time.textContent();
  await time.click();
  await expect(time).not.toHaveText(before!);

  // Pixel size cycles and is remembered; trackpad swipes look around instead of scrolling.
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
  await page.goto("/");
  await page.evaluate(async () => {
    const { db } = await import("/src/db/db.ts");
    await db.courses.put({ id: "empty", lang: "de", native: "English", minutes: 5, retention: 0.9, createdAt: Date.now() });
  });
  await page.goto("/#/today");
  await page.getByRole("tab", { name: "Garden" }).click();
  await expect(page.getByText("Your garden is empty")).toBeVisible();
  await expect(page.getByRole("button", { name: "Learn my first words" })).toBeVisible();
});

test("words list stays fast with many words: only nearby rows are in the page", async ({ page }) => {
  await seedGarden(page, 1500);
  await page.goto("/#/words");
  await expect(page.getByText("1591 words")).toBeVisible();
  expect(await page.locator("ul.words > li").count()).toBeLessThan(60);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByText("palabra1499", { exact: true })).toBeVisible();
  expect(await page.locator("ul.words > li").count()).toBeLessThan(60);
});

test("a big garden (2000 words) loads quickly and streams full-size plants near you", async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await seedGarden(page, 1910);
  const t0 = Date.now();
  await page.goto("/#/garden");
  await expect(page.getByText("2001 plants", { exact: false })).toBeVisible();
  await page.getByText(/Growing your plants/).waitFor({ state: "detached", timeout: 20000 });
  // Software rendering in CI is slow; on a real GPU this is about 1 second.
  expect(Date.now() - t0).toBeLessThan(15000);
  await page.getByRole("button", { name: "Next plant →" }).click();
  await expect(page.getByRole("dialog", { name: "The plant for casa" })).toBeVisible();
  expect(errors).toEqual([]);
});
