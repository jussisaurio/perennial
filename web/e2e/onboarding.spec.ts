import { expect, test } from "@playwright/test";
import { addEmail, expectServerRows, startCourse } from "./helpers";

test("landing: the garden shows real words per language; start without an account", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toBeVisible();
  const choices = page.getByRole("radiogroup", { name: "Language to learn" }).getByRole("radio");
  await expect(choices).toHaveCount(2);
  await expect(page.getByRole("radio", { name: /Spanish/ })).toBeChecked();
  await expect(page.getByText("Lessons are in English.")).toBeVisible();
  // The showcase garden: hover a plant to see its word.
  await expect(page.locator(".landing-garden .garden svg g[transform]").first()).toBeVisible();
  await page.getByRole("radio", { name: /German/ }).check();
  await expect(page.getByRole("button", { name: "Start learning German" })).toBeVisible();
  await expect(page.getByText("Use my own API key")).toHaveCount(0);
  await startCourse(page, "German");
  await expectServerRows(page, "course", 1);
});

test("landing: walk through the showcase garden in 3D, view only", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Walk through this garden in 3D" }).click();
  await expect(page.getByText(/\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: /Water/ })).toHaveCount(0); // no learning here
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toBeVisible();
});

test("no flicker: after Start, and after signing in, the landing page never comes back", async ({ page }) => {
  // Count every time the landing page appears (MutationObserver, so a single frame counts).
  await page.addInitScript(() => {
    const w = window as unknown as { __landings: number };
    w.__landings = 0;
    let shown = false;
    new MutationObserver(() => {
      const now = !!document.querySelector(".landing");
      if (now && !shown) w.__landings++;
      shown = now;
    }).observe(document, { subtree: true, childList: true });
  });
  const landings = () => page.evaluate(() => (window as unknown as { __landings: number }).__landings);
  await startCourse(page);
  expect(await landings()).toBe(1); // only before Start
  await addEmail(page);
  expect(await landings()).toBe(0); // the page after the sign-in reload never showed it
});
