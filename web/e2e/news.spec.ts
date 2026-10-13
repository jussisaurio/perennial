import { expect, test, type Page } from "@playwright/test";
import { answer, kicker, reveal, startCourse, startSession } from "./helpers";

// #232: the summary points to the garden only on days with real news.

/** A known-word history for `lemma`: "I knew it" days ago, so its next good answer makes it known (it blooms). */
async function nearlyKnown(page: Page, lemma: string) {
  await page.evaluate(async (lemma) => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const w = (await loadDeck("es")).words.find((x: { lemma: string }) => x.lemma === lemma)!;
    await postWrite([{ type: "review.insert", row: { id: crypto.randomUUID(), lang: "es", word_id: w.id, skill: "read", grade: 4, kind: "known", reviewed_at: new Date(Date.now() - 12 * 86_400_000).toISOString(), duration_ms: 4000, sentence_id: null } }]);
  }, lemma);
}

const news = (page: Page) => page.locator(".garden-news");

test("a visitor that came this chunk: one line, and its link opens the walk", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  for (let i = 0; i < 4; i++) await answer(page, "1");
  for (let i = 0; i < 4; i++) {
    const isGato = (await page.locator("main.card").getAttribute("data-lemma")) === "gato";
    await reveal(page);
    await page.keyboard.press("2");
    if (isGato) break;
    await expect(kicker(page)).toHaveText(/quick check/);
  }
  await page.getByRole("button", { name: "End session" }).click();
  await expect(news(page)).toContainText("A cat came to the garden.");
  await news(page).getByRole("button", { name: "See it in the garden →" }).click();
  await expect(page).toHaveURL(/#\/garden/);
  // The walk opens on gato's plant: its card is up.
  await expect(page.getByRole("dialog", { name: "The plant for gato" })).toBeVisible({ timeout: 15_000 });
});

test("a rare flower that opened: its line; a plain review: no line", async ({ page }) => {
  await startCourse(page);
  await nearlyKnown(page, "perro"); // perro is a rare twin (#208)
  await page.reload();
  await startSession(page);
  // The due review comes first: remember it, and perro blooms.
  await expect(page.locator("main.card")).toHaveAttribute("data-lemma", "perro");
  await answer(page, "2");
  await page.getByRole("button", { name: "End session" }).click();
  await expect(news(page)).toContainText("perro opened with two flowers.");

  // Next chunk: a new word, nothing opens, no visitor: no line.
  await page.getByRole("button", { name: "Practice 5 more minutes" }).click();
  await answer(page, "1");
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.locator("main.summary")).toBeVisible();
  await expect(news(page)).toHaveCount(0);
});

test("a flower that opened for the first time: its line", async ({ page }) => {
  await startCourse(page);
  await nearlyKnown(page, "casa"); // not rare
  await page.reload();
  await startSession(page);
  await expect(page.locator("main.card")).toHaveAttribute("data-lemma", "casa");
  await answer(page, "2");
  await page.getByRole("button", { name: "End session" }).click();
  await expect(news(page)).toContainText("casa opened today.");
});

test("an answer undone takes its visitor away: no line for it", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  for (let i = 0; i < 4; i++) await answer(page, "1");
  for (let i = 0; i < 4; i++) {
    const isGato = (await page.locator("main.card").getAttribute("data-lemma")) === "gato";
    await reveal(page);
    if (!isGato) {
      await page.keyboard.press("2");
      await expect(kicker(page)).toHaveText(/quick check/);
      continue;
    }
    const serial = await page.locator(".session").getAttribute("data-card");
    await page.keyboard.press("2"); // the cat comes
    await expect(page.locator(".session")).not.toHaveAttribute("data-card", serial!); // the answer is in
    await page.keyboard.press("z"); // undone
    await expect(page.locator("main.card")).toHaveAttribute("data-lemma", "gato");
    await reveal(page);
    await page.keyboard.press("1"); // forgotten this time: no cat
    break;
  }
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.locator("main.summary")).toBeVisible();
  await expect(page.getByText("A cat came to the garden.")).toHaveCount(0);
});
