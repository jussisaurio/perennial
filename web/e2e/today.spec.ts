import { expect, test, type Page } from "./test";
import { answer, kicker, reveal, startCourse } from "./helpers";

// #189: 5 minutes a day for everyone, and "Practice 5 more minutes" whenever the learner wants.
test.use({ viewport: { width: 1280, height: 900 } });

const MORNING = new Date("2026-10-01T10:00:00");
/** Never shown: no limits, no "nothing left", no minutes setting, no "Keep going". */
const NEVER = /limit|reached|15 (min|new)|Keep going|Nothing to practi[cs]e/;
const startButton = (page: Page) => page.locator("button.start");
const timeLeft = (page: Page) => page.locator(".time-left");

/**
 * Answers from an earlier session, posted as the app posts them: `count` deck words
 * from `from` on, `minutes` of practice in all, `daysAgo` days ago.
 */
async function answered(page: Page, { from = 0, count, minutes, daysAgo = 0 }: { from?: number; count: number; minutes: number; daysAgo?: number }) {
  await page.evaluate(
    async ({ from, count, ms, daysAgo }) => {
      const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
      const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
      const deck = await loadDeck("es");
      const end = Date.now() - daysAgo * 86_400_000;
      await postWrite(
        Array.from({ length: count }, (_, i) => ({
          type: "review.insert",
          row: { id: crypto.randomUUID(), lang: "es", word_id: deck.words[from + i].id, skill: "read", grade: 3, kind: "review", reviewed_at: new Date(end - (count - i) * 10_000).toISOString(), duration_ms: Math.round(ms / count), sentence_id: null },
        })),
      );
    },
    { from, count, ms: minutes * 60_000, daysAgo },
  );
}

test("first day: 5 minutes a day, no minutes to choose, and the day's button", async ({ page }) => {
  await page.clock.setFixedTime(MORNING);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Grow a language, 5 minutes a day." })).toBeVisible();
  await expect(page.getByText("Time per day")).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Minutes per day" })).toHaveCount(0);
  await page.getByRole("button", { name: "Start learning Spanish" }).click();
  await expect(page.getByText(/seeds are ready to plant/)).toBeVisible({ timeout: 15_000 });
  await expect(startButton(page)).toHaveText("Start today's 5 minutes");
  await expect(page.locator("body")).not.toHaveText(NEVER);
  await startButton(page).click();
  await expect(timeLeft(page)).toHaveText("5 min left");

  await page.goto("/#/settings");
  await expect(page.getByRole("heading", { name: "Course" })).toBeVisible();
  await expect(page.getByText("Time per day")).toHaveCount(0);
  await expect(page.locator("option", { hasText: "minutes" })).toHaveCount(0);
});

test("partway through the day: finish the rest of today's 5 minutes", async ({ page }) => {
  await page.clock.setFixedTime(MORNING);
  await startCourse(page);
  await answered(page, { from: 20, count: 3, minutes: 0.5, daysAgo: 10 }); // due again by now
  await answered(page, { count: 4, minutes: 2 });
  await expect(startButton(page)).toHaveText(/^Finish today's 5 minutes\s*· 3 min$/);
  await expect(page.getByText("Water your plants, then plant a few new seeds.")).toBeVisible();
  await expect(page.locator("body")).not.toHaveText(NEVER);
  await startButton(page).click();
  await expect(timeLeft(page)).toHaveText("3 min left");
});

test("done for the day (under a minute left counts): watered, and 5 more minutes always works", async ({ page }) => {
  await page.clock.setFixedTime(MORNING);
  await startCourse(page);
  await answered(page, { count: 8, minutes: 4.25 });
  await expect(page.getByText("The garden is watered for today.")).toBeVisible();
  await expect(startButton(page)).toHaveText("Practice 5 more minutes");
  await expect(page.locator("body")).not.toHaveText(NEVER);
  await startButton(page).click();
  await expect(timeLeft(page)).toHaveText("5 min left");

  // Plant one seed ("I knew it" answers it at once), stop: the summary says what happened, and offers 5 more minutes again.
  await expect(kicker(page)).toHaveText("new word");
  await answer(page, "2");
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByRole("heading", { name: "You planted 1 seed." })).toBeVisible();
  await expect(page.locator("main.summary")).toContainText(/You know \d+ words?|So far, you have started \d+ words?/);
  await expect(page.locator("body")).not.toHaveText(NEVER);
  await page.getByRole("button", { name: "Done" }).click();
  await startButton(page).click();
  await expect(timeLeft(page)).toHaveText("5 min left");
  // Each chunk has its own summary: the seed from the last one is not counted again.
  await expect(kicker(page)).toHaveText("new word");
  await answer(page, "2");
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByRole("heading", { name: "You planted 1 seed." })).toBeVisible();
});

test("done, but plants are still due: say how many, not 'watered'", async ({ page }) => {
  await page.clock.setFixedTime(MORNING);
  await startCourse(page);
  await answered(page, { count: 10, minutes: 2, daysAgo: 10 }); // due again by now
  await answered(page, { from: 10, count: 5, minutes: 5 });
  await expect(page.getByText("10 plants still need water.")).toBeVisible();
  await expect(page.getByText("The garden is watered for today.")).toHaveCount(0);
  await expect(startButton(page)).toHaveText("Practice 5 more minutes");
});

