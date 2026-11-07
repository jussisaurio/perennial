import { expect, test, type Page } from "./test";
import { pinDetail } from "./helpers";

// #714, the stile in the back fence: wooden steps over it, once the first
// stile note is unlocked by the words known. The note lies under its step; read
// it, climb, and from the top board look out along an old path up a small hill.
// Until note n08, the walk goes no further: the button climbs you back down. The clock is pinned to a day.

/** The parts of the dev-only scene handle (window.__garden) this test reads and moves. */
type StileScene = {
  layout: object;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  camera: { position: { y: number } };
};

const DAY = new Date("2026-09-26T11:00:00");

const scene = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __garden: StileScene }).__garden;
  return { z: s.z, eye: s.camera.position.y };
});

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(DAY);
  await page.setViewportSize({ width: 1280, height: 720 });
  // Low detail: software WebGL on CI draws it faster, and every click waits for frames.
  await pinDetail(page, "low");
});

test("read the note under the stile's step, climb it and look out, and climb down again", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Enough words known for the first stile note (n05).
  await page.goto("/?demo=es:300#/today");
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  const status = page.locator(".sr-only[role=status]");

  // Stand at the stile's foot, facing the back fence (−z is yaw 0).
  const foot = await page.evaluate(async () => {
    const { stileAt } = await import(/* @vite-ignore */ "/src/garden/stile.ts");
    const s = (window as unknown as { __garden: StileScene }).__garden;
    const at = stileAt(s.layout as Parameters<typeof stileAt>[0]);
    Object.assign(s, { x: at.foot[0], z: at.foot[1] + 0.2, yaw: 0, pitch: -0.3 });
    return at.foot;
  });

  // The note under the step comes first: it says what the stile is.
  await page.getByRole("button", { name: "Read the note", exact: true }).click();
  const card = page.getByRole("dialog", { name: "A note from the gardener" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Close" }).click();

  await expect(status).toHaveText("Wooden steps go over the back fence.");
  await page.getByRole("button", { name: "Climb the stile", exact: true }).click();
  await expect(status).toHaveText("You stand on the steps, above the fence. The steps down the other side are broken. Past them, an old path goes up a small hill.");
  // On the top board, the eye is above the fence (0.8 m), higher than a walker's (1.05 m).
  await expect.poll(async () => (await scene(page)).eye, { intervals: [50], timeout: 5_000 }).toBeGreaterThan(1.8);

  // The walk goes no further: the button climbs you down, to the foot inside the garden.
  await page.getByRole("button", { name: "Climb down", exact: true }).click();
  await expect(page.getByRole("button", { name: "Climb the stile", exact: true })).toBeVisible();
  expect((await scene(page)).z).toBeCloseTo(foot[1], 5);
  await expect.poll(async () => (await scene(page)).eye, { intervals: [50], timeout: 5_000 }).toBeLessThan(1.2);
  expect(errors).toEqual([]);
});
