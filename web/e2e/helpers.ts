import { expect, type Page } from "@playwright/test";

export const newEmail = (prefix = "learner") => `${prefix}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** Rows the server has for the signed-in learner (dev-only endpoint). */
export async function serverRows<T = Record<string, unknown>>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(async (table) => (await fetch(`/api/dev/rows?table=${table}`)).json(), table);
}

/** Wait until the server has `n` rows in `table` (writes upload in the background). */
export async function expectServerRows(page: Page, table: string, n: number | ((count: number) => boolean)) {
  const ok = typeof n === "number" ? (c: number) => c === n : n;
  await expect.poll(async () => ok((await serverRows(page, table)).length), { timeout: 15_000, message: `${table} rows` }).toBe(true);
}

/** Enter an email, read the code from the dev server's outbox, sign in. */
export async function signIn(page: Page, address: string, cta: string) {
  await page.getByLabel("Email").fill(address);
  await page.locator("form").getByRole("button", { name: cta }).click();
  await expect(page.getByText("We sent a 6-digit code")).toBeVisible();
  const { code } = await (await page.request.get(`/api/dev/outbox?email=${encodeURIComponent(address)}`)).json();
  await page.getByLabel("Code", { exact: true }).fill(code);
  // The form's button, not the Sign in button in the landing page header.
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
}

/** First run: the landing page, then "Start learning", as an anonymous learner. */
export async function startCourse(page: Page, language: "Spanish" | "German" = "Spanish") {
  await page.goto("/");
  if (language !== "Spanish") await page.getByRole("radio", { name: new RegExp(language) }).check();
  await page.getByRole("button", { name: `Start learning ${language}` }).click();
  await expect(page.getByText(/seeds are ready/)).toBeVisible({ timeout: 15_000 });
}

/** Add an email to the anonymous learner from Settings. */
export async function addEmail(page: Page, address = newEmail()) {
  await page.getByRole("tab", { name: "Settings" }).click();
  // The app reloads once the user changes (anonymous → account).
  const reloaded = page.waitForEvent("load");
  await signIn(page, address, "Send me a code");
  await reloaded;
  await expect(page.getByText(address)).toBeVisible();
  return address;
}

export async function openAdd(page: Page) {
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("button", { name: "Add words" }).click();
}

export async function startSession(page: Page) {
  await page.getByRole("button", { name: /today's 5 minutes/i }).click();
  await expect(page.locator(".kicker")).toBeVisible();
}

export const kicker = (page: Page) => page.locator(".kicker");

/** Press a key and wait until the session has moved on to another card. */
export async function advance(page: Page, key: string) {
  const root = page.locator(".session");
  const before = await root.getAttribute("data-card");
  await page.keyboard.press(key);
  await expect(root).not.toHaveAttribute("data-card", before!);
}

/** Reveal the answer and wait until the double-click guard lets an answer through. */
export async function reveal(page: Page) {
  await page.keyboard.press("Space");
  await expect(page.locator("main.card")).toHaveAttribute("data-armed", "true");
}

/** Answer a new-word card: show its meaning, then "New to me" ("1") or "I knew it" ("2"). */
export async function answerIntro(page: Page, key: "1" | "2") {
  await reveal(page);
  await advance(page, key);
}

/** Reveal the answer and grade it (waiting past the double-click guard). */
export async function grade(page: Page, key: "1" | "2") {
  await reveal(page);
  await advance(page, key);
}

/**
 * Wait until the garden strip stops growing (the demo learner's words sync in
 * over a moment) and is wider than `min` pixels. Returns the strip's width.
 */
export async function settledGardenWidth(page: Page, min = 2000) {
  const strip = page.locator(".garden-scroll");
  const width = () => strip.evaluate((el) => el.scrollWidth);
  let last = -1;
  await expect
    .poll(
      async () => {
        const w = await width();
        const settled = w === last && w > min;
        last = w;
        return settled;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(true);
  return last;
}

/** A point on the strip's plant nearest the middle, a little above its foot (between two plants there is a small gap). */
export async function plantNearMiddle(page: Page) {
  const box = (await page.locator(".garden-scroll").boundingBox())!;
  return page.locator(".garden svg > g[transform] rect").evaluateAll((els, mid) => {
    const r = els.map((e) => e.getBoundingClientRect()).sort((a, b) => Math.abs(a.x + a.width / 2 - mid) - Math.abs(b.x + b.width / 2 - mid))[0];
    return [r.x + r.width / 2, r.bottom - 20] as const;
  }, box.x + box.width / 2);
}
