import { expect, test } from "./test";
import { answer, reveal, startCourse, startSession } from "./helpers";

test("smoke: landing → start learning → a session → progress survives a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toBeVisible();
  await page.getByRole("button", { name: /Start learning Spanish/ }).click();
  await expect(page.getByText(/seeds are ready/)).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /today's practice/i }).click();
  await expect(page.locator(".kicker")).toBeVisible();
  // Answer "I knew it" on the first new word: that records a review.
  // With a key: a click on "I knew it" this soon after a click on Show would be dropped as a double-click.
  await reveal(page);
  await page.getByRole("button", { name: /I knew it/ }).click();
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: /^Done/ }).click();
  await page.reload();
  // Progress is on the Words page.
  await page.getByRole("tab", { name: "Words" }).click();
  await expect(page.getByRole("region", { name: "Your progress" })).toContainText("You are learning 1 word.", { timeout: 15000 });
});

test("a first read that began before the course was written does not leave the learner on Loading (#529)", async ({ page }) => {
  // The course is written only once the server has read the rows (with no course yet);
  // that read's answer never comes, so the app must read again.
  let rowsRead!: () => void;
  const read = new Promise<void>((r) => (rowsRead = r));
  let written = false;
  page.on("response", (r) => {
    if (r.url().endsWith("/api/write")) written = true;
  });
  await page.route("**/api/write", async (route) => {
    await read;
    await route.continue();
  });
  await page.route("**/api/rows", async (route) => {
    if (written) return route.continue();
    await route.fetch();
    rowsRead();
  });
  await startCourse(page);
});

test("a deck that cannot load: the learner is told, not left on a loading screen", async ({ page, allowConsoleError }) => {
  await startCourse(page);
  // The aborted deck fetch (below) is refused by design; the app logs the failure it shows in the alert.
  allowConsoleError(/^\[deck\] es: could not load/, "this test deliberately aborts the deck file to check the failure is shown");
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
  await answer(page, "1");
  await context.setOffline(false);
});
