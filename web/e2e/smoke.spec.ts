import { expect, test } from "@playwright/test";
import { advance, expectServerRows, startCourse, startSession } from "./helpers";

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
  await expect(page.getByText(/words are ready/)).toBeVisible({ timeout: 15_000 });
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

test("the device keeps a copy: with the server's data stream down, the learner's course still comes back", async ({ page, context }) => {
  await startCourse(page);
  // Sent and confirmed, so the course is not waiting in the offline queue: only the copy can bring it back.
  await expectServerRows(page, "course", 1);
  // Closed, not reloaded: the old page's SQLite workers stop before the new page opens the copy (#186).
  await page.close();
  const again = await context.newPage();
  await again.route("**/api/shape**", (route) => route.abort());
  await again.goto("/");
  await expect(again.locator(".course-switch-button")).toHaveText(/Spanish/);
});
