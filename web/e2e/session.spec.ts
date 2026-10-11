import { expect, test, type Page } from "@playwright/test";
import { advance, grade, kicker, startCourse, startSession, store } from "./helpers";

async function continueIntros(page: Page, n: number) {
  for (let i = 0; i < n; i++) {
    await expect(kicker(page)).toHaveText(/new word/);
    await advance(page, "Space");
  }
}

test("intro → quick check loop, with the hint explaining it", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  // The new-word card asks a question whose answers say what happens next.
  await expect(page.getByText("Is this word new to you?")).toBeVisible();
  await expect(page.getByRole("button", { name: /New to me.*quick check comes in a moment/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /I knew it.*Back in about a week/ })).toBeVisible();
  const word = await page.locator(".word").textContent();
  await continueIntros(page, 4);
  await expect(kicker(page)).toHaveText(/quick check/);
  await expect(page.locator(".prompt")).toContainText(word!.trim());
});

test("double-clicking Show does not grade the unseen answer", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await continueIntros(page, 4);
  await page.getByRole("button", { name: /Show answer/ }).dblclick();
  await expect(page.getByRole("button", { name: /I remembered/ })).toBeVisible();
  expect(await store(page, "reviews")).toHaveLength(0);
});

test("Forgot is acknowledged, retried with its own label, and undo reverts it", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await continueIntros(page, 4);
  const checked = (await page.locator(".prompt b").textContent())!;
  await page.keyboard.press("Space");
  await page.waitForTimeout(450); // past the double-click guard
  await page.getByRole("button", { name: /I forgot/ }).click();
  await expect(page.getByRole("status")).toHaveText(/see this word again soon/);

  // Undo brings the same card back and tombstones the review.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".prompt b")).toHaveText(checked);
  const reviews = await store<{ deleted?: number }>(page, "reviews");
  expect(reviews.filter((r) => !r.deleted)).toHaveLength(0);

  // Forget again for real, then the retry arrives labelled as such.
  await grade(page, "1");
  for (let i = 0; i < 8; i++) {
    const k = (await kicker(page).textContent()) ?? "";
    if (k.includes("try again")) break;
    if (k.includes("new word") && !k.includes("quick")) await advance(page, "Space");
    else await grade(page, "2");
  }
  await expect(kicker(page)).toHaveText(/try again/);
  await expect(page.locator(".prompt b")).toHaveText(checked);
});

test("'I knew it' skips the quick check, says so, and is undoable", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await advance(page, "k");
  await expect(page.getByRole("status")).toContainText("You will see this word again in about a week");
  const reviews = await store<{ grade: number }>(page, "reviews");
  expect(reviews.map((r) => r.grade)).toEqual([4]);
  await advance(page, "z");
  await expect(kicker(page)).toHaveText(/new word/);
  const after = await store<{ deleted?: number }>(page, "reviews");
  expect(after.every((r) => r.deleted)).toBe(true);
});

test("leaving after doing something shows the summary", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await advance(page, "Space");
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByRole("heading", { name: "Well done." })).toBeVisible();
  await expect(page.getByText("session paused")).toBeVisible(); // not "complete" when you leave early
  await expect(page.getByText("new word", { exact: true })).toBeVisible(); // singular
  await page.getByRole("button", { name: /Done/ }).click();
  await expect(page.getByRole("button", { name: /today's session/ })).toBeVisible();
});
