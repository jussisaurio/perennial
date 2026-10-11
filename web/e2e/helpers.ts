import { expect, type Page } from "@playwright/test";

/** Read a whole IndexedDB object store from the app's database. */
export function store<T = Record<string, unknown>>(page: Page, name: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open("perennial");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction(name).objectStore(name).getAll();
          req.onsuccess = () => resolve(req.result as T[]);
          req.onerror = () => reject(req.error);
        };
      }),
    name,
  );
}

export const newEmail = (prefix = "learner") => `${prefix}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** Sign in with an email code, read from the dev server's outbox. */
export async function signIn(page: Page, address: string, cta: string) {
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: cta }).click();
  await expect(page.getByText("We sent a 6-digit code")).toBeVisible();
  const { code } = await (await page.request.get(`/api/dev/outbox?email=${encodeURIComponent(address)}`)).json();
  await page.getByLabel("Code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** First-run onboarding through to a home screen with words ready. */
export async function startCourse(page: Page, address = newEmail()) {
  await page.goto("/");
  // Perennial AI (the mock model behind the dev server) prepares the words.
  await signIn(page, address, "Start free with my email");
  await expect(page.getByText(`Signed in as ${address}`)).toBeVisible();
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page.getByText(/new words are ready/)).toBeVisible();
}

export async function startSession(page: Page) {
  await page.getByRole("button", { name: /today's session/ }).click();
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

/** Reveal the answer and grade it (waiting past the double-click guard). */
export async function grade(page: Page, key: "1" | "2") {
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: /I remembered/ }).waitFor();
  await page.waitForTimeout(450);
  await advance(page, key);
}
