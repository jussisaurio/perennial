import { expect, test } from "@playwright/test";
import { addEmail, serverRows, startCourse } from "./helpers";

test("target recall changed with the keyboard is saved on the server", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByText("How often to review").click();
  const slider = page.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Target: remember 92% of words")).toBeVisible();
  await expect.poll(async () => (await serverRows<{ retention: number }>(page, "course"))[0]?.retention).toBeCloseTo(0.92);
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

test("anonymous learners are invited to add an email; after that the account card says words sync", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Keep your garden safe.")).toBeVisible();
  await expect(page.getByText("All changes are saved.")).toBeVisible();
  await addEmail(page);
  await expect(page.getByText("Your words sync on all your devices")).toBeVisible();
  await expect(page.getByText(/AI words left this month/)).toBeVisible();
});

test("a change of user does not clean up data under live queries (#112)", async ({ page }) => {
  // TanStack DB error 152: a source collection cleaned up while a live query reads it. Sentry gets every one.
  const cleanedUnder: string[] = [];
  page.on("console", (m) => /manually cleaned up|error 152/.test(m.text()) && cleanedUnder.push(m.text()));
  await startCourse(page);
  await addEmail(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: /Start learning/ })).toBeVisible();
  expect(cleanedUnder).toEqual([]);
});

test("deleting the account removes it, signs out, and says goodbye", async ({ page }) => {
  await startCourse(page);
  await addEmail(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByText("Delete my account").first().click();
  const confirm = page.getByRole("button", { name: "Delete my account" });
  await expect(confirm).toBeDisabled(); // needs the word typed
  await page.getByRole("textbox").last().fill("delete");
  await confirm.click();
  // Back on the landing page, signed out, with one goodbye.
  await expect(page.getByText("Your garden is gone. Thank you for growing it.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("¡Buena suerte!")).toBeVisible();
  // From the test side with the page's cookies: the app reloads itself as the user changes.
  expect((await page.request.get("/api/me")).status()).toBe(401);
  await expect(page.getByRole("button", { name: /Start learning/ })).toBeVisible();
});
