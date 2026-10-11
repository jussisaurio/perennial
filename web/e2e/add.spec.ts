import { expect, test, type Page } from "@playwright/test";
import { expectServerRows, serverRows, startCourse } from "./helpers";

async function openAdd(page: Page) {
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("button", { name: "Add words" }).click();
}

test("paste text: course words are queued for free; other words need an email", async ({ page }) => {
  await startCourse(page);
  await openAdd(page);
  // "es" is a form of "ser", which the course has; "zorro" is not in the course.
  await page.getByPlaceholder(/Paste .* text here/).fill("El zorro es rojo.");
  await expect(page.locator(".reader .tok.learning")).toHaveCount(0); // nothing practised yet
  await page.locator(".reader .tok", { hasText: /^es$/ }).click();
  await page.getByRole("button", { name: "Learn 1 word" }).click(); // no AI words used
  await expect(page.getByText(/Added 1 word \(marked ✓\)/)).toBeVisible();
  await expect(page.locator(".reader .tok.added", { hasText: /^es$/ })).toBeVisible();
  await expect.poll(async () => (await serverRows<{ status: string }>(page, "word_state")).map((s) => s.status)).toEqual(["queued"]);

  await page.locator(".reader .tok", { hasText: "zorro" }).click();
  await expect(page.getByText(/Added 1 word/)).toHaveCount(0); // the message resets
  await expect(page.getByText(/To have Perennial AI make cards for them, add your email/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Learn 1 word · uses 1 AI word/ })).toBeDisabled();

  // Names and the like can be muted.
  await page.getByRole("button", { name: "Never mark as new" }).click();
  await expectServerRows(page, "word_state", 2);
});
