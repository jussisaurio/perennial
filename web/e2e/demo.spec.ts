import { expect, test } from "@playwright/test";
import { serverRows } from "./helpers";

test("dev demo data: ?demo=es gives a garden with a review history", async ({ page }) => {
  await page.goto("/?demo=es:30#/garden");
  await expect(page.getByText(/30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20000 });
  const reviews = await serverRows<{ word_id: string }>(page, "review");
  expect(new Set(reviews.map((r) => r.word_id)).size).toBe(30);
  await page.goto("/?demo=off");
  await expect(page.getByRole("heading", { name: "Grow a language, a few minutes a day." })).toBeVisible();
});
