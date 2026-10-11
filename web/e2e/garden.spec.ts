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
