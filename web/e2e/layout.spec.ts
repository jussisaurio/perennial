import { expect, test } from "@playwright/test";
import { answer, reveal, startCourse } from "./helpers";

test("phone: bottom tab bar and no horizontal scroll", async ({ page }) => {
  await startCourse(page);
  const tabs = page.getByRole("tablist");
  const box = (await tabs.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThan(viewport.height / 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// #116: on phones the Add words button sat flush on the filter row, and its
// shadow covered the "All" dropdown. The boxes must keep a gap, and nothing scrolls sideways.
test("phone: Add words keeps clear of the filter dropdown", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  const filter = page.locator(".page select");
  await expect(filter).toBeVisible();
  const add = (await page.getByRole("button", { name: "Add words" }).boundingBox())!;
  const sel = (await filter.boundingBox())!;
  const gap = 4;
  const apart =
    add.x + add.width + gap <= sel.x || sel.x + sel.width + gap <= add.x || add.y + add.height + gap <= sel.y || sel.y + sel.height + gap <= add.y;
  expect(apart, `Add words ${JSON.stringify(add)} vs filter ${JSON.stringify(sel)}`).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("phone: the new-version note fits the screen and its text", async ({ page }) => {
  await startCourse(page);
  // What the app does when the server asks for a newer app (see data/http.ts).
  await page.evaluate(async () => {
    const http = await import(/* @vite-ignore */ "/src/data/http.ts");
    http.reloadNeeded.dispatchEvent(new Event("reload"));
  });
  const note = page.getByRole("status").filter({ hasText: "A new version of Perennial is ready" });
  await expect(note.getByRole("button", { name: "Reload" })).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = (await note.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  // Not squeezed into a narrow column (it was half the screen wide, #115).
  expect(box.width).toBeGreaterThan(viewport.width * 0.75);
  expect(await note.evaluate((e) => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight)).toBe(true);
});

// #124: the language menu and its "start a new one?" question stay on screen.
test("phone: the language menu fits the screen", async ({ page }) => {
  await startCourse(page);
  await page.locator(".course-switch-button").click();
  const viewport = page.viewportSize()!;
  for (const step of ["menu", "ask"]) {
    if (step === "ask") await page.getByRole("menuitem", { name: /German/ }).click();
    const box = (await page.getByRole("menu").boundingBox())!;
    expect(box.x, step).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, step).toBeLessThanOrEqual(viewport.width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("small phone (320 px): the landing page, the answer buttons and the Words search all fit (#202, #120)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await page.goto("/");
  // The five-plant strip shares the row: its last plant ends on the screen.
  // (A phone browser widens the page to fit overflow, so scrollWidth alone can't tell.)
  const last = page.locator(".growth-strip figure").last();
  await expect(last).toBeVisible();
  expect(await last.evaluate((e) => e.getBoundingClientRect().right)).toBeLessThanOrEqual(320);
  await startCourse(page);
  await page.locator("button.start").click();
  for (let i = 0; i < 4; i++) await answer(page, "1");
  await reveal(page);
  // "I remembered" on one line: as tall as "I forgot".
  await expect(page.locator(".actions button").nth(1)).toContainText("I remembered");
  const [forgot, remembered] = await page.locator(".actions button").evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
  expect(remembered).toBe(forgot);
  expect(remembered).toBeLessThan(64);
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: /^Done/ }).click();
  await page.getByRole("tab", { name: "Words" }).click();
  // The search box keeps the row to itself, so its placeholder is not cut.
  const search = page.locator(".search");
  expect(await search.evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(260);
  expect(await fits()).toBe(true);
});

// #264: on a small phone, the parts that end a screen stay on it.
test("small phone: the landing Start, a long card's question, the summary buttons and the word page's Close stay on screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const onScreen = (name: string, box: { y: number; height: number } | null) => {
    expect(box, name).not.toBeNull();
    expect(box!.y + box!.height, name).toBeLessThanOrEqual(page.viewportSize()!.height);
  };
  await page.goto("/");
  onScreen("Start learning", await page.getByRole("button", { name: "Start learning Spanish" }).boundingBox());
  await startCourse(page);
  await page.locator("button.start").click();
  // Short enough that the new-word card scrolls; it opens at the top.
  await page.setViewportSize({ width: 360, height: 520 });
  await reveal(page);
  const prompt = (await page.getByText("Is this word new to you?").boundingBox())!;
  const newToMe = (await page.locator(".answers button").first().boundingBox())!;
  expect(prompt.y + prompt.height, "the answers cover the question").toBeLessThanOrEqual(newToMe.y);
  onScreen("I knew it", await page.locator(".answers button").last().boundingBox());
  await page.keyboard.press("2");
  for (let i = 0; i < 3; i++) await answer(page, "2");
  await page.setViewportSize({ width: 360, height: 640 });
  await page.getByRole("button", { name: "End session" }).click();
  const done = page.getByRole("button", { name: /^Done/ });
  onScreen("Continue this session", await page.getByRole("button", { name: /^Continue this session/ }).boundingBox());
  onScreen("Done", await done.boundingBox());
  // Each label on one line: the two buttons are as tall as each other, and as tall as a one-line button.
  const heights = await page.locator(".summary .actions button").evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
  expect(heights[0]).toBe(heights[1]);
  expect(heights[0]).toBeLessThan(64);
  await done.click();
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("radio", { name: "Flowers" }).click();
  await page.locator(".guide-entry").first().click();
  const dialog = (await page.locator("dialog.guide-page").boundingBox())!;
  const close = (await page.getByRole("button", { name: "Close", exact: true }).boundingBox())!;
  expect(close.y + close.height, "Close is inside the word page").toBeLessThanOrEqual(dialog.y + dialog.height);
  onScreen("Close", close);
});
