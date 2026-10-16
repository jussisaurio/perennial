import { expect, test, type Page } from "./test";
import { serverRows, standByLeave as standBy } from "./helpers";

// #351, leave it out: carry crumbs from the basket on the shed's step to the
// bowl by the gate; after a night, prints lead from the bowl to what a guest
// left; pick it up and hang it on the shed's shelf. Days are calendar days.
// On the pinned day, with crumbs, the sparrow leaves a twig (garden/leave.ts: a seed of the day and the thing).

/** The parts of the dev-only scene handle (window.__garden) these tests read and move. */
type LeaveScene = {
  leaveIt: {
    left: { n: number; bowl: { thing: string; seen: number | null; found: boolean } | null; kept: string[]; hooks: (string | null)[] };
    hand: { from: string } | null;
    came: { row: { guest: string }; find: string } | null;
    findSpot(): { x: number; z: number } | null;
    prints: { visible: boolean } | null;
  };
};

// Months before today: the server refuses days in its future, and the clock here is pinned.
const DAY = new Date("2026-06-01T12:00:00");
const daysLater = (n: number) => new Date(DAY.getTime() + n * 86_400_000);

async function openWalk(page: Page) {
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

/** Come back another day: the clock moves on, the app loads again, and so does the walk (a snapshot of the day it opens). */
async function comeBack(page: Page, at: Date) {
  await page.clock.setFixedTime(at);
  await page.goto("/#/today");
  await page.reload();
  await openWalk(page);
}

const leaveNow = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as { __garden: LeaveScene }).__garden.leaveIt;
    return { left: l.left, hand: l.hand?.from ?? null, came: l.came && { guest: l.came.row.guest, find: l.came.find }, prints: !!l.prints?.visible };
  });

const savedLeft = async (page: Page) => (await serverRows<{ lang: string; garden_left: LeaveScene["leaveIt"]["left"] }>(page, "course")).find((r) => r.lang === "es")?.garden_left;

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(DAY);
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("day 1, three plants: carry the crumbs to the bowl by tapping; the next day prints lead to what the sparrow left; pick it up, hang it, and it stays after a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?demo=es:3#/today");
  await openWalk(page);
  expect((await leaveNow(page)).came).toBeNull();

  // Taps, from a few steps away: you walk up and take the crumbs, then the bowl takes them.
  await page.mouse.click(...(await standBy(page, "basket", 3)));
  await expect.poll(async () => (await leaveNow(page)).hand, { timeout: 15_000 }).toBe("basket");
  // What you hold shows by the action button; a screen reader hears it.
  await expect(page.locator(".gw-hand")).toBeVisible();
  await page.mouse.click(...(await standBy(page, "bowl", 3)));
  await expect.poll(async () => (await leaveNow(page)).left.n, { timeout: 15_000 }).toBe(1);
  expect((await leaveNow(page)).hand).toBeNull();
  await expect(page.locator(".gw-hand")).toHaveCount(0);
  // The same day: nothing came yet, and the basket is shut until the bowl is free.
  await standBy(page, "basket", 0.8);
  await expect(page.getByRole("button", { name: "Take from the basket" })).toHaveCount(0);
  // Saved with the course, on the server: no words, only an id and a day.
  await expect.poll(async () => (await savedLeft(page))?.bowl?.thing, { timeout: 15_000 }).toBe("crumbs");

  // Late that evening: still nothing.
  await comeBack(page, new Date("2026-06-01T23:58:00"));
  expect((await leaveNow(page)).came).toBeNull();

  // The next morning, one night later: a sparrow came; prints lead from the bowl to what it left.
  await comeBack(page, daysLater(1));
  expect(await leaveNow(page)).toMatchObject({ came: { guest: "sparrow", find: "twig" }, prints: true });
  // Walking the garden that day fixes what came, on every device.
  await expect.poll(async () => (await savedLeft(page))?.bowl?.seen, { timeout: 15_000 }).not.toBeNull();
  // Follow the prints by tapping the bowl: you walk to the twig. Tap it to pick it up.
  await page.mouse.click(...(await standBy(page, "bowl", 0.8)));
  await expect(page.getByRole("button", { name: "Pick it up" })).toBeVisible({ timeout: 15_000 });
  await page.mouse.click(...(await standBy(page, "find", 1.2)));
  // Its word and meaning, once, over where it lay.
  await expect(page.locator(".gw-tag").filter({ hasText: "la ramita" })).toBeVisible();
  expect(await leaveNow(page)).toMatchObject({ came: null, prints: false, hand: "shelf", left: { kept: ["twig"] } });
  // Hang it on the shelf: tap a hook.
  await page.mouse.click(...(await standBy(page, "shelf", 1.2)));
  await expect.poll(async () => (await leaveNow(page)).left.hooks.includes("twig"), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await savedLeft(page))?.hooks.includes("twig"), { timeout: 15_000 }).toBe(true);

  // Weeks later, after a reload: the twig is still on the shelf, and nothing else came, as nothing was left.
  await comeBack(page, daysLater(20));
  expect(await leaveNow(page)).toMatchObject({ came: null, left: { kept: ["twig"] } });
  expect((await leaveNow(page)).left.hooks).toContain("twig");
  expect(errors).toEqual([]);
});

