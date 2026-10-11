import { expect, test, type Page } from "@playwright/test";
import { startCourse } from "./helpers";

async function signInFromSettings(page: Page, address: string) {
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("We sent a 6-digit code")).toBeVisible();
  const { code } = await (await page.request.get(`/api/dev/outbox?email=${encodeURIComponent(address)}`)).json();
  await page.getByLabel("Code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/Free plan/)).toBeVisible();
}

test("sentences say who wrote them; a local model's can be replaced with Perennial AI, and undone", async ({ page }) => {
  // The mock on localhost counts as a model "on your computer".
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  await page.locator(".word-row").first().click();
  await expect(page.locator(".examples .author.warn").first()).toContainText("on your computer");

  await signInFromSettings(page, `authors-${Math.random().toString(36).slice(2, 8)}@example.com`);
  await page.getByRole("tab", { name: "Words" }).click();

  // The banner offers a bulk replacement and is honest about the cost.
  await expect(page.getByText(/sentences written by a model on your computer/)).toBeVisible();
  const bulk = page.locator(".banner").getByRole("button", { name: "Replace these sentences" });
  await expect(page.locator(".banner")).toContainText("With Perennial AI · uses");
  await expect(bulk).toBeDisabled(); // more words than the 6 free AI words in this setup

  // One word at a time fits the allowance.
  const row = page.locator(".word-row").first();
  await row.click();
  await page.getByRole("button", { name: "Write new sentences" }).click();
  await expect(page.getByText(/Wrote \d+ new sentences?\./)).toBeVisible();
  const detail = page.locator(".detail");
  await expect(detail.locator(".author", { hasText: "Written by Perennial AI" }).first()).toBeVisible();
  await expect(detail.locator(".author.warn")).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(detail.locator(".author.warn").first()).toBeVisible();
  await expect(detail.locator(".author", { hasText: "Written by Perennial AI" })).toHaveCount(0);
});
