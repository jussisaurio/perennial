import { expect, test, type Page } from "./test";
import { standBy } from "./helpers";

// #378 (#335 S2), fetch: throw the stick by the dog and it brings something
// back to your feet, with its word. On this day the first throw brings back the
// stick, and the second the gnome's hat (fetch.ts: seeded by the day and the
// throw). The gnome turns its back until you give the hat back. The tests run
// with reduced motion (playwright.config.ts): the dog is just back, no running.

type Spot = { x: number; z: number };
type Sprite = { v: { id: string }; body: Spot & { at: Spot; frame: string } };
/** The parts of the dev-only scene handle (window.__garden) these tests read and move. */
type FetchScene = { x: number; z: number; yaw: number; pitch: number; guests: { sprites: Sprite[] } };

const visitor = (page: Page, id: string) =>
  page.evaluate((id) => (window as unknown as { __garden: FetchScene }).__garden.guests.sprites.find((s) => s.v.id === id)!.body, id);

/** Stand `metres` from a point, on its gate side, facing it (forward is -z at yaw 0). */
const face = (page: Page, p: Spot, metres: number) =>
  page.evaluate(
    ({ p, metres }) => {
      const s = (window as unknown as { __garden: FetchScene }).__garden;
      Object.assign(s, { x: p.x, z: p.z + metres, yaw: 0, pitch: -0.3 });
    },
    { p, metres },
  );

test.beforeEach(async ({ page }) => {
  // The day is pinned, and its clock runs: the dog waits by you a moment before it goes home.
  await page.clock.install({ time: new Date("2026-06-01T12:00:00") });
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("throw the stick by the dog: it brings back the stick, then the gnome's hat; give the gnome its hat back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // perro (rank 370) is in this garden, so the dog sits at its plant; the gnome stands at a bed corner.
  await page.goto("/?demo=es:380&visitors=dog,gnome#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^380 plants · \d+ in bloom/)).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => "__garden" in window);
  const act = (name: string) => page.getByRole("button", { name, exact: true });
  const status = page.locator(".sr-only[role=status]");
  const stick = await page.evaluate(async () => {
    const { stickHome } = await import(/* @vite-ignore */ "/src/garden/carry.ts");
    return stickHome((window as unknown as { __garden: { layout: Parameters<typeof stickHome>[0] } }).__garden.layout);
  });
  const dog = (await visitor(page, "dog")).at;

  // Pick up the stick by the shed, and throw it from 3.2 m (a throw's length) in front of the dog.
  await standBy(page, { ...stick, y: 0.05 }, 0.6);
  await act("Pick up the stick").click();
  await face(page, dog, 3.2);
  await act("Throw it").click();
  await expect(status).toHaveText("The dog brings back the stick. el palo");
  await expect(status.locator("span[lang=es]")).toHaveText("el palo");
  const tag = page.locator(".gw-tag");
  await expect(tag).toHaveText("el palo · stick");

  // It dropped it at your feet: pick it up, and throw it again once the dog is home.
  await act("Pick up the stick").click();
  await expect.poll(async () => {
    const b = await visitor(page, "dog");
    return [b.x, b.z];
  }).toEqual([dog.x, dog.z]);
  await act("Throw it").click();
  await expect(status).toHaveText("The dog brings back the gnome's hat. The gnome turns to the fence. el gorro");
  await expect(tag).toHaveText("el gorro · hat");
  await expect(tag).toHaveAttribute("lang", "es");
  expect((await visitor(page, "gnome")).frame).toBe("back");

  // Carry the hat to the gnome and give it back.
  await act("Pick up the hat").click();
  await expect(status).toHaveText("You hold the hat.");
  await face(page, (await visitor(page, "gnome")).at, 0.8);
  await act("Give the hat back").click();
  await expect(status).toHaveText("The gnome puts its hat back on.");
  expect((await visitor(page, "gnome")).frame).toBe("front");
  await expect(page.locator(".gw-hand")).toHaveCount(0);
  expect(errors).toEqual([]);
});
