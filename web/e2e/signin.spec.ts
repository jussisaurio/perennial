import { expect, test, type Page } from "@playwright/test";
import { newEmail, startCourse } from "./helpers";

// #312: on some phones an auth request gets no answer at all. The form must not stay stuck.

/**
 * The next request to `path` reaches the server, but its answer never comes
 * back to the page. `reached` resolves once the server has answered.
 */
async function loseAnswer(page: Page, path: string): Promise<{ reached: Promise<void> }> {
  let reached!: () => void;
  const done = new Promise<void>((resolve) => (reached = resolve));
  await page.route(
    `**${path}`,
    async (route) => {
      await route.fetch();
      reached();
    },
    { times: 1 },
  );
  // Wrapped: an async function returning a bare promise would wait for it.
  return { reached: done };
}

const codeFor = async (page: Page, address: string): Promise<string> => (await (await page.request.get(`/api/dev/outbox?email=${encodeURIComponent(address)}`)).json()).code;

/** An anonymous learner on Settings, with the email typed in. */
async function openEmailStep(page: Page, address: string) {
  await page.clock.install();
  await startCourse(page);
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Email").fill(address);
}

/** Enter the code and sign in; the app reloads as the account. */
async function enterCode(page: Page, address: string, code: string) {
  await page.getByLabel("Code", { exact: true }).fill(code);
  const reloaded = page.waitForEvent("load");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await reloaded;
  await expect(page.getByText(address)).toBeVisible();
}

test("a code request with no answer still moves on to the code step, and the code works", async ({ page }) => {
  const address = newEmail();
  await openEmailStep(page, address);
  const { reached } = await loseAnswer(page, "/api/auth/email-otp/send-verification-otp");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await reached;
  await expect(page.locator("form").getByRole("button", { name: /Sending/ })).toBeVisible();
  await page.clock.fastForward(20_000);
  await expect(page.getByText("may still be on its way. If no email comes in a minute, send it again.")).toBeVisible();
  await enterCode(page, address, await codeFor(page, address));
});

test("a learner who already has a code can enter it without a new email", async ({ page }) => {
  const address = newEmail();
  await openEmailStep(page, address);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByText("We sent a 6-digit code")).toBeVisible();
  const code = await codeFor(page, address);

  // A reload loses the code step; the code in the email still works.
  await page.reload();
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Email").fill(address);
  let sends = 0;
  page.on("request", (r) => r.url().includes("/send-verification-otp") && sends++);
  await page.getByRole("button", { name: "Enter a code I already have" }).click();
  await expect(page.getByText("Enter the 6-digit code we sent to")).toBeVisible();
  await enterCode(page, address, code);
  expect(sends).toBe(0);
});

test("the code can be sent again after a short wait, and it is the same code", async ({ page }) => {
  const address = newEmail();
  await openEmailStep(page, address);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByText("We sent a 6-digit code")).toBeVisible();
  const code = await codeFor(page, address);

  await expect(page.getByRole("button", { name: "Send the code again in 30 s" })).toBeDisabled();
  await page.clock.fastForward(30_000);
  const again = page.getByRole("button", { name: "Send the code again", exact: true });
  await expect(again).toBeEnabled();
  const second = page.waitForResponse((r) => r.url().includes("/send-verification-otp"));
  await again.click();
  expect((await second).ok()).toBe(true);
  await expect(page.getByText("We sent the code to")).toBeVisible();
  await expect(page.getByRole("button", { name: /Send the code again in \d+ s/ })).toBeDisabled();
  expect(await codeFor(page, address)).toBe(code);
  await enterCode(page, address, code);
});

test("a sign-in with no answer still signs in, when the server did sign in", async ({ page }) => {
  const address = newEmail();
  await openEmailStep(page, address);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByText("We sent a 6-digit code")).toBeVisible();
  await page.getByLabel("Code", { exact: true }).fill(await codeFor(page, address));

  const { reached } = await loseAnswer(page, "/api/auth/sign-in/email-otp");
  const reloaded = page.waitForEvent("load");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  // No "Signing in…" check here: the cookie from route.fetch() already moves
  // the sync to the account, which can redraw the form while sign-in waits.
  await reached;
  await page.clock.fastForward(20_000);
  await reloaded;
  await expect(page.getByText(address)).toBeVisible();
});
