import { expect, test, type Page } from "./test";

// #377, call: with nothing in reach the action button whistles, and each
// visitor in sight answers in its own way. A long press on open ground calls
// too. The demo garden of 400 words has the gnome (hiding, on this day), the frog, the dog, the
// mushroom and (at dusk and night) the moth.

type CallScene = {
  x: number;
  z: number;
  pitch: number;
  guests: { sprites: { v: { id: string }; body: { x: number; z: number } }[] };
};

async function openWalk(page: Page) {
  await page.goto("/?demo=es:400#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

const status = (page: Page) => page.locator(".gw > [role=status]");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  await page.setViewportSize({ width: 1280, height: 720 });
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("with nothing in reach the action button calls: the dog comes to your feet, and a screen reader hears who answered", async ({ page }) => {
  await openWalk(page);
  const call = page.getByRole("button", { name: "Call" });
  // An icon only (#334): the name is for screen readers.
  await expect(call).toHaveText("");
  await call.click();
  // In the order they are listed; the moth is out only at dusk and night, so it is not asked by day. The frog sleeps by day.
  // On this day the gnome hides (#379), and keeps quiet: a call must not give it away.
  await expect(status(page)).toHaveText("The frog croaks once in its sleep. The mushroom does nothing. It is a mushroom. The dog runs over, tail going.");
  // Reduced motion (the e2e default): the dog is at your feet at once, not at its plant on the far side of the garden.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window as unknown as { __garden: CallScene }).__garden;
        const dog = s.guests.sprites.find((g) => g.v.id === "dog")!;
        return Math.hypot(dog.body.x - s.x, dog.body.z - s.z);
      }),
    )
    .toBeLessThan(1);
  // The button stays: it always does something.
  await expect(call).toBeFocused();
});

test("at night a long press on open ground calls too, and the moth does not leave its lantern", async ({ page }) => {
  await openWalk(page);
  const time = page.getByRole("button", { name: /^Time of day: / });
  await time.click();
  await time.click();
  await expect(time).toHaveAccessibleName("Time of day: Night");
  // Look down at the path ahead, and press and hold on it.
  await page.evaluate(() => Object.assign((window as unknown as { __garden: CallScene }).__garden, { pitch: -0.5 }));
  const box = (await page.locator(".gw-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
  await page.mouse.down();
  await expect(status(page)).toContainText("The moth does not leave its lantern.");
  await page.mouse.up();
  // Awake at night, the frog croaks back; no card opened, and no walk started.
  await expect(status(page)).toContainText("The frog croaks back.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
