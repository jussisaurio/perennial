import { expect, test, type Page } from "./test";
import { advance, answer, expectServerRows, kicker, reveal, serverRows, startCourse, startSession, tabTo } from "./helpers";

async function continueIntros(page: Page, n: number) {
  for (let i = 0; i < n; i++) {
    await expect(kicker(page)).toHaveText(/new word/);
    await answer(page, "1");
  }
}

test("intro → quick check loop, with the hint explaining it", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  // The meaning stays hidden until the learner looks, and the answer keys wait for it (#196).
  await expect(page.locator(".word")).toBeVisible();
  await expect(page.locator(".gloss")).toHaveCount(0);
  await expect(page.locator(".translation")).toHaveCount(0);
  const front = await page.locator(".session").getAttribute("data-card");
  await page.keyboard.press("2");
  await expect(page.locator(".session")).toHaveAttribute("data-card", front!);
  await expect(page.getByRole("button", { name: /I knew it/ })).toHaveCount(0);
  await reveal(page);
  await expect(page.locator(".session")).toHaveAttribute("data-card", front!); // still the same card: the early "2" did not answer it
  await expect(page.locator(".gloss")).toBeVisible();
  // Then it asks a question whose answers say what happens next.
  await expect(page.getByText("Is this word new to you?", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /New to me.*quick check comes in a moment/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /I knew it.*Back in about a week/ })).toBeVisible();
  const word = await page.locator(".word").textContent();
  const sentence = (await page.locator("main.card .sentence").textContent())!.trim();
  await continueIntros(page, 4);
  await expect(kicker(page)).toHaveText(/quick check/);
  // About the same word, though the prompt may show another form of it ("vez" → "What does veces mean?").
  await expect(page.locator("main.card")).toHaveAttribute("data-lemma", word!.trim());
  // In another sentence than the new-word card: one seen a moment ago proves little (#268).
  await expect(page.locator("main.card .sentence")).not.toHaveText(sentence);
  // The hint explains the first few checks, and stays when the answer shows, so the card does not jump (#270).
  const hint = page.getByText("Think of the meaning first.", { exact: false });
  await expect(hint).toBeVisible();
  await reveal(page);
  await expect(hint).toBeVisible();
  await advance(page, "2");
  await answer(page, "2");
  await answer(page, "2");
  // The fourth check: no hint any more.
  await expect(kicker(page)).toHaveText(/quick check/);
  await expect(hint).toHaveCount(0);
});

test("German: nouns come with their article on the card and in Words; an answer says whose form was asked (#259, #260)", async ({ page }) => {
  await startCourse(page, "German");
  await startSession(page);
  // The course starts with a noun: its card shows the article.
  await expect(kicker(page)).toHaveText(/new word/);
  const noun = (await page.locator(".word").textContent())!.trim();
  expect(noun).toMatch(/^(der|die|das) \S+$/);
  await expect(page.locator(".said")).toHaveText(`New word: ${noun}.`); // a screen reader hears the article too
  // Through the new words and their quick checks until one asks about another form of its word.
  // Which sentence a card shows is fixed by the word, so this is the same card every run.
  let form = "";
  for (let i = 0; i < 30 && !form; i++) {
    await reveal(page);
    if ((await page.locator(".form-of").count()) > 0) form = (await page.locator(".form-of").textContent())!;
    else await advance(page, "1");
  }
  const asked = (await page.locator(".prompt b").textContent())!;
  expect(form).toMatch(new RegExp(`^${asked} is a form of \\S+( \\S+)?\\.$`));
  await expect(page.locator(".said")).toContainText(form); // and the line it hears says so

  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: /^Done/ }).click();
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByPlaceholder("Search words or meanings").fill(noun.toLowerCase()); // the article finds it too
  await expect(page.locator(`.word-row strong:text-is("${noun}")`)).toBeVisible();
});

