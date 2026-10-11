import { expect, test } from "@playwright/test";
import { store } from "./helpers";

test("dev demo data: ?demo=es gives a garden with sprouts, buds, blooms and thirsty plants", async ({ page }) => {
  await page.goto("/?demo=es:150#/garden");
  await expect(page).toHaveURL(/\/#\/garden$/);
  await expect(page.getByText(/150 plants · \d+ in bloom/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/\d+ seeds ready/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Water \d+ thirsty plants/ })).toBeVisible();
  const memory = await store<{ skill: string; s: number; reps: number }>(page, "memory");
  const read = memory.filter((m) => m.skill === "read" && m.reps > 0);
  expect(read).toHaveLength(150);
  expect(read.some((m) => m.s < 2)).toBe(true);
  expect(read.some((m) => m.s > 30)).toBe(true);
  // Demo rows are not in the op log, so they never sync.
  expect(await store(page, "ops")).toHaveLength(0);

  await page.goto("/?demo=off#/today");
  await expect(page.getByRole("heading", { name: "Grow a language, a few minutes a day." })).toBeVisible();
});

test("dev demo data from Settings", async ({ page }) => {
  await page.goto("/?demo=de:10#/settings");
  await page.getByLabel("Demo language").selectOption("es");
  await page.getByLabel("Words studied").selectOption("50");
  await page.getByRole("button", { name: "Make demo course and open the garden" }).click();
  await expect(page).toHaveURL(/#\/garden$/);
  await expect(page.getByText(/50 plants/)).toBeVisible();
});
