import { expect, test } from "@playwright/test";
import { newEmail, signIn, startCourse } from "./helpers";

test("new learner: Perennial AI with just an email, no keys, no plans to pick", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Your words sync on all your devices")).toBeVisible();
  await expect(page.getByText(/AI words left this month/)).toBeVisible();
  // Everyone is on the free tier: nothing to buy.
  await expect(page.getByText(/Pro|Upgrade|subscription/)).toHaveCount(0);
});

test("a second device signs in and gets the same course through account sync", async ({ browser }) => {
  const address = newEmail();
  const one = await browser.newPage();
  await startCourse(one, address);
  const lang = await one.getByRole("heading", { level: 1 }).locator("em").textContent();

  const two = await (await browser.newContext()).newPage();
  await two.goto("/");
  await two.getByRole("button", { name: /already use Perennial/ }).click();
  await signIn(two, address, "Sign in");
  await expect(two.getByRole("heading", { level: 1 }).locator("em")).toHaveText(lang!, { timeout: 15_000 });
});

test("words from a text use AI words; the limit is clear before anything is sent", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("button", { name: "Add words" }).click();
  await page.getByPlaceholder(/Paste .* text here/).fill("zorro búho lince nutria tejón garza ciervo");
  // The cost is visible before any tap.
  await expect(page.getByText(/You have 6 of 6 AI words left this month/)).toBeVisible();
  for (const w of ["zorro", "búho", "lince", "nutria", "tejón", "garza", "ciervo"]) await page.locator(".reader .tok", { hasText: w }).click();

  // 7 picked, 6 left: the app says exactly that, and nothing is sent.
  await expect(page.getByRole("button", { name: /Learn 7 words · uses 7 AI words/ })).toBeDisabled();
  await expect(page.getByText(/You selected 7 words, but you have only 6 AI words left this month\. Select 1 fewer/)).toBeVisible();
  await expect(page.getByText(/Pro|Upgrade/)).toHaveCount(0);

  // One fewer fits, and is spent.
  await page.locator(".reader .tok", { hasText: "ciervo" }).click();
  await page.getByRole("button", { name: /Learn 6 words · uses 6 AI words/ }).click();
  await expect(page.getByText(/Added 6 words/)).toBeVisible();
});
