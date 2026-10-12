import { expect, test } from "@playwright/test";
import { advance, startCourse, startSession } from "./helpers";

test("smoke: landing → start learning → a session → progress survives a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toBeVisible();
  await page.getByRole("button", { name: /Start learning Spanish/ }).click();
  await expect(page.getByText(/words are ready/)).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /today's session/ }).click();
  await expect(page.locator(".kicker")).toBeVisible();
  // Answer "I knew it" on the first new word: that records a review.
  await page.getByRole("button", { name: /I knew it/ }).click();
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: /^Done/ }).click();
  await page.reload();
  await expect(page.getByText(/You are learning|You know/)).toBeVisible({ timeout: 15000 });
});

test("offline: practice still works, a quiet note says so, and it goes when the connection is back", async ({ page, context }) => {
  await startCourse(page);
  const note = page.getByRole("status").filter({ hasText: "Offline. Practice still works" });
  await expect(note).toHaveCount(0);
  await context.setOffline(true);
  await expect(note).toBeVisible();
  // The note is true: a session starts and takes an answer with no connection.
  await startSession(page);
  await advance(page, "1");
  await context.setOffline(false);
  await expect(note).toHaveCount(0);
});
