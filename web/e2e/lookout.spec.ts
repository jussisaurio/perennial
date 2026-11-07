import { expect, test, type Page } from "./test";
import { readRowsAgain } from "./helpers";

// #683, the lookout: a gap in the orchard's far hedge with a lantern on a post.
// At night a small light shines in a far house across the valley. Raise the
// lantern: before note n12 is on the shed's nails nothing answers; after it,
// the far light blinks twice, once a visit. The clock is pinned to a night.

/** The parts of the dev-only scene handle (window.__garden) this test reads and moves. */
type LookoutScene = {
  layout: { orchard: { x: number; z: number; w: number; d: number } };
  lookout: { answers: boolean };
  sky: { farLight: { visible: boolean } };
};

const NIGHT = new Date("2026-09-26T22:00:00");

const farLight = (page: Page) => page.evaluate(() => (window as unknown as { __garden: LookoutScene }).__garden.sky.farLight.visible);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NIGHT);
  await page.setViewportSize({ width: 1280, height: 720 });
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("at night the far light shines; raise the lantern: nothing answers, then, once n12 is on the nails, it blinks twice, once", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?demo=es:30#/today");
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(async () => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    await postWrite([{ type: "course.upsert", row: { lang: "es", door_open: true } }]);
  });
  // The demo already moved the page to /#/today, so going there again would not reload it.
  await readRowsAgain(page);
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  const status = page.locator(".sr-only[role=status]");
  const raise = page.getByRole("button", { name: "Raise the lantern", exact: true });

  // Every night, from the first: the far light shines.
  expect(await farLight(page)).toBe(true);

  // Stand in the gap, beside the lantern's post, facing out across the valley (+z is yaw π).
  await page.evaluate(async () => {
    const { lookoutAt } = await import(/* @vite-ignore */ "/src/garden/lookout.ts");
    const s = (window as unknown as { __garden: LookoutScene }).__garden;
    const gap = lookoutAt(s.layout.orchard);
    Object.assign(s, { x: gap.x, z: gap.z - 0.45, yaw: Math.PI, pitch: 0.03 });
  });

  // This learner has not read n12: the far light shines on.
  await raise.click();
  await expect(status).toHaveText("You raise the lantern. Far away, a small light shines.");

  // Once it answers (n12 needs ~1400 words, too many plants for a test), the next raise gets two blinks.
  await page.evaluate(() => ((window as unknown as { __garden: LookoutScene }).__garden.lookout.answers = true));
  await raise.click();
  await expect(status).toHaveText("You raise the lantern. Far away, the small light blinks twice.");
  await expect.poll(() => farLight(page), { intervals: [50], timeout: 5_000 }).toBe(false);
  await expect.poll(() => farLight(page), { intervals: [50], timeout: 5_000 }).toBe(true);

  // Once a visit: the next raise gets none.
  await raise.click();
  await expect(status).toHaveText("You raise the lantern. Far away, a small light shines.");
  expect(errors).toEqual([]);
});
