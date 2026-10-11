import { expect, test } from "@playwright/test";
import { type Page } from "@playwright/test";
import { startCourse, store } from "./helpers";

async function openAdd(page: Page) {
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("button", { name: "Add words" }).click();
}

test("paste text: unstudied words are new, picks are added, message resets", async ({ page }) => {
  await startCourse(page);
  await openAdd(page);
  await page.getByPlaceholder(/Paste .* text here/).fill("zorro gato ventana");
  // Nothing has been practised, so nothing may be marked as learning.
  await expect(page.locator(".reader .tok.learning")).toHaveCount(0);
  await page.locator(".reader .tok", { hasText: "gato" }).click();
  await page.getByRole("button", { name: "Learn 1 word" }).click();
  await expect(page.getByText(/Added 1 word \(marked ✓\)/)).toBeVisible();
  // The added word now looks different from the words still to learn.
  await expect(page.locator(".reader .tok.added", { hasText: "gato" })).toBeVisible();
  await page.locator(".reader .tok", { hasText: "zorro" }).click();
  await expect(page.getByText(/Added 1 word/)).toHaveCount(0);
});
