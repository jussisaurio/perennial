import { expect, test, type Page } from "./test";
import { pinDetail } from "./helpers";

// #683, #722, the lookout: up a small hill past the stile, a lantern on a post.
// Once note n08 is unlocked by the words known, the stile goes over and the
// old path takes you up. At night a small light shines in a far house across
// the valley. Raise the lantern: before note n12 nothing answers; after it,
// the far light blinks twice, once a visit. The clock is pinned to a night.

/** The parts of the dev-only scene handle (window.__garden) this test reads and moves. */
type LookoutScene = {
  layout: object;
  z: number;
  lookout: { answers: boolean };
  sky: { farLight: { visible: boolean } };
};

const NIGHT = new Date("2026-09-26T22:00:00");

const farLight = (page: Page) => page.evaluate(() => (window as unknown as { __garden: LookoutScene }).__garden.sky.farLight.visible);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NIGHT);
  await page.setViewportSize({ width: 1280, height: 720 });
  // Low detail: software WebGL on CI draws it faster, and every click waits for frames.
  await pinDetail(page, "low");
});

test("over the stile and up the hill; raise the lantern: nothing answers, then, once n12 is unlocked, the far light blinks twice, once", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Enough words known for note n08, the hill (620). Not all the demo's words are known: some stopped getting practice.
  await page.goto("/?demo=es:800#/today");
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  const status = page.locator(".sr-only[role=status]");
  const raise = page.getByRole("button", { name: "Raise the lantern", exact: true });

  // Every night, from the first: the far light shines. Polled: the sky sets it on its first frame, which may not have run yet (#707).
  await expect.poll(() => farLight(page), { intervals: [50], timeout: 5_000 }).toBe(true);

  // Stand at the stile's foot, facing the back fence (−z is yaw 0).
  await page.evaluate(async () => {
    const { stileAt } = await import(/* @vite-ignore */ "/src/garden/stile.ts");
    const s = (window as unknown as { __garden: LookoutScene }).__garden;
    const at = stileAt(s.layout as Parameters<typeof stileAt>[0]);
    Object.assign(s, { x: at.foot[0], z: at.foot[1] + 0.2, yaw: 0, pitch: -0.3 });
  });
  // The three stile notes under the step come first.
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Read the note", exact: true }).click();
    await page.getByRole("dialog", { name: "A note from the gardener" }).getByRole("button", { name: "Close" }).click();
  }

  // Over the stile and up the old path, to the lantern's post.
  await page.getByRole("button", { name: "Climb over the stile", exact: true }).click();
  await expect(raise).toBeVisible({ timeout: 10_000 });

  // Before n12, the far light shines on. This learner may have it: the test says which.
  await page.evaluate(() => ((window as unknown as { __garden: LookoutScene }).__garden.lookout.answers = false));
  await raise.click();
  await expect(status).toHaveText("You raise the lantern. Far away, a small light shines.");

  // Once it answers (n12), the next raise gets two blinks.
  await page.evaluate(() => ((window as unknown as { __garden: LookoutScene }).__garden.lookout.answers = true));
  await raise.click();
  await expect(status).toHaveText("You raise the lantern. Far away, the small light blinks twice.");
  await expect.poll(() => farLight(page), { intervals: [50], timeout: 5_000 }).toBe(false);
  await expect.poll(() => farLight(page), { intervals: [50], timeout: 5_000 }).toBe(true);

  // Once a visit: the next raise gets none.
  await raise.click();
  await expect(status).toHaveText("You raise the lantern. Far away, a small light shines.");

  // Away from the post, the button takes you back to the stile's foot inside the garden.
  await page.evaluate(() => ((window as unknown as { __garden: LookoutScene }).__garden.z += 2));
  await page.getByRole("button", { name: "Walk back to the garden", exact: true }).click();
  await expect(page.getByRole("button", { name: "Climb over the stile", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
