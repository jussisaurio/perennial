import { expect, test } from "@playwright/test";
import { startCourse } from "./helpers";

test("first run: pitch, sign in with an email code, then home", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toBeVisible();
  await expect(page.getByText("Use my own API key")).toHaveCount(0);
  await startCourse(page);
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
