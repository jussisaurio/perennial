import { expect, test, type Page } from "@playwright/test";
import { doorNow, serverRows, standAtDoor } from "./helpers";

// #315: the old door in the hedge. Locked until "key" (llave) brings the key;
// a tap picks the key up, a tap opens the door, and it stays open for good.

async function openWalk(page: Page) {
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

test.beforeEach(async ({ page }) => {
  // A fixed day and hour: visitors change by day, and the snail walks the fence over the day.
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("the locked door says so, by a tap or its button; without the word 'llave' there is no key", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The demo learner's 30 words are the most common ones: llave is not among them.
  await page.goto("/?demo=es:30#/today");
  await openWalk(page);
  expect(await doorNow(page)).toMatchObject({ state: "locked", key: null });
  await page.mouse.click(...(await standAtDoor(page, "door")));
  await expect(page.locator(".gw-say")).toHaveText("Locked. The key must be somewhere.");
  // The line goes after a few seconds. Near the door, a button does the same as a tap, for keyboards and screen readers.
  await expect(page.locator(".gw-say")).toBeHidden({ timeout: 8000 });
  await expect(page.getByRole("button", { name: "Pick up the key" })).toHaveCount(0);
  await page.getByRole("button", { name: "Try the door" }).click();
  await expect(page.locator(".gw-say")).toHaveText("Locked. The key must be somewhere.");
  expect(await doorNow(page)).toMatchObject({ state: "locked" });
  expect(errors).toEqual([]);
});

test("'llave' brings the key: a tap picks it up, a tap opens the door, and it is still open after a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?demo=es:30#/today");
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  // "I knew it" on llave, days ago: a good reading answer brings its thing to the garden (#209).
  await page.evaluate(async () => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const llave = (await loadDeck("es")).words.find((w: { lemma: string }) => w.lemma === "llave")!.id as string;
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await postWrite([{ type: "review.insert", row: { id: crypto.randomUUID(), lang: "es", word_id: llave, skill: "read", grade: 4, kind: "known", reviewed_at: at, duration_ms: 4000, sentence_id: null } }]);
  });
  // Open the app again, so the walk's snapshot surely has the review.
  await page.goto("/#/today");
  await openWalk(page);
  expect(await doorNow(page)).toMatchObject({ state: "key", key: true });

  // Tapping the door first: still locked.
  await page.mouse.click(...(await standAtDoor(page, "door")));
  await expect(page.locator(".gw-say")).toHaveText("Locked. The key must be somewhere.");
  // The key: one quiet line, and it is gone from the ground.
  await page.mouse.click(...(await standAtDoor(page, "key")));
  await expect(page.locator(".gw-say")).toHaveText("You found the key.");
  expect(await doorNow(page)).toMatchObject({ state: "held", key: false });
  await expect(page.getByRole("button", { name: "Open the door with the key" })).toBeVisible();
  // The door opens; with reduced motion (as these tests run) at once, without a swing.
  await page.mouse.click(...(await standAtDoor(page, "door")));
  await expect.poll(async () => (await doorNow(page)).state).toBe("open");
  expect((await doorNow(page)).angle).toBeCloseTo(Math.PI / 2);
  await expect(page.getByRole("button", { name: /door/ })).toHaveCount(0);
  // Saved with the course, on the server: it syncs to the learner's other devices.
  await expect.poll(async () => (await serverRows<{ door_open: boolean }>(page, "course"))[0]?.door_open, { timeout: 15_000 }).toBe(true);

  await page.goto("/#/today");
  await openWalk(page);
  expect(await doorNow(page)).toMatchObject({ state: "open", key: null });
  expect((await doorNow(page)).angle).toBeCloseTo(Math.PI / 2);
  expect(errors).toEqual([]);
});
