import { expect, test } from "@playwright/test";
import { answer, kicker, reveal, startCourse, startSession } from "./helpers";

// #209: learn a garden word, and its visitor comes. The cat is the course's 3rd word,
// so a new learner meets it, and the one line that says why, in the first 5 minutes.

test("a new learner learns 'gato' in the first session, and the cat comes to the garden", async ({ page }) => {
  await startCourse(page);
  // A new garden has no cat yet.
  await expect(page.getByRole("button", { name: "el gato · cat" })).toHaveCount(0);
  await startSession(page);
  let sawGato = false;
  // Four new words ("New to me"), gato among them; then their quick checks.
  for (let i = 0; i < 4; i++) {
    await expect(kicker(page)).toHaveText(/new word/);
    if ((await page.locator(".word").textContent())?.includes("gato")) sawGato = true;
    await answer(page, "1");
  }
  expect(sawGato).toBe(true);
  for (let i = 0; i < 4; i++) {
    await expect(kicker(page)).toHaveText(/quick check/);
    const isGato = (await page.locator("main.card").getAttribute("data-lemma")) === "gato";
    await reveal(page);
    await page.keyboard.press("2"); // I remembered
    if (isGato) {
      await expect(page.getByRole("status")).toHaveText("You learned gato. A cat came to see.");
      break;
    }
  }
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: /^Done/ }).click();
  // Back on Today, the cat is in the garden strip.
  await expect(page.getByRole("button", { name: "el gato · cat" })).toBeAttached();
});
