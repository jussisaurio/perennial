import { expect, test, type Page } from "@playwright/test";
import { advance, expectServerRows, grade, kicker, reveal, serverRows, startCourse, startSession } from "./helpers";

async function continueIntros(page: Page, n: number) {
  for (let i = 0; i < n; i++) {
    await expect(kicker(page)).toHaveText(/new word/);
    await advance(page, "1");
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
  // About the same word, though the prompt may show another form of it ("vez" → "What does veces mean?").
  await expect(page.locator("main.card")).toHaveAttribute("data-lemma", word!.trim());
});

test("double-clicking Show does not grade the unseen answer", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await continueIntros(page, 4);
  const card = await page.locator(".session").getAttribute("data-card");
  await page.getByRole("button", { name: /Show answer/ }).dblclick();
  await expect(page.getByRole("button", { name: /I remembered/ })).toBeVisible();
  await expect(page.locator(".session")).toHaveAttribute("data-card", card!); // still the same card
  // Grade "I forgot" for real. Writes upload in order, so once that one is on
  // the server, a stray "I remembered" from the double-click would be too.
  await expect(page.locator("main.card")).toHaveAttribute("data-armed", "true");
  await page.getByRole("button", { name: /I forgot/ }).click();
  await expect.poll(async () => (await serverRows<{ grade: number }>(page, "review")).some((r) => r.grade === 1), { timeout: 15_000 }).toBe(true);
  expect(await serverRows(page, "review")).toHaveLength(1);
});

test("Forgot is acknowledged, retried with its own label, and undo reverts it on the server too", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await continueIntros(page, 4);
  const checked = (await page.locator(".prompt b").textContent())!;
  const lemma = (await page.locator("main.card").getAttribute("data-lemma"))!;
  await reveal(page);
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
    if (k.includes("new word") && !k.includes("quick")) await advance(page, "1");
    else await grade(page, "2");
  }
  await expect(kicker(page)).toHaveText(/try again/);
  // The same word, perhaps in another sentence and so another form of it.
  await expect(page.locator("main.card")).toHaveAttribute("data-lemma", lemma);
});

test("'I knew it' skips the quick check (no extra note: the button said so), is stored as 'known', and is undoable", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await advance(page, "2");
  await expect(page.locator(".session-note")).toHaveCount(0); // the button already promised "Back in about a week"
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
  await advance(page, "1");
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.locator(".summary h1")).not.toHaveText("Nothing to practice now."); // the headline rotates daily
  await expect(page.getByText("session paused")).toBeVisible(); // not "complete" when you leave early
  await expect(page.getByText("new word", { exact: true })).toBeVisible(); // singular
  await page.getByRole("button", { name: /Done/ }).click();
  await expect(page.getByRole("button", { name: /today's session/ })).toBeVisible();
});

// #189: minutes are the only unit, so every second counts, the new-word card's too.
test("time on a new-word card counts toward today's minutes", async ({ page }) => {
  await page.clock.install();
  await startCourse(page);
  await startSession(page);
  await expect(kicker(page)).toHaveText(/new word/);
  await page.clock.runFor(20_000); // reading the first new word (second by second: the session clock caps jumps)
  await continueIntros(page, 4);
  await expect(kicker(page)).toHaveText(/quick check/);
  await reveal(page);
  await grade(page, "2");
  await expect.poll(async () => (await serverRows<{ word_id: string; duration_ms: number }>(page, "review")).length).toBeGreaterThan(0);
  const [first] = await serverRows<{ duration_ms: number }>(page, "review");
  expect(first.duration_ms).toBeGreaterThanOrEqual(20_000);
});
