import { expect, test } from "@playwright/test";
import { addEmail, advance, expectServerRows, newEmail, openAdd, signIn, startCourse, startSession } from "./helpers";

test("progress made before adding an email stays, and another device signs in to the same garden", async ({ browser }) => {
  const one = await browser.newPage();
  await startCourse(one);
  await startSession(one);
  await advance(one, "2"); // "I knew it": one review, still anonymous
  await expectServerRows(one, "review", 1);
  await one.getByRole("button", { name: "End session" }).click();
  await one.getByRole("button", { name: /Done/ }).click();
  const address = await addEmail(one);
  await expectServerRows(one, "review", 1); // moved into the account

  const two = await (await browser.newContext()).newPage();
  await two.goto("/");
  await two.getByRole("button", { name: "Sign in", exact: true }).click();
  await signIn(two, address, "Sign in");
  await expect(two.getByText(/You are learning|You know/)).toBeVisible({ timeout: 15_000 });
});

test("words from a text use AI words; the limit is clear before anything is sent", async ({ page }) => {
  await startCourse(page);
  await addEmail(page, newEmail("miner"));
  await openAdd(page);
  await page.getByPlaceholder(/Paste .* text here/).fill("zorro búho lince nutria tejón garza ciervo");
  await expect(page.getByText(/you have 6 of 6 AI words left this month/)).toBeVisible();
  for (const w of ["zorro", "búho", "lince", "nutria", "tejón", "garza", "ciervo"]) await page.locator(".reader .tok", { hasText: w }).click();

  // 7 picked, 6 left: the app says exactly that, and nothing is sent.
  await expect(page.getByRole("button", { name: /Learn 7 words · uses 7 AI words/ })).toBeDisabled();
  await expect(page.getByText(/You selected 7 words that are not in the course, but you have only 6 AI words left this month\. Select 1 fewer/)).toBeVisible();
  await expect(page.getByText(/Pro|Upgrade/)).toHaveCount(0);

  // One fewer fits, and is spent: the words and their sentences are saved.
  await page.locator(".reader .tok", { hasText: "ciervo" }).click();
  await page.getByRole("button", { name: /Learn 6 words · uses 6 AI words/ }).click();
  await expect(page.getByText(/Added 6 words/)).toBeVisible();
  await expectServerRows(page, "user_word", 6);

  // Your own words are easy to find again (newest first; one batch shares a time).
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("combobox").selectOption("mine");
  await expect(page.locator(".word-row")).toHaveCount(6);
  for (const w of ["zorro", "búho", "lince", "nutria", "tejón", "garza"]) await expect(page.locator(".word-row strong", { hasText: w })).toHaveCount(1);
});

test("Perennial AI can write new sentences for a word, and undo removes them", async ({ page }) => {
  await startCourse(page);
  await addEmail(page);
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("combobox").selectOption("new");
  await page.locator(".word-row").first().click();
  const detail = page.locator(".detail");
  const before = await detail.locator(".examples li").count();
  await page.getByRole("button", { name: "Write new sentences" }).click();
  await expect(page.getByText(/Wrote \d+ new sentences?\./)).toBeVisible();
  await expect(detail.locator(".author", { hasText: "Written for you by Perennial AI" }).first()).toBeVisible();
  await expectServerRows(page, "user_sentence", (n) => n > 0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(detail.locator(".examples li")).toHaveCount(before);
  await expectServerRows(page, "user_sentence", 0);
});
