import { expect, test } from "@playwright/test";
import { answerIntro, startCourse, startSession } from "./helpers";

test("smoke: landing → start learning → a session → progress survives a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toBeVisible();
  await page.getByRole("button", { name: /Start learning Spanish/ }).click();
  await expect(page.getByText(/seeds are ready/)).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /today's 5 minutes/i }).click();
  await expect(page.locator(".kicker")).toBeVisible();
  // Answer "I knew it" on the first new word: that records a review.
  await page.getByRole("button", { name: /Show meaning/ }).click();
  await expect(page.locator("main.card")).toHaveAttribute("data-armed", "true");
  await page.getByRole("button", { name: /I knew it/ }).click();
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: /^Done/ }).click();
  await page.reload();
  await expect(page.getByText(/You are learning|You know/)).toBeVisible({ timeout: 15000 });
});

test("a deck that cannot load, with no copy kept: the learner is told, not left on a loading screen", async ({ page }) => {
  await startCourse(page);
  // As offline before the deck was ever cached: no saved copy, and the deck file fails.
  await page.evaluate(() => caches.delete("perennial-decks"));
  const deckFile = "**/decks/es/deck.json*";
  await page.route(deckFile, (route) => route.abort());
  await page.reload();
  const failed = page.getByRole("alert").filter({ hasText: "Could not load the Spanish words" });
  await expect(failed).toBeVisible();
  // Not a dead end: the top bar stays, and Settings (which needs no deck) still opens.
  await expect(page.locator(".course-switch-button")).toHaveText(/Spanish/);
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Colors" })).toBeVisible();
  await expect(failed).toHaveCount(0);
  await page.getByRole("tab", { name: "Today" }).click();
  await expect(failed).toBeVisible();
  // Once the deck can load again, Reload brings the words back.
  await page.unroute(deckFile);
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByText(/seeds are ready/)).toBeVisible({ timeout: 15_000 });
});

test("connection lost mid-session: practice continues", async ({ page, context }) => {
  await startCourse(page);
  await startSession(page);
  await context.setOffline(true);
  // The answer goes into the write queue; the session takes it with no connection.
  await answerIntro(page, "1");
  await context.setOffline(false);
});
