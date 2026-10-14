import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { answer, openAdd, startCourse, startSession } from "./helpers";

test("the browser Back button moves between screens instead of leaving the app", async ({ page }) => {
  await startCourse(page);
  await openAdd(page);
  await expect(page).toHaveURL(/#\/words\/add$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Words" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: /today's 5 minutes/i })).toBeVisible();

  await startSession(page);
  await answer(page, "1");
  await page.goBack(); // leaving a session with Back returns home, answers kept
  await expect(page.getByRole("button", { name: /today's 5 minutes/i })).toBeVisible();
});

test("export downloads everything, including the review log", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  await answer(page, "2"); // one review: "I knew it"
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: /Done/ }).click();
  await page.getByRole("tab", { name: "Settings" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all my data (JSON)" }).click()]);
  const data = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(data.app).toBe("perennial");
  expect(data.words.length).toBe(1);
  expect(data.reviews).toHaveLength(1);
  expect(data.reviews[0]).toMatchObject({ grade: 4, kind: "known" });
  // The page says a download started (#272).
  await expect(page.getByText(/^Downloading all your data as perennial-es-.*\.json\. Look for it in your downloads\.$/)).toBeVisible();
  await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download my words (CSV)" }).click()]);
  await expect(page.getByText(/^Downloading 1 word as perennial-words-es-.*\.csv\./)).toBeVisible();
});
