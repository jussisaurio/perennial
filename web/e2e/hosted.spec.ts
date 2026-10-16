import { expect, test } from "./test";
import { addEmail, answer, expectServerRows, newEmail, openAdd, signIn, startCourse, startSession } from "./helpers";

test("progress made before adding an email stays, and another device signs in to the same garden", async ({ browser }) => {
  const one = await browser.newPage();
  await startCourse(one);
  await startSession(one);
  await answer(one, "2"); // "I knew it": one review, still anonymous
  await expectServerRows(one, "review", 1);
  await one.getByRole("button", { name: "End session" }).click();
  await one.getByRole("button", { name: /Done/ }).click();
  const address = await addEmail(one);
  await expectServerRows(one, "review", 1); // moved into the account

  const two = await (await browser.newContext()).newPage();
  await two.goto("/");
  await two.getByRole("button", { name: "Sign in", exact: true }).click();
  await signIn(two, address, "Send me a code");
  await expect(two.getByText(/You are learning|You know/)).toBeVisible({ timeout: 15_000 });
});

test("words from a text use AI words; the limit is clear before anything is sent", async ({ page }) => {
  await startCourse(page);
  await addEmail(page, newEmail("miner"));
  await openAdd(page);
  await page.getByPlaceholder(/Paste .* text here/).fill("lobo castor lince nutria tejón garza ciervo");
  await expect(page.getByText(/you have 6 of 6 AI words left this month/)).toBeVisible();
  for (const w of ["lobo", "castor", "lince", "nutria", "tejón", "garza", "ciervo"]) await page.locator(".reader .tok", { hasText: w }).click();

  // 7 picked, 6 left: the app says exactly that, and nothing is sent.
  await expect(page.getByRole("button", { name: /Learn 7 words · uses 7 AI words/ })).toBeDisabled();
  await expect(page.getByText(/You selected 7 words that are not in the course, but you have only 6 AI words left this month\. Select 1 fewer/)).toBeVisible();
  await expect(page.getByText(/Pro|Upgrade/)).toHaveCount(0);

  // One fewer fits, and is spent: the words and their sentences are saved.
  await page.locator(".reader .tok", { hasText: "ciervo" }).click();
  await page.getByRole("button", { name: /Learn 6 words · uses 6 AI words/ }).click();
  await expect(page.getByText(/Added 6 words/)).toBeVisible();
  await expectServerRows(page, "user_word", 6);

  // None left (the count updates after spending): one word picked, and the note says when they come back.
  await page.locator(".reader .tok", { hasText: "ciervo" }).click();
  await expect(page.getByText(/You selected 1 word that is not in the course, but you have no AI words left this month\. Wait until /)).toBeVisible();

  // Your own words are easy to find again (newest first; one batch shares a time).
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("combobox").selectOption("mine");
  await expect(page.locator(".word-row")).toHaveCount(6);
  for (const w of ["lobo", "castor", "lince", "nutria", "tejón", "garza"]) await expect(page.locator(".word-row strong", { hasText: w })).toHaveCount(1);
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

test("when the AI word count cannot load, nothing is blocked and the server says when they run out", async ({ page }) => {
  await startCourse(page);
  await addEmail(page);
  await page.route("**/api/me", (route) => route.fulfill({ status: 500, body: "" }));

  // The count is unknown: no count is shown, and AI words can still be picked.
  await openAdd(page);
  await page.getByPlaceholder(/Paste .* text here/).fill("lobo castor lince nutria tejón garza ciervo");
  for (const w of ["lobo", "castor", "lince", "nutria", "tejón", "garza", "ciervo"]) await page.locator(".reader .tok", { hasText: w }).click();
  await expect(page.getByText(/AI words? left this month/)).toHaveCount(0);

  // 7 words, 6 left: the server refuses, and says why.
  await page.getByRole("button", { name: /Learn 7 words · uses 7 AI words/ }).click();
  await expect(page.getByText(/Could not add the words: You have only 6 AI words left this month\. Select fewer words, or wait until/)).toBeVisible();
  await expectServerRows(page, "user_word", 0);
  await page.locator(".reader .tok", { hasText: "ciervo" }).click();
  await page.getByRole("button", { name: /Learn 6 words · uses 6 AI words/ }).click();
  await expect(page.getByText(/Added 6 words/)).toBeVisible();

  // The Words screen follows the same rule: allowed, and the server says no.
  await page.getByRole("button", { name: /← Words/ }).click();
  await page.getByRole("combobox").selectOption("new");
  await page.locator(".word-row").first().click();
  await expect(page.getByText(/you have none left/)).toHaveCount(0);
  await page.getByRole("button", { name: "Write new sentences" }).click();
  await expect(page.locator(".detail .error")).toHaveText("You used all your AI words for this month.");
});

// #161: AI words go in batches of 15. If a later batch fails, the earlier ones are saved:
// say how many, and unselect them so trying again sends only the rest.
test("adding many AI words: a batch that fails after others were saved says what was added", async ({ page }) => {
  await startCourse(page);
  await addEmail(page);
  // The count is unknown (so nothing blocks); the first batch is answered, the second is busy.
  await page.route("**/api/me", (route) => route.fulfill({ status: 500, body: "" }));
  let calls = 0;
  const sent: number[] = [];
  await page.route("**/api/ai/mine", async (route) => {
    const { items } = route.request().postDataJSON() as { items: { form: string; sentence: string }[] };
    sent.push(items.length);
    if (++calls === 2) return route.fulfill({ status: 503, json: { error: "busy" } });
    const words = items.map(({ form, sentence }) => ({ lemma: form, gloss: "a test word", pos: "noun", forms: [form], examples: [{ text: sentence, translation: "x", cloze: form }] }));
    await route.fulfill({ json: { words, model: "mock", credits: { used: items.length, limit: 100, left: 100 - items.length } } });
  });
  const forms = Array.from({ length: 16 }, (_, i) => `xz${String.fromCharCode(97 + i)}po`);
  await openAdd(page);
  await page.getByPlaceholder(/Paste .* text here/).fill(forms.join(" "));
  for (const w of forms) await page.locator(".reader .tok", { hasText: w }).click();
  await page.getByRole("button", { name: /Learn 16 words · uses 16 AI words/ }).click();
  await expect(page.getByText(/Added 15 words \(marked ✓\)\. The rest could not be added: Perennial AI is very busy now/)).toBeVisible();
  await expectServerRows(page, "user_word", 15);
  // Only the one that failed is still selected, and trying again sends only it.
  await page.getByRole("button", { name: /Learn 1 word · uses 1 AI word/ }).click();
  await expect(page.getByText(/Added 1 word \(marked ✓\)/)).toBeVisible();
  expect(sent).toEqual([15, 1, 1]);
  await expectServerRows(page, "user_word", 16);
});
