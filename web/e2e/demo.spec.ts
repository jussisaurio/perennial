import { expect, test } from "@playwright/test";
import { addEmail, serverRows, startCourse } from "./helpers";

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
  await startCourse(page); // an anonymous learner, so the delete is really sent
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

// #171: the demo only ever touches an anonymous demo learner, never a real account.
test("dev demo: ?demo=off leaves a real account alone", async ({ page }) => {
  await startCourse(page);
  const email = await addEmail(page);
  await page.goto("/?demo=off#/settings");
  await expect(page.getByText(email)).toBeVisible();
  expect((await page.request.get("/api/me")).status()).toBe(200);
});

test("dev demo: when sign-out fails, the demo writes nothing into the account", async ({ page }) => {
  await startCourse(page);
  await addEmail(page);
  const before = (await serverRows(page, "review")).length;
  await page.route("**/api/auth/sign-out", (route) => route.fulfill({ status: 500, json: {} }));
  // Wait for the demo to finish either way, then count: on the old code it wrote its reviews here.
  const done = page.waitForEvent("console", (m) => /\[demo\] (seeded|could not seed) es/.test(m.text()));
  await page.goto("/?demo=es:5");
  await done;
  expect((await serverRows(page, "review")).length).toBe(before);
});

test("dev demo: a failed session check deletes nothing", async ({ page }) => {
  await startCourse(page);
  const email = await addEmail(page);
  // Every session check fails while the demo decides; then it either deletes or says it won't.
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ status: 500, json: {} }));
  const acted = Promise.race([
    page.waitForResponse("**/api/account/delete"),
    page.waitForEvent("console", (m) => m.text().includes("[demo] not signed in as a demo learner")),
  ]);
  await page.goto("/?demo=off#/settings");
  await acted;
  await page.unrouteAll({ behavior: "ignoreErrors" });
  expect((await page.request.get("/api/me")).status()).toBe(200);
  await page.goto("/#/settings");
  await expect(page.getByText(email)).toBeVisible();
});
