import { expect, type Page } from "@playwright/test";
import { MOCK_LLM_URL } from "../playwright.config";

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

/** Fill the AI form with the mock provider and connect. */
export async function connectMockAI(page: Page) {
  // The own-key form sits behind a disclosure, which renders after an async check.
  const own = page.getByText("Use my own API key or a local model");
  const service = page.getByLabel("Service");
  await expect(own.or(service).first()).toBeVisible();
  if (!(await service.isVisible())) await own.click();
  await page.getByLabel("Service").selectOption("Ollama (local)");
  await page.getByText("Address and format").click();
  await page.getByLabel("Address (URL)").fill(MOCK_LLM_URL);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
}

/** First-run onboarding through to a home screen with words ready. */
export async function startCourse(page: Page) {
  await page.goto("/");
  await connectMockAI(page);
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
