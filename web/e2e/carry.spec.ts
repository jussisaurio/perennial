import { expect, test, type Page } from "./test";
import { standBy } from "./helpers";

// #358, carry and put down: pick up a pebble by the pond, put it in, and the
// frog on its lily pad hops away, until it has had enough and only looks at
// you; put a pebble down on the grass and pick it up again. Nothing here is
// saved.

type Spot = { x: number; z: number };
/** The parts of the dev-only scene handle (window.__garden) these tests read and move. */
type CarryScene = {
  layout: { pond: Spot & { r: number } };
  carry: { held: number | null };
  guests: { sprites: { v: { id: string }; body: { at: { x: number; z: number } } }[] };
};

const scene = (page: Page) => page.evaluate(() => (window as unknown as { __garden: CarryScene }).__garden);

/** Where the first pebble waits. */
const pebbleSpot = (page: Page) =>
  page.evaluate(async () => {
    const { pebbleHome } = await import(/* @vite-ignore */ "/src/garden/carry.ts");
    const L = (window as unknown as { __garden: { layout: Parameters<typeof pebbleHome>[0] } }).__garden.layout;
    return pebbleHome(L, 0);
  });

const frogAt = async (page: Page) => {
  const f = (await scene(page)).guests.sprites.find((s) => s.v.id === "frog")!;
  return { x: f.body.at.x, z: f.body.at.z };
};

/** Stand at the pond's edge, facing its middle: what you put down goes in the water. */
const byPond = async (page: Page) => {
  const p = (await scene(page)).layout.pond;
  await standBy(page, { x: p.x, y: 0, z: p.z }, p.r + 0.3);
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-01T12:00:00"));
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("pick up a pebble with a tap, put it in the pond: the frog hops, then only looks; put one on the grass", async ({ page }) => {
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
  await expect.poll(async () => (await scene(page)).carry.held, { timeout: 15_000 }).not.toBeNull();
  await expect(page.locator(".gw-hand")).toBeVisible();
  await expect(status).toHaveText("You hold the pebble.");

  // Put it down in front of you, into the pond. The frog hops to another pad.
  const before = await frogAt(page);
  await byPond(page);
  await act("Put it down").click();
  await expect(status).toHaveText("Plop. Rings spread on the water. The frog hops to another pad.");
  expect(await frogAt(page)).not.toEqual(before);
  await expect(page.locator(".gw-hand")).toHaveCount(0);

  // The pebble sank, and another waits by the pond. Twice more, the frog hops; then it has had enough.
  const pebbleIn = async () => {
    await standBy(page, pebble, 0.8);
    await act("Pick up the pebble").click();
    await byPond(page);
    await act("Put it down").click();
  };
  for (let i = 0; i < 2; i++) {
    await pebbleIn();
    await expect(status).toHaveText(/The frog hops to another pad\.$/);
  }
  await pebbleIn();
  await expect(status).toHaveText("Plop. Rings spread on the water. The frog looks at you.");
  await expect(page.locator(".gw-say").filter({ hasText: "…" })).toBeVisible();

  // Put one down on the grass: it lies there, in reach, and can be picked up again.
  await standBy(page, pebble, 0.8);
  await act("Pick up the pebble").click();
  await act("Put it down").click();
  await expect(status).toHaveText("You put it down.");
  await expect(act("Pick up the pebble")).toBeVisible();
  expect(errors).toEqual([]);
});
