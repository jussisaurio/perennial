import { expect, test, type Page } from "@playwright/test";
import { advance, expectServerRows, grade, kicker, serverRows, startCourse, startSession } from "./helpers";

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
  await page.waitForTimeout(1500); // give a wrong write time to arrive, if there were one
  expect(await serverRows(page, "review")).toHaveLength(0);
});

test("Forgot is acknowledged, retried with its own label, and undo reverts it on the server too", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await continueIntros(page, 4);
  const checked = (await page.locator(".prompt b").textContent())!;
  await page.keyboard.press("Space");
  await page.waitForTimeout(450); // past the double-click guard
  await page.getByRole("button", { name: /I forgot/ }).click();
  await expect(page.getByRole("status")).toHaveText(/see this word again soon/);
  await expectServerRows(page, "review", 1);

  // Undo brings the same card back and deletes the review.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".prompt b")).toHaveText(new RegExp(`^${checked}$`, "i"));
  await expectServerRows(page, "review", 0);

  // Forget again for real, then the retry arrives labelled as such.
  await grade(page, "1");
  for (let i = 0; i < 8; i++) {
    const k = (await kicker(page).textContent()) ?? "";
    if (k.includes("try again")) break;
    if (k.includes("new word") && !k.includes("quick")) await advance(page, "Space");
    else await grade(page, "2");
  }
  await expect(kicker(page)).toHaveText(/try again/);
  // The same word, perhaps in another sentence (so maybe capitalised).
  await expect(page.locator(".prompt b")).toHaveText(new RegExp(`^${checked}$`, "i"));
});

test("'I knew it' skips the quick check, says so, is stored as 'known', and is undoable", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await advance(page, "k");
  await expect(page.getByRole("status")).toContainText("You will see this word again in about a week");
  await expectServerRows(page, "review", 1);
  const [r] = await serverRows<{ grade: number; kind: string }>(page, "review");
  expect(r).toMatchObject({ grade: 4, kind: "known" });
  await advance(page, "z");
  await expect(kicker(page)).toHaveText(/new word/);
  await expectServerRows(page, "review", 0);
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
