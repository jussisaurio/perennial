import { expect, test, type Page } from "./test";
import { pinDetail, standBy } from "./helpers";

// #358, carry and throw: pick up a pebble by the pond, throw it in, and the
// frog on its lily pad hops away, until it has had enough and only looks at
// you; throw one on the grass. Nothing here is saved.

/** The renderer's visitors, which these tests read. */
type Guests = { guests: { sprites: { v: { id: string }; body: { at: { x: number; z: number } } }[] } };

/** Where the first pebble waits. */
const pebbleSpot = (page: Page) =>
  page.evaluate(async () => {
    const { pebbleHome } = await import(/* @vite-ignore */ "/src/garden/carry.ts");
    return pebbleHome(window.__garden.game.layout, 0);
  });

const frogAt = (page: Page) =>
  page.evaluate(() => {
    const f = (window.__garden as unknown as Guests).guests.sprites.find((s) => s.v.id === "frog")!;
    return { x: f.body.at.x, z: f.body.at.z };
  });

/** Turn to face the middle of the pond, where you stand. */
const facePond = (page: Page) =>
  page.evaluate(() => {
    const { me, layout } = window.__garden.game;
    const p = layout.pond;
    // Forward is -z at yaw 0.
    me.yaw = Math.atan2(-(p.x - me.x), -(p.z - me.z));
  });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-01T12:00:00"));
  // Low detail: software WebGL on CI draws it faster, and every click waits for frames.
  await pinDetail(page, "low");
});

test("pick up a pebble with a tap, throw it in the pond: the frog hops, then only looks; throw one on the grass", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The frog, with no word of its own here: it sits on the lily pad nearest the gate.
  await page.goto("/?demo=es:3&visitors=frog#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  const pebble = { ...(await pebbleSpot(page)), y: 0.03 };
  const act = (name: string) => page.getByRole("button", { name, exact: true });
  const status = page.locator(".sr-only[role=status]");

  // A tap on the pebble from a few steps away: you walk up and pick it up. It shows by the action button.
  await page.mouse.click(...(await standBy(page, pebble, 3)));
  await expect.poll(() => page.evaluate(() => window.__garden.game.pebbles.held), { timeout: 15_000 }).not.toBeNull();
  await expect(page.locator(".gw-hand")).toBeVisible();
  await expect(status).toHaveText("You hold the pebble.");

  // Throw it where you face: into the pond. The frog hops to another pad.
  await facePond(page);
  const before = await frogAt(page);
  await act("Throw it").click();
  await expect(status).toHaveText("Plop. Rings spread on the water. The frog hops to another pad.");
  expect(await frogAt(page)).not.toEqual(before);
  await expect(page.locator(".gw-hand")).toHaveCount(0);

  // The pebble sank, and another waits by the pond. Twice more, the frog hops; then it has had enough.
  const pebbleIn = async () => {
    await act("Pick up the pebble").click();
    await act("Throw it").click();
  };
  for (let i = 0; i < 2; i++) {
    await pebbleIn();
    await expect(status).toHaveText(/The frog hops to another pad\.$/);
  }
  await pebbleIn();
  await expect(status).toHaveText("Plop. Rings spread on the water. The frog looks at you.");
  await expect(page.locator(".gw-say").filter({ hasText: "…" })).toBeVisible();

  // Throw one away from the pond: it lands on the grass, and can be picked up again there.
  await act("Pick up the pebble").click();
  await page.evaluate(() => {
    window.__garden.game.me.yaw += Math.PI;
  });
  await act("Throw it").click();
  await expect(status).toHaveText("It lands on the ground.");
  expect(errors).toEqual([]);
});
