import { expect, test } from "@playwright/test";

test("smoke: landing → start learning → a session → progress survives a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toBeVisible();
  await page.getByRole("button", { name: /Start learning Spanish/ }).click();
  await expect(page.getByText(/words are ready/)).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /today's session/ }).click();
  await expect(page.locator(".kicker")).toBeVisible();
  // Answer "I knew it" on the first new word: that records a review.
  await page.getByRole("button", { name: /I knew it/ }).click();
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: /^Done/ }).click();
  await page.reload();
  await expect(page.getByText(/You are learning|You know/)).toBeVisible({ timeout: 15000 });
  console.log("ERRORS", JSON.stringify(errors));
});