test("the summary says what \"I knew it\" did: back in a week, then known (#261)", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  for (let i = 0; i < 2; i++) {
    await expect(kicker(page)).toHaveText(/new word/);
    await answer(page, "2");
  }
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByText("You said you already knew 2 words. They come back in about a week. Remember them then, and they count as known.")).toBeVisible();
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

test("Forgot is retried with its own label, and undo reverts it on the server too", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await continueIntros(page, 4);
  const checked = (await page.locator(".prompt b").textContent())!;
  const lemma = (await page.locator("main.card").getAttribute("data-lemma"))!;
  await reveal(page);
  await page.getByRole("button", { name: /I forgot/ }).click();
  await expectServerRows(page, "review", 1);

  // Undo brings the same card back and deletes the review.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".prompt b")).toHaveText(new RegExp(`^${checked}$`, "i"));
  await expectServerRows(page, "review", 0);

  // Forget again for real, then the retry arrives labelled as such.
  await answer(page, "1");
  for (let i = 0; i < 8; i++) {
    const k = (await kicker(page).textContent()) ?? "";
    if (k.includes("try again")) break;
    if (k.includes("new word") && !k.includes("quick")) await answer(page, "1");
    else await answer(page, "2");
  }
  await expect(kicker(page)).toHaveText(/try again/);
  // The same word, perhaps in another sentence and so another form of it.
  await expect(page.locator("main.card")).toHaveAttribute("data-lemma", lemma);
});

test("'I knew it' skips the quick check (no extra note: the button said so), is stored as 'known', and is undoable", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await answer(page, "2");
  await expect(page.locator(".session-note")).toHaveCount(0); // the button already promised "Back in about a week"
  await expectServerRows(page, "review", 1);
  const [r] = await serverRows<{ grade: number; kind: string }>(page, "review");
  expect(r).toMatchObject({ grade: 4, kind: "known" });
  await expect(page.locator("button.undo kbd")).toHaveText("Z"); // Undo shows its key, as the answers do (#272)
  await advance(page, "z");
  await expect(kicker(page)).toHaveText(/new word/);
  await expectServerRows(page, "review", 0);
  // The familiar Ctrl+Z undoes too (#272).
  await answer(page, "2");
  await expectServerRows(page, "review", 1);
  await advance(page, "Control+z");
  await expectServerRows(page, "review", 0);
});

test("leaving after doing something shows the summary", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await answer(page, "1");
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.locator(".summary h1")).toHaveText("You saw 1 new word."); // no answer yet, so not planted
  await expect(page.getByText("session paused", { exact: true })).toBeVisible(); // not "complete" when you leave early
  await page.getByRole("button", { name: /Done/ }).click();
  await expect(page.getByRole("button", { name: /today's 5 minutes/i })).toBeVisible();
});

// #254: a paused session says what "New to me" words still need, and Continue
// goes back to the same card, with their quick checks still to come.
test("a paused session can continue, and keeps its quick checks", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  const first = (await page.locator(".word").textContent())!.trim();
  await answer(page, "1"); // New to me
  await expect(kicker(page)).toHaveText(/new word/);
  const second = (await page.locator(".word").textContent())!.trim();
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.locator(".summary")).toContainText("A new word is planted after its quick check. Tap Continue: its quick check comes in a few cards. If you stop, it comes back as a new word next time.");
  await expect(page.locator(".summary")).not.toContainText(/(^|\D)0 words/); // nothing started yet, though one word was seen
  await expect(page.getByRole("button", { name: "Practice 5 more minutes" })).toHaveCount(0); // Continue is the way on
  await page.getByRole("button", { name: "Continue this session" }).click();
  await expect(page.locator(".word")).toHaveText(second); // the card it left
  for (let i = 0; i < 6 && !/quick check/.test((await kicker(page).textContent()) ?? ""); i++) await answer(page, "1");
  await expect(kicker(page)).toHaveText(/quick check/);
  await expect(page.locator("main.card")).toHaveAttribute("data-lemma", first);
  await answer(page, "2");
  await expectServerRows(page, "review", 1);
});

