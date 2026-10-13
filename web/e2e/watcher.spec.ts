import { expect, test } from "@playwright/test";
import { answer, startCourse, startSession } from "./helpers";

// #210: sometimes a visitor the learner has brought comes to watch a chunk, for a few cards.
test.use({ reducedMotion: "no-preference" });

test("on a day the cat visits, it watches from its card for four cards, then leaves", async ({ page }) => {
  await startCourse(page);
  // A day (in 2026) on which the first chunk gets the cat, and the card it comes at.
  const { day, from } = await page.evaluate(async () => {
    const { sessionVisit } = await import(/* @vite-ignore */ "/src/garden/sessionVisitor.ts");
    const { today } = await import(/* @vite-ignore */ "/src/core/day.ts");
    for (let d = 1; d < 365; d++) {
      const date = new Date(2026, 0, d, 12);
      const v = sessionVisit(today(date), 0, ["cat"]);
      if (v) return { day: date.getTime(), from: v.from };
    }
    throw new Error("no day");
  });
  await page.clock.setFixedTime(day);
  // gato learned long before that day: the cat is the learner's.
  await page.evaluate(async (day) => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const w = (await loadDeck("es")).words.find((x: { lemma: string }) => x.lemma === "gato")!;
    await postWrite([{ type: "review.insert", row: { id: crypto.randomUUID(), lang: "es", word_id: w.id, skill: "read", grade: 4, kind: "known", reviewed_at: new Date(day - 30 * 86_400_000).toISOString(), duration_ms: 4000, sentence_id: null } }]);
  }, day);
  await page.reload();
  await startSession(page);
  const watcher = page.locator(".session-watcher");
  for (let card = 1; card < from; card++) {
    await expect(watcher).toHaveCount(0);
    await answer(page, "2");
    await expect(page.locator(".growth")).toHaveCount(0);
  }
  await expect(watcher).toHaveAttribute("aria-label", "el gato · cat");
  for (let k = 0; k < 4; k++) {
    await answer(page, "2");
    await expect(page.locator(".growth")).toHaveCount(0);
  }
  await expect(watcher).toHaveCount(0);
});
