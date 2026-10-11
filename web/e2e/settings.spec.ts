import { expect, test } from "@playwright/test";
import { startCourse, store } from "./helpers";

test("target recall changed with the keyboard is saved", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByText("How often to review").click();
  const slider = page.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Target: remember 92% of words")).toBeVisible();
  await expect.poll(async () => (await store<{ retention: number }>(page, "courses"))[0].retention).toBeCloseTo(0.92);
});

test("theme choice uses plain words and applies", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("radio", { name: "Same as my device" })).toBeVisible();
});

test("signed in: the account card says words sync, with a sync status", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Your words sync on all your devices")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
});
