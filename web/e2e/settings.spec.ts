import { expect, test } from "@playwright/test";
import { addEmail, serverRows, startCourse } from "./helpers";

test("target recall changed with the keyboard is saved on the server", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByText("How often to review").click();
  const slider = page.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Target: remember 92% of words")).toBeVisible();
  await expect.poll(async () => (await serverRows<{ retention: number }>(page, "course"))[0]?.retention).toBeCloseTo(0.92);
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

test("anonymous learners are invited to add an email; after that the account card says words sync", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Keep your garden safe.")).toBeVisible();
  await expect(page.getByText("All changes are saved.")).toBeVisible();
  await addEmail(page);
  await expect(page.getByText("Your words sync on all your devices")).toBeVisible();
  await expect(page.getByText(/AI words left this month/)).toBeVisible();
});
