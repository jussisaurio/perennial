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
