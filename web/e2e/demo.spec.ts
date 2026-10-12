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

test("dev demo: a delete the server refuses is reported", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (m) => m.type() === "warning" && warnings.push(m.text()));
  await page.route("**/api/account/delete", (route) => route.fulfill({ status: 500, json: { error: "internal_error" } }));
  await page.goto("/?demo=off");
  await expect(page.getByRole("heading", { name: "Grow a language, a few minutes a day." })).toBeVisible();
  await expect.poll(() => warnings.some((w) => w.includes("could not delete the demo learner on the server: 500"))).toBe(true);
});

test("dev demo: a seed that fails is reported, and the app still opens", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.route("**/api/write", (route) => route.fulfill({ status: 422, json: { error: "invalid" } }));
  await page.goto("/?demo=es:5");
  await expect(page.getByRole("heading", { name: "Grow a language, a few minutes a day." })).toBeVisible({ timeout: 20000 });
  expect(errors.some((e) => e.includes("[demo] could not seed es"))).toBe(true);
});

test("dev tools: the demo button opens the demo learner's garden", async ({ page }) => {
  await page.goto("/?demo=es:5#/settings");
  await page.getByLabel("Words studied").selectOption("10");
  await page.getByRole("button", { name: "Make demo learner and open the garden" }).click();
  await expect(page.getByText(/10 plants · \d+ in bloom/)).toBeVisible({ timeout: 20000 });
});
