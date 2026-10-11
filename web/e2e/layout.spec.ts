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
