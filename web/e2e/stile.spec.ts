import { expect, test } from "./test";
import { pinDetail } from "./helpers";

// #714, #749: the stile notes lie at the foot of the back fence once the first
// stile note is unlocked by the words known. Until note n08, brambles shut the
// way: there is no stile, and the button offers no way over. The clock is pinned to a day.

/** The parts of the dev-only scene handle (window.__garden) this test moves. */
type StileScene = {
  layout: object;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
};

const DAY = new Date("2026-09-26T11:00:00");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(DAY);
  await page.setViewportSize({ width: 1280, height: 720 });
  // Low detail: software WebGL on CI draws it faster, and every click waits for frames.
  await pinDetail(page, "low");
});

test("read the note at the stile's foot; brambles shut the way until the hill's note", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Enough words known for the first stile note (n05), not for the hill's (n08).
  await page.goto("/?demo=es:300#/today");
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);

  // Stand at the stile's foot, facing the back fence (−z is yaw 0).
  await page.evaluate(async () => {
    const { stileAt } = await import(/* @vite-ignore */ "/src/garden/stile.ts");
    const s = (window as unknown as { __garden: StileScene }).__garden;
    const at = stileAt(s.layout as Parameters<typeof stileAt>[0]);
    Object.assign(s, { x: at.foot[0], z: at.foot[1] + 0.2, yaw: 0, pitch: -0.3 });
  });

  await page.getByRole("button", { name: "Read the note", exact: true }).click();
  const card = page.getByRole("dialog", { name: "A note from the gardener" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Close" }).click();

  // Nothing to climb: the brambles are not a way out.
  await expect(card).toBeHidden();
  await expect(page.getByRole("button", { name: /climb/i })).toHaveCount(0);
  expect(errors).toEqual([]);
});
