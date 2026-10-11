import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { advance, startCourse, startSession } from "./helpers";

test("the browser Back button moves between screens instead of leaving the app", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("button", { name: "Add words" }).click();
  await expect(page).toHaveURL(/#\/words\/add$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Words" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: /today's session/ })).toBeVisible();

  await startSession(page);
  await advance(page, "Space");
  await page.goBack(); // leaving a session with Back returns home, answers kept
  await expect(page.getByRole("button", { name: /today's session/ })).toBeVisible();
});

test("export downloads everything, including the review log", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await advance(page, "k"); // one review: "I knew it"
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: /Done/ }).click();
  await page.getByRole("tab", { name: "Settings" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all my data (JSON)" }).click()]);
  const data = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(data.app).toBe("perennial");
  expect(data.lexemes.length).toBeGreaterThan(0);
  expect(data.reviews).toHaveLength(1);
  expect(data.reviews[0].grade).toBe(4);
});

test("deleting a course needs its name typed, and says it cannot be undone", async ({ page }) => {
  await startCourse(page);
  const lang = (await page.getByRole("heading", { level: 1 }).locator("em").textContent())!;
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.locator("summary", { hasText: `Delete the ${lang} course` }).click();
  await expect(page.getByText("You cannot undo this.")).toBeVisible();
  const del = page.getByRole("button", { name: `Delete the ${lang} course` });
  await expect(del).toBeDisabled();
  await page.getByLabel(/to confirm/).fill(lang);
  await del.click();
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toBeVisible();
});