// #254 review: End pressed while an answer is still finishing (its growth moment)
// must keep the pause screen, and Continue must start the session clock again.
test("ending the session while an answer finishes keeps the pause, and the clock runs after Continue", async ({ page }) => {
  await page.clock.install();
  await startCourse(page);
  await startSession(page);
  await answer(page, "2"); // "I knew it": something to show on the pause screen
  await reveal(page);
  // The answer and End in one moment: End lands while the answer is still being recorded.
  await page.evaluate(() => {
    for (const key of ["2", "Escape"]) window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  await expect(page.locator("main.summary")).toBeVisible();
  await page.clock.runFor(1_000);
  await expect(page.locator("main.summary")).toBeVisible(); // the next card did not come over it
  const before = new Set((await serverRows<{ id: string }>(page, "review")).map((r) => r.id));
  await page.getByRole("button", { name: "Continue this session" }).click();
  await expect(kicker(page)).toBeVisible();
  await page.clock.runFor(5_000); // reading the card
  await answer(page, "2");
  await expect.poll(async () => (await serverRows(page, "review")).length).toBe(before.size + 1);
  const added = (await serverRows<{ id: string; duration_ms: number }>(page, "review")).find((r) => !before.has(r.id))!;
  expect(added.duration_ms).toBeGreaterThanOrEqual(4_000);
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
  await answer(page, "2");
  await expect.poll(async () => (await serverRows(page, "review")).length).toBeGreaterThan(0);
  const [first] = await serverRows<{ duration_ms: number }>(page, "review");
  expect(first.duration_ms).toBeGreaterThanOrEqual(20_000);
});

test("on the summary, Enter on a focused button presses that button, not the main choice (#239)", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await answer(page, "2");
  await page.getByRole("button", { name: "End session" }).click();
  await tabTo(page, page.getByRole("button", { name: "Done" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /today's 5 minutes/i })).toBeVisible(); // Today, not Continue
  // With nothing focused, Enter on the pause screen is Continue (#254): Done would drop the quick checks.
  await startSession(page);
  await answer(page, "1");
  await page.getByRole("button", { name: "End session" }).click();
  await page.locator("main.summary h1").click();
  await page.keyboard.press("Enter");
  await expect(kicker(page)).toBeVisible();
  await expect(page.locator("main.summary")).toHaveCount(0);
});

// #253: the server refuses answers dated more than a day ahead. A device clock
// that far off loses them, and the app must say so, never "saved".
test("an answer the server refuses is reported, not called saved", async ({ page, allowConsoleError }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // The clock-ahead answers (below) are refused by design; the app logs the refusal it reports in the card.
  allowConsoleError(/^review not saved/, "this test's clock is deliberately days ahead, so the server refuses each answer");
  // Three days ahead of the server's real clock.
  await page.clock.setFixedTime(new Date(Date.now() + 3 * 86_400_000));
  await startCourse(page);
  await startSession(page);
  await answer(page, "2"); // "I knew it": a review
  // Said in place at the top of the session, never in a toast over the answer buttons.
  const line = page.locator(".refused");
  await expect(line).toHaveText(/^1 answer was not saved, because the date or time on this device is wrong/);
  await expect(page.locator(".toast")).toHaveCount(0);
  await answer(page, "2");
  await expect(line).toHaveText(/^2 answers were not saved, because the date or time on this device is wrong/);
  await expect(page.locator(".toast")).toHaveCount(0);
  await page.getByRole("button", { name: "End session" }).click();
  await expect(line).toHaveCount(1); // the summary says it once
  await expect(line).toHaveText(/^2 answers were not saved/);
  await expect(page.getByText("Your answers are saved")).toHaveCount(0);
  await page.getByRole("button", { name: /Done/ }).click();
  await expect(page.getByRole("button", { name: /today's 5 minutes/i })).toBeVisible();
  await expect(page.locator(".toast")).toHaveCount(0); // already told
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(line).toHaveText(/^2 answers were not saved/);
  await expect(page.getByText(/All changes are saved/)).toHaveCount(0);
  expect(await serverRows(page, "review")).toHaveLength(0);
});

test("Enter or Space on a button reached with Tab presses that button, not the card's key (#256)", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await answer(page, "1");
  await expect(kicker(page)).toHaveText(/new word/);
  const gloss = page.locator(".gloss");
  // Space on "Play the word" plays the word, and the meaning stays hidden.
  await tabTo(page, page.getByRole("button", { name: "Play the word" }));
  await page.keyboard.press("Space");
  await expect(gloss).toHaveCount(0);
  // Enter on Undo undoes at once, without showing this card's meaning first.
  await tabTo(page, page.getByRole("button", { name: "Undo" }));
  await page.keyboard.press("Enter");
  await expect(page.locator(".session-note")).toHaveText("Undone.");
  await expect(gloss).toHaveCount(0);
  // A mouse click leaves focus on its button, but Space and Enter still mean the card's keys.
  await page.getByRole("button", { name: "Play the word" }).click();
  await page.keyboard.press("Space");
  await expect(gloss).toBeVisible();
  await expect(page.locator("main.card")).toHaveAttribute("data-armed", "true");
  await advance(page, "1");
  // Even on a button first reached with Tab: the click makes it the mouse's.
  await tabTo(page, page.getByRole("button", { name: "Mute sound" }));
  await page.getByRole("button", { name: "Mute sound" }).click();
  await page.keyboard.press("Enter");
  await expect(gloss).toBeVisible();
  await expect(page.getByRole("button", { name: "Mute sound" })).toHaveAttribute("aria-pressed", "true"); // pressed once, by the click
  // Enter on End session ends it.
  await tabTo(page, page.getByRole("button", { name: "End session" }));
  await page.keyboard.press("Enter");
  await expect(page.locator("main.summary")).toBeVisible();
});

test("a screen reader hears each step, and focus stays in the card (#257)", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  // Focus is on the card's hidden line, so a screen reader reads it.
  const said = page.locator("main.card .said");
  const word = (await page.locator(".word").textContent())!.trim();
  await expect(said).toBeFocused();
  await expect(said).toHaveText(`New word: ${word}.`);
  await reveal(page);
  // The Show button is gone: focus moves to the answer's line, not to the page body.
  await expect(said).toBeFocused();
  const gloss = await page.locator(".gloss").evaluate((el) => el.lastChild!.textContent!);
  await expect(said).toContainText(`${word}, `);
  await expect(said).toContainText(gloss);
  await advance(page, "1");
  await expect(said).toBeFocused();
  const next = (await page.locator(".word").textContent())!.trim();
  await expect(said).toHaveText(`New word: ${next}.`);
  // Tab goes on into the card, not back to the top bar.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Play the word" })).toBeFocused();
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.locator("main.summary .said")).toBeFocused();
  await expect(page.locator("main.summary .said")).toHaveText(/^Session paused\. /);
});

test("buttons and meanings have names a screen reader reads clearly (#266)", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  // The two speakers say what they play.
  await expect(page.getByRole("button", { name: "Play the word", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play the sentence", exact: true })).toBeVisible();
  // The shown key is not part of the name; the button says its key another way.
  const show = page.getByRole("button", { name: "Show meaning", exact: true });
  await expect(show).toHaveAttribute("aria-keyshortcuts", "Space");
  await reveal(page);
  // The word class and the meaning are two words, not "nountime".
  const pos = (await page.locator(".gloss .pos").textContent())!;
  await expect(page.locator(".gloss")).toHaveText(new RegExp(`^${pos} \\S`));
});
