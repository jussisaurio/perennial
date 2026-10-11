import { expect, test } from "@playwright/test";
import { expectServerRows, serverRows, startCourse } from "./helpers";

test("course words: search the upcoming words, pause and resume, never show (with undo)", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("combobox").selectOption("new"); // what comes next
  const first = page.locator(".word-row").first();
  const lemma = (await first.locator("strong").textContent())!;
  await page.getByPlaceholder("Search words or meanings").fill(lemma);
  const row = page.locator(".word-row", { has: page.locator(`strong:text-is("${lemma}")`) });
  await row.click();

  // Not started yet: says so plainly; course sentences are shown and labelled.
  await expect(page.getByText("Not started.")).toBeVisible();
  await expect(page.locator(".examples .author").first()).toHaveText("From the course");
  await expect(page.getByLabel("Meaning")).toHaveCount(0); // course words are not edited here

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Paused. It does not appear in sessions.")).toBeVisible();
  await expectServerRows(page, "word_state", 1);
  await page.getByRole("button", { name: "Resume" }).click();
  await expectServerRows(page, "word_state", 0);

  await page.getByRole("button", { name: "Never show this word" }).click();
  await expect(page.getByText(`“${lemma}” will not come up again.`)).toBeVisible();
  await expect.poll(async () => (await serverRows<{ status: string }>(page, "word_state"))[0]?.status).toBe("ignored");
  await page.getByRole("button", { name: "Undo" }).click();
  await expectServerRows(page, "word_state", 0);
});

test("keyboard: Enter starts today's session, / focuses the word search", async ({ page }) => {
  await startCourse(page);
  await page.locator("body").click({ position: { x: 5, y: 5 } }); // nothing focused
  await page.keyboard.press("Enter");
  await expect(page.locator(".kicker")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Words" }).click();
  await page.locator("h1").click();
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.keyboard.type("x");
  await expect(page.getByRole("searchbox")).toHaveValue("x"); // the slash itself isn't typed
});
