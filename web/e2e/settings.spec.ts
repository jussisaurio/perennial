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
  await expect(slider).toHaveAttribute("aria-valuetext", "92%"); // read as "92%", not "0.92" (#266)
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
  // A radio group is one Tab stop, and the arrow keys change the choice (#266).
  const light = page.getByRole("radio", { name: "Light" });
  await light.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Dark" })).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(light).toHaveAttribute("tabindex", "-1");
  // The tabs too, but an arrow only moves focus: Enter opens the tab. Moving
  // across Garden must not open its full-screen walk, which has no tab bar.
  await page.getByRole("tab", { name: "Settings" }).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Garden" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown"); // Up and Down are left to the page
  await expect(page.getByRole("tab", { name: "Garden" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "true");
});

test("anonymous learners are invited to add an email; after that the account card says words sync", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Keep your garden safe.")).toBeVisible();
  await expect(page.getByText("All changes are saved.")).toBeVisible();
  await addEmail(page);
  await expect(page.getByText("Your words sync on all your devices")).toBeVisible();
  // Progress lives on the server (no on-device copy since offline mode was removed, #188).
  await expect(page.getByText(/Your progress is saved on the Perennial server/)).toBeVisible();
  await expect(page.getByText(/saved on this device and on the Perennial server/)).toHaveCount(0);
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

// #137: signing out while a table is still loading must not fail it (a 401 from the ended
// session marked the collection failed, and every live query on it logged an error).
test("signing out stops syncing first: no failed tables, no 401s", async ({ page }) => {
  const errors: string[] = [];
  const unauthorized: string[] = [];
  page.on("console", (m) => /entered error state|Live Query Error/.test(m.text()) && errors.push(m.text()));
  page.on("response", (r) => r.url().includes("/api/shape") && r.status() === 401 && unauthorized.push(r.url()));
  await startCourse(page);
  await addEmail(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: /Start learning/ })).toBeVisible();
  expect(errors).toEqual([]);
  expect(unauthorized).toEqual([]);
});

test("a sign-out that fails reloads, still signed in and syncing", async ({ page }) => {
  await startCourse(page);
  const email = await addEmail(page);
  await page.route("**/api/auth/sign-out", (route) => route.fulfill({ status: 500, json: {} }));
  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Sign out" }).click();
  await reloaded;
  // Sync runs again after the reload (the sign-out had stopped it).
  await page.waitForResponse((r) => r.url().includes("/api/shape") && r.status() === 200);
  await expect(page.getByText(email)).toBeVisible();
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
