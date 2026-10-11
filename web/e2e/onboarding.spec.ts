import { expect, test } from "@playwright/test";
import { connectMockAI, startCourse } from "./helpers";

test("first run: pitch, AI setup with clear errors, then home", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toBeVisible();

  // Perennial AI is the main path; the own-key form is one step away.
  await expect(page.getByRole("button", { name: "Start free with my email" })).toBeVisible();
  await page.getByText("Use my own API key or a local model").click();

  // No key for a cloud provider: told so before any request is made.
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("alert")).toHaveText("Add your API key first.");

  // Success leaves a visible confirmation instead of the section vanishing.
  await connectMockAI(page);
  await expect(page.getByRole("heading", { name: "Turn on AI" })).toBeVisible();

  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page.getByText(/new words are ready/)).toBeVisible();
});

test("linking with an unknown sync code says nothing was found", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /already use Perennial/ }).click();
  await page.getByText("I use a sync code instead").click();
  await expect(page.getByRole("button", { name: "Generate" })).toHaveCount(0);
  await page.getByLabel("Sync code").fill("nosuc-hcode-xxxxx");
  await page.getByRole("button", { name: "Connect this device" }).click();
  await expect(page.getByRole("alert")).toContainText("No data found for this code");
});

test("onboarding offers exactly the MVP languages, taught from English", async ({ page }) => {
  await page.goto("/");
  const choices = page.getByRole("radiogroup", { name: "Language to learn" }).getByRole("radio");
  await expect(choices).toHaveCount(2);
  await expect(page.getByRole("radio", { name: /Spanish/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /German/ })).toBeVisible();
  await expect(page.getByText("I speak")).toHaveCount(0); // no free-text native language
  await expect(page.getByText("Lessons are in English.")).toBeVisible();
});

test("adding a language is a compact form that offers only what you don't study yet", async ({ page }) => {
  await startCourse(page); // Spanish
  // With a single course there is no language picker; adding lives in Settings.
  await expect(page.locator(".course-pick")).toHaveCount(0);
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("button", { name: "+ Learn another language" }).click();
  await expect(page.getByRole("heading", { name: "Add a language" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Spanish/ })).toBeDisabled();
  await expect(page.getByText("You are already learning this")).toBeVisible();
  await expect(page.getByRole("radio", { name: /German/ })).toBeChecked();
  await page.getByRole("button", { name: "Add German" }).click();
  await expect(page.locator(".course-pick")).toBeVisible(); // two courses now: a picker appears

  // With both languages taken, adding another says so plainly.
  await page.locator(".course-pick").selectOption("+");
  await expect(page.getByText(/already learning every language Perennial offers/)).toBeVisible();
});
