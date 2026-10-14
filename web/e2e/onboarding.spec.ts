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
  // A sample, so no counts that read as someone's progress (#261).
  await expect(page.getByRole("img", { name: "A sample word garden. Each word grows from a seed into a flower." })).toBeVisible();
  await page.getByRole("radio", { name: /German/ }).check();
  await expect(page.getByRole("button", { name: "Start learning German" })).toBeVisible();
  await expect(page.getByText("Use my own API key")).toHaveCount(0);
  await startCourse(page, "German");
  await expectServerRows(page, "course", 1);
});

test("landing: a saved choice of a language this build does not have falls back to Spanish", async ({ page }) => {
  // Another tab with a newer build (localStorage is shared per site) saved a language this build lacks.
  await page.addInitScript(() => localStorage.setItem("perennial-onboarding", JSON.stringify({ lang: "fr" })));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Spanish/ })).toBeChecked();
});

test("landing: walk through the showcase garden in 3D, view only", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Walk through this garden in 3D" }).click();
  await expect(page.getByText(/\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: /Water/ })).toHaveCount(0); // no learning here
  // A plant's card gives no made-up recall number (#261).
  await page.getByRole("button", { name: "Next plant" }).click();
  const card = page.getByRole("dialog", { name: /^The plant for / });
  await expect(card).toContainText(/: you .* this word\./);
  await expect(card).not.toContainText("%");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toBeVisible();
  // Back where the walk started, not at the top of the page (#273).
  const link = page.getByRole("button", { name: "Walk through this garden in 3D" });
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport();
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

test("coming back to the tab keeps the sign-in form as it was", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email").fill("back@example.com");
  // Better Auth checks the session again when the tab comes back: hide and show it.
  const recheck = page.waitForResponse((r) => r.url().includes("/api/auth/get-session"));
  await page.evaluate(() => {
    const set = (v: string) => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
    set("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    set("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await recheck;
  await expect(page.getByLabel("Email")).toHaveValue("back@example.com");
});

test("a newer app found by the first check at start still shows the reload note (#121)", async ({ page }) => {
  // The first answer arrives before the note is on screen; the note must still see it.
  await page.route("**/api/server", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), minClientVersion: "999.0.0" } });
  });
  await startCourse(page);
  await expect(page.getByRole("status").filter({ hasText: "A new version of Perennial is ready" })).toBeVisible();
});
