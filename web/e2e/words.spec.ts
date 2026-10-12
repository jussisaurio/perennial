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

test("empty lists say what is missing, with a small wink (#58)", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("combobox").selectOption("suspended");
  await expect(page.getByText("No paused words. Everyone is awake.")).toBeVisible();
  await page.getByRole("combobox").selectOption("known");
  await expect(page.getByText("No flowers yet. They are coming.")).toBeVisible();
  await page.getByRole("combobox").selectOption("new");
  await page.getByPlaceholder("Search words or meanings").fill("qqzzxx");
  await expect(page.getByText("No word here. Maybe it is still a seed.")).toBeVisible();
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

test("word detail: scheduling details show stability, difficulty, recall and the review log", async ({ page }) => {
  await page.goto("/?demo=es:5#/words");
  await page.locator(".word-row").first().click();
  await page.getByText("Scheduling details").click();
  const details = page.locator(".scheduling");
  await expect(details.getByRole("columnheader", { name: "Stability" })).toBeVisible();
  await expect(details.locator("tbody tr").first()).toContainText("%");
  await expect(details.locator(".review-log li").first()).toBeVisible();
});

// Adding words from a text needs Perennial AI: with it off on the server, the feature is hidden.
test("with Perennial AI off, Add words is hidden, and its address shows the word list", async ({ page }) => {
  await page.route("**/api/server", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), features: { ai: false } } });
  });
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  await expect(page.getByRole("heading", { name: "Words" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add words" })).toHaveCount(0);
  await page.goto("/#/words/add");
  await expect(page.getByRole("heading", { name: "Words" })).toBeVisible();
  await expect(page.getByPlaceholder(/Paste .* text here/)).toHaveCount(0);
});
