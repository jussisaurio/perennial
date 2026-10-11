import { expect, test } from "@playwright/test";
import { startCourse } from "./helpers";

test("sentences say who wrote them; Perennial AI can rewrite a word's sentences, and undo restores them", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  await page.locator(".word-row").first().click();
  const detail = page.locator(".detail");
  await expect(detail.locator(".author", { hasText: "Written by Perennial AI" }).first()).toBeVisible();
  const before = await detail.locator(".examples li").allTextContents();

  await page.getByRole("button", { name: "Write new sentences" }).click();
  await expect(page.getByText(/Wrote \d+ new sentences?\./)).toBeVisible();
  await expect.poll(() => detail.locator(".examples li").allTextContents()).not.toEqual(before);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => detail.locator(".examples li").allTextContents()).toEqual(before);
});
