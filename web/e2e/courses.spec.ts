import { expect, test } from "@playwright/test";
import { expectServerRows, startCourse } from "./helpers";

// #124: a garden per language, switched from the top bar. Courses are never deleted.
test("start a second language from the top bar, switch back, and nothing new is left to start", async ({ page }) => {
  await startCourse(page);
  const switcher = page.locator(".course-switch-button");
  await expect(switcher).toHaveText(/Spanish/);
  await switcher.click();
  // One garden: singular, with the other language offered as new.
  await expect(page.getByText("Your garden", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: /Spanish/ })).toHaveAttribute("aria-checked", "true");

  // Starting asks first (it can't be undone), and "Not now" changes nothing.
  await page.getByRole("menuitem", { name: /German/ }).click();
  await expect(page.getByText(/Your Spanish garden stays as it is/)).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("menuitem", { name: /German/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /German/ }).click();
  await page.getByRole("button", { name: "Start German" }).click();

  await expect(switcher).toHaveText(/German/);
  await expect(page.getByText(/words are ready/)).toBeVisible({ timeout: 15_000 });
  await expectServerRows(page, "course", 2);

  // Two gardens, every language started: switching only.
  await switcher.click();
  await expect(page.getByText("Your gardens", { exact: true })).toBeVisible();
  await expect(page.getByText("Plant a new one")).toHaveCount(0);
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  await page.getByRole("menuitemradio", { name: /Spanish/ }).click();
  await expect(switcher).toHaveText(/Spanish/);

  // The choice is kept across a reload.
  await page.reload();
  await expect(page.locator(".course-switch-button")).toHaveText(/Spanish/);
});

test("a second language the server refuses: the learner is told, and stays where they were", async ({ page }) => {
  await startCourse(page);
  // A permanent refusal (422), as from a server that does not know the language yet.
  await page.route("**/api/write", (route) =>
    route.request().postData()?.includes("course.upsert") ? route.fulfill({ status: 422, json: { error: "invalid" } }) : route.fallback(),
  );
  const switcher = page.locator(".course-switch-button");
  await switcher.click();
  await page.getByRole("menuitem", { name: /German/ }).click();
  await page.getByRole("button", { name: "Start German" }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not start German. Please try again later.");
  await expect(switcher).toHaveText(/Spanish/);
});

test("the language menu closes on Escape and on a click outside", async ({ page }) => {
  await startCourse(page);
  const switcher = page.locator(".course-switch-button");
  await switcher.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await switcher.click();
  await page.locator("h1, h2").first().click();
  await expect(page.getByRole("menu")).toHaveCount(0);
});
