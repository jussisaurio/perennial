import { expect, test } from "@playwright/test";
import { startCourse, store } from "./helpers";

test("search, edit, pause, delete with undo", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  const first = page.locator(".word-row").first();
  const lemma = (await first.locator("strong").textContent())!;
  await page.getByPlaceholder("Search words or meanings").fill(lemma);
  await page.locator(".word-row", { has: page.locator(`strong:text-is("${lemma}")`) }).click();

  // Not started yet: says so plainly instead of showing a schedule.
  await expect(page.getByText("Not started.")).toBeVisible();

  const meaning = page.getByLabel("Meaning");
  await meaning.fill("edited meaning");
  await meaning.blur();
  // Saving is asynchronous; reload only once it has reached the database.
  await expect.poll(async () => (await store<{ gloss: string }>(page, "lexemes")).some((l) => l.gloss === "edited meaning")).toBe(true);
  await page.reload();
  await page.getByRole("tab", { name: "Words" }).click();
  await expect(page.getByText("edited meaning")).toBeVisible();

  await page.locator(".word-row", { hasText: "edited meaning" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Paused. It does not appear in sessions.")).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".word-row", { hasText: "edited meaning" })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".word-row", { hasText: "edited meaning" })).toBeVisible();
});