test("two weeks away: the hedgehog came; a find not picked up waits, the same, however long", async ({ page }) => {
  await page.goto("/?demo=es:30#/today");
  await openWalk(page);
  await standBy(page, "basket", 0.8);
  await page.getByRole("button", { name: "Take from the basket" }).click();
  await standBy(page, "bowl", 0.8);
  await page.getByRole("button", { name: "Put it in the bowl" }).click();
  await expect.poll(async () => (await savedLeft(page))?.n, { timeout: 15_000 }).toBe(1);

  await comeBack(page, daysLater(14));
  expect((await leaveNow(page)).came).toMatchObject({ guest: "hedgehog", find: "leaf" });
  await expect.poll(async () => (await savedLeft(page))?.bowl?.seen, { timeout: 15_000 }).not.toBeNull();
  // Not picked up; back much later: still the hedgehog's leaf, not the fox's ribbon.
  await comeBack(page, daysLater(60));
  expect((await leaveNow(page)).came).toMatchObject({ guest: "hedgehog", find: "leaf" });
});

test("with a screen reader: the buttons say what they do, and the status says what is there, never how", async ({ page }) => {
  await page.goto("/?demo=es:3#/today");
  await openWalk(page);
  await standBy(page, "basket", 0.8);
  const act = (name: string) => page.getByRole("button", { name, exact: true });
  const status = page.locator(".sr-only[role=status]");
  // The action button is an icon only, with its name for screen readers (#334).
  await expect(act("Take from the basket")).toHaveText("");
  await act("Take from the basket").click();
  await expect(status).toHaveText("You hold the crumbs.");
  await standBy(page, "bowl", 0.8);
  await act("Put it in the bowl").click();
  await expect.poll(async () => (await savedLeft(page))?.n, { timeout: 15_000 }).toBe(1);

  await comeBack(page, daysLater(1));
  await standBy(page, "bowl", 0.8);
  await expect(status).toHaveText("Small prints lead away from the bowl.");
  // Following the prints walks you there, with no need to see them.
  await act("Follow the prints").click();
  await expect(act("Pick it up")).toBeVisible({ timeout: 15_000 });
  await expect(status).toHaveText("Something lies here.");
  await act("Pick it up").click();
  await expect(status).toHaveText("You found la ramita: twig.");
  await standBy(page, "shelf", 1);
  await act("Hang it on the shelf").click();
  await expect.poll(async () => (await leaveNow(page)).left.hooks).toEqual(["twig", null, null]);
});
