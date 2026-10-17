import { expect, test, type Page } from "./test";
import type { WalkScene } from "./helpers";

// #361, the night sky: tonight's real moon, and the lanterns blown out one by
// one until the stars come out over the hills. The clock is pinned to a full
// moon's night (26 September 2026, moon.ts), late enough that the walk opens at night.

/** The parts of the dev-only scene handle (window.__garden) these tests read and move. */
type NightScene = WalkScene & {
  pitch: number;
  lanterns: { spots: [number, number][]; on: boolean[] };
  sky: { sunDir: { x: number; y: number; z: number }; starsOut: boolean; stars: { visible: boolean } };
  guests: { sprites: { v: { id: string }; body: { at: { x: number; z: number } } }[] };
  tapLantern(i: number): void;
};

// In the past: the server refuses reviews from its future.
const FULL_MOON_NIGHT = new Date("2026-09-26T22:00:00");

async function openWalk(page: Page) {
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

const night = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __garden: NightScene }).__garden;
    // The lantern the moth goes round: the one where it sits.
    const moth = s.guests.sprites.find((g) => g.v.id === "moth")!.body.at;
    return { on: [...s.lanterns.on], moth: s.lanterns.spots.findIndex(([x, z]) => x === moth.x && z === moth.z), starsOut: s.sky.starsOut, stars: s.sky.stars.visible };
  });

/** Stand `metres` in front of lantern `i` (toward the gate; behind it, away from the gate, if negative), facing it. Returns where its glass is on the screen. */
const standBy = (page: Page, i: number, metres: number) =>
  page.evaluate(
    ({ i, metres }) => {
      const s = (window as unknown as { __garden: NightScene }).__garden;
      const [lx, lz] = s.lanterns.spots[i];
      // Forward is -z at yaw 0.
      Object.assign(s, { x: lx, z: lz + metres, yaw: metres > 0 ? 0 : Math.PI, pitch: -0.05 });
      return new Promise<[number, number]>((done) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const v = new s.tmp.constructor(lx, 0.9, lz).project(s.camera);
            const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
            done([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
          }),
        ),
      );
    },
    { i, metres },
  );

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FULL_MOON_NIGHT);
  await page.setViewportSize({ width: 1280, height: 720 });
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("a full moon's night: tap the moon for its word; blow every lantern out, the moth moves, the stars come out; light one, and they fade", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?demo=es:30#/today");
  await openWalk(page);
  await expect(page.getByRole("button", { name: "Time of day: Night" })).toBeVisible();

  // Face the moon and tap it: its word, like the rest of the garden.
  await page.evaluate(() => {
    const s = (window as unknown as { __garden: NightScene }).__garden;
    const d = s.sky.sunDir;
    Object.assign(s, { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(d.y) });
  });
  const box = (await page.locator(".gw-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".gw-tag").filter({ hasText: "la luna" })).toBeVisible();

  // The moth's lantern goes out with the action button: the moth leaves for another, still lit.
  const status = page.locator(".sr-only[role=status]");
  const start = await night(page);
  expect(start.on.every(Boolean)).toBe(true);
  await standBy(page, start.moth, 0.6);
  await page.getByRole("button", { name: "Blow out the lantern", exact: true }).click();
  await expect(page.getByRole("button", { name: "Light the lantern", exact: true })).toBeVisible();
  await expect(status).toHaveText("This lantern is out.");
  const after = await night(page);
  expect(after.on[start.moth]).toBe(false);
  expect(after.moth).not.toBe(start.moth);
  expect(after.on[after.moth]).toBe(true);
  expect(after.starsOut).toBe(false);

  // Every other lantern, one by one, standing by each.
  await page.evaluate(() => {
    const s = (window as unknown as { __garden: NightScene }).__garden;
    s.lanterns.spots.forEach(([x, z], i) => {
      if (!s.lanterns.on[i]) return;
      Object.assign(s, { x, z: z + 0.6 });
      s.tapLantern(i);
    });
  });
  await expect.poll(async () => (await night(page)).stars, { timeout: 10_000 }).toBe(true);
  expect((await night(page)).on.some(Boolean)).toBe(false);
  await expect(status).toHaveText("Every lantern is out. Stars shine over the hills.");

  // Tap one by the gate from a few steps into the garden: you walk up to it and light it; the stars fade.
  const gate = (await night(page)).on.length - 1;
  await page.mouse.click(...(await standBy(page, gate, -3)));
  await expect.poll(async () => (await night(page)).on[gate], { timeout: 15_000 }).toBe(true);
  expect((await night(page)).starsOut).toBe(false);
  await expect.poll(async () => (await night(page)).stars, { timeout: 10_000 }).toBe(false);
  expect(errors).toEqual([]);
});
