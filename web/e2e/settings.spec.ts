import { expect, test } from "@playwright/test";
import { startCourse, store } from "./helpers";

test("target recall changed with the keyboard is saved", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByText("How often to review").click();
  const slider = page.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Target: remember 92% of words")).toBeVisible();
  await expect.poll(async () => (await store<{ retention: number }>(page, "courses"))[0].retention).toBeCloseTo(0.92);
});

test("theme choice uses plain words and applies", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("radio", { name: "Same as my device" })).toBeVisible();
});

test("AI status is shown, sync gives a copyable code", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByText("Sync without an account").click();
  await page.getByRole("button", { name: "Turn on sync" }).click();
  await expect(page.getByText("Sync is on")).toBeVisible();
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const code = await page.evaluate(() => navigator.clipboard.readText());
  expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}$/);
});

test("switching AI providers: a failed switch keeps the working one, a good switch applies", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  const card = page.locator(".status-card").first();
  await expect(card).toContainText("localhost:18788");

  // Switch to a server that isn't running: clear error, old connection untouched.
  await page.getByRole("button", { name: "Change" }).click();
  // A custom address starts with this section open.
  if (!(await page.getByLabel("Address (URL)").isVisible())) await page.getByText("Address and format").click();
  await page.getByLabel("Address (URL)").fill("http://localhost:1/v1");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not connect to localhost:1");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(card).toContainText("localhost:18788");

  // A working switch (different model on the same server) takes effect.
  await page.getByRole("button", { name: "Change" }).click();
  await page.getByLabel("Model").fill("another-model");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(card).toContainText("another-model");
  const meta = await store<{ k: string; v: { model: string } }>(page, "meta");
  expect(meta.find((m) => m.k === "llm")?.v.model).toBe("another-model");
});