test("a learner who chose 20 minutes a day before: 5-minute chunks, told once", async ({ page }) => {
  await page.clock.setFixedTime(MORNING);
  await startCourse(page);
  await page.evaluate(async () => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    await postWrite([{ type: "course.upsert", row: { lang: "es", minutes: 20 } }]);
  });
  const note = page.getByText("Perennial is now 5 minutes at a time.", { exact: false });
  await expect(note).toBeVisible();
  await expect(startButton(page)).toHaveText("Start today's 5 minutes");
  await startButton(page).click();
  await expect(timeLeft(page)).toHaveText("5 min left");
  await answer(page, "2"); // "I knew it": one seed planted
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByRole("heading", { name: "You planted 1 seed." })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await startButton(page).click();
  await expect(timeLeft(page)).toHaveText(/min left/);
  // Said once: not again on the next visit.
  await page.goto("/#/today");
  await expect(startButton(page)).toBeVisible();
  await expect(note).toHaveCount(0);
});

test("the walk's Water button: the rest of today's 5 minutes, then 5 more once done", async ({ page }) => {
  // Low quality: CI draws WebGL in software, and normal quality is too slow there (garden.spec.ts).
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
  await page.clock.setFixedTime(MORNING);
  await startCourse(page);
  await answered(page, { count: 6, minutes: 1, daysAgo: 30 }); // thirsty plants
  await answered(page, { from: 6, count: 3, minutes: 2 });
  await expect(startButton(page)).toContainText("3 min");
  // The button says what it starts, as Today does, and never counts thirsty plants (#263).
  const water = async (label: string) => {
    await page.getByRole("button", { name: "Walk in your garden" }).click();
    const button = page.getByRole("button", { name: `💧 ${label}` });
    await expect(button).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/thirsty/)).toHaveCount(0);
    await button.click();
  };
  await water("Finish today's 5 minutes · 3 min");
  await expect(timeLeft(page)).toHaveText("3 min left");

  await page.goto("/#/today");
  await answered(page, { from: 9, count: 3, minutes: 3 });
  await expect(page.getByText("6 plants still need water.")).toBeVisible(); // done for today, the thirsty ones still due
  await water("Practice 5 more minutes");
  await expect(timeLeft(page)).toHaveText("5 min left");
});

test.describe("time running out never cuts the card on screen", () => {
  const card = (page: Page) => page.locator(".session").getAttribute("data-card");

  /**
   * Run the session clock past today's 5 minutes, with the learner present (a key
   * now and then). In steps under 2 s: the session credits at most 2 s per tick.
   */
  async function pastFiveMinutes(page: Page) {
    for (let i = 0; i < 175; i++) {
      if (i % 15 === 0) await page.keyboard.press("Shift");
      await page.clock.fastForward(1_900);
    }
    await expect(timeLeft(page)).toHaveText("finishing");
  }

  test("on a new word: it stays, and its quick check still comes before the summary", async ({ page }) => {
    await page.clock.install({ time: MORNING });
    await startCourse(page);
    await startButton(page).click();
    await expect(kicker(page)).toHaveText("new word");
    const word = (await page.locator(".word").textContent())!.trim();
    const shown = await card(page);
    await pastFiveMinutes(page);
    expect(await card(page)).toBe(shown);
    await expect(kicker(page)).toHaveText("new word");
    await expect(page.locator(".word")).toHaveText(word);
    await answer(page, "1");
    await expect(kicker(page)).toHaveText(/quick check/);
    await expect(page.locator("main.card")).toHaveAttribute("data-lemma", word);
    await reveal(page);
    await page.keyboard.press("2"); // the last card: the summary follows (no next card)
    await expect(page.locator("main.summary")).toBeVisible();
  });

  test("on a review card: it stays and can be answered; promised quick checks come next", async ({ page }) => {
    await page.clock.install({ time: MORNING });
    await startCourse(page);
    await startButton(page).click();
    for (let i = 0; i < 4; i++) {
      await expect(kicker(page)).toHaveText("new word");
      await answer(page, "1");
    }
    await expect(kicker(page)).toHaveText(/quick check/);
    const lemma = (await page.locator("main.card").getAttribute("data-lemma"))!;
    const shown = await card(page);
    await pastFiveMinutes(page);
    expect(await card(page)).toBe(shown);
    await expect(page.locator("main.card")).toHaveAttribute("data-lemma", lemma);
    await answer(page, "2");
    // The other three new words were promised a quick check: they come before the summary.
    for (let i = 0; i < 3; i++) {
      await expect(kicker(page)).toHaveText(/quick check/);
      await expect(page.locator("main.card")).not.toHaveAttribute("data-lemma", lemma);
      if (i < 2) await answer(page, "2");
    }
    await reveal(page);
    await page.keyboard.press("2"); // the last card: the summary follows (no next card)
    await expect(page.locator("main.summary")).toBeVisible();
  });
});
