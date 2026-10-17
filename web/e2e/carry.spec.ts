import { expect, test, type Page } from "./test";
import { standBy } from "./helpers";

// #358, carry, put down, throw: pick up a pebble by the pond, throw it in, and
// the frog on its lily pad hops away, until it has had enough and only looks
// at you; put a pebble on the cairn's stone. Nothing here is saved.

type Spot = { x: number; z: number };
/** The parts of the dev-only scene handle (window.__garden) these tests read and move. */
type CarryScene = {
  x: number;
  z: number;
  yaw: number;
  layout: { pond: Spot & { r: number } };
  carry: { held: number | null };
  guests: { sprites: { v: { id: string }; x: number; z: number }[] };
};

const scene = (page: Page) => page.evaluate(() => (window as unknown as { __garden: CarryScene }).__garden);

/** Where the first pebble waits, and the cairn's stone. */
const spots = (page: Page) =>
  page.evaluate(async () => {
    const { cairnAt, pebbleHome } = await import(/* @vite-ignore */ "/src/garden/carry.ts");
    const L = (window as unknown as { __garden: { layout: Parameters<typeof cairnAt>[0] } }).__garden.layout;
    return { pebble: pebbleHome(L, 0), cairn: cairnAt(L) };
  });

const frogAt = async (page: Page) => {
  const f = (await scene(page)).guests.sprites.find((s) => s.v.id === "frog")!;
  return { x: f.x, z: f.z };
};

/** Turn to face the middle of the pond, where you stand. */
const facePond = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __garden: CarryScene }).__garden;
    const p = s.layout.pond;
    // Forward is -z at yaw 0.
    s.yaw = Math.atan2(-(p.x - s.x), -(p.z - s.z));
  });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-01T12:00:00"));
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("pick up a pebble with a tap, throw it in the pond: the frog hops, then only looks; a pebble goes on the cairn", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The frog, with no word of its own here: it sits on the lily pad nearest the gate.
  await page.goto("/?demo=es:3&visitors=frog#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  const { pebble, cairn } = await spots(page);
  const act = (name: string) => page.getByRole("button", { name, exact: true });
  const status = page.locator(".sr-only[role=status]");

  // A tap on the pebble from a few steps away: you walk up and pick it up. It shows by the action button.
  await page.mouse.click(...(await standBy(page, { ...pebble, y: 0.03 }, 3)));
  await expect.poll(async () => (await scene(page)).carry.held, { timeout: 15_000 }).not.toBeNull();
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
  for (let i = 0; i < 2; i++) {
    await act("Pick up the pebble").click();
    await act("Throw it").click();
    await expect(status).toHaveText(/The frog hops to another pad\.$/);
  }
  await act("Pick up the pebble").click();
  await act("Throw it").click();
  await expect(status).toHaveText("Plop. Rings spread on the water. The frog looks at you.");
  await expect(page.locator(".gw-say").filter({ hasText: "…" })).toBeVisible();

  // Carry one to the cairn's stone and put it on.
  await act("Pick up the pebble").click();
  await standBy(page, { ...cairn, y: 0.05 }, 0.8);
  await act("Put it on the stones").click();
  await expect(status).toHaveText("The stones wobble, then stand.");
  // It is on the cairn: the top one can be picked up again.
  await expect(act("Pick up the pebble")).toBeVisible();
  expect(errors).toEqual([]);
});
