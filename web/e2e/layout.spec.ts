import { expect, test } from "@playwright/test";
import { startCourse } from "./helpers";

test("phone: bottom tab bar and no horizontal scroll", async ({ page }) => {
  await startCourse(page);
  const tabs = page.getByRole("tablist");
  const box = (await tabs.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThan(viewport.height / 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// #116: on phones the Add words button sat flush on the filter row, and its
// shadow covered the "All" dropdown. The boxes must keep a gap, and nothing scrolls sideways.
test("phone: Add words keeps clear of the filter dropdown", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  const filter = page.locator(".page select");
  await expect(filter).toBeVisible();
  const add = (await page.getByRole("button", { name: "Add words" }).boundingBox())!;
  const sel = (await filter.boundingBox())!;
  const gap = 4;
  const apart =
    add.x + add.width + gap <= sel.x || sel.x + sel.width + gap <= add.x || add.y + add.height + gap <= sel.y || sel.y + sel.height + gap <= add.y;
  expect(apart, `Add words ${JSON.stringify(add)} vs filter ${JSON.stringify(sel)}`).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("phone: the new-version note fits the screen and its text", async ({ page }) => {
  await startCourse(page);
  // What the app does when the server asks for a newer app (see data/http.ts).
  await page.evaluate(async () => {
    const http = await import(/* @vite-ignore */ "/src/data/http.ts");
    http.reloadNeeded.dispatchEvent(new Event("reload"));
  });
  const note = page.getByRole("status").filter({ hasText: "A new version of Perennial is ready" });
  await expect(note.getByRole("button", { name: "Reload" })).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = (await note.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  // Not squeezed into a narrow column (it was half the screen wide, #115).
  expect(box.width).toBeGreaterThan(viewport.width * 0.75);
  expect(await note.evaluate((e) => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight)).toBe(true);
});

// #124: the language menu and its "start a new one?" question stay on screen.
test("phone: the language menu fits the screen", async ({ page }) => {
  await startCourse(page);
  await page.locator(".course-switch-button").click();
  const viewport = page.viewportSize()!;
  for (const step of ["menu", "ask"]) {
    if (step === "ask") await page.getByRole("menuitem", { name: /German/ }).click();
    const box = (await page.getByRole("menu").boundingBox())!;
    expect(box.x, step).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, step).toBeLessThanOrEqual(viewport.width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
