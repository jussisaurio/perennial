import { expect, test, type Page } from "./test";
import type { WalkScene } from "./helpers";

// #364, the deadpan scenery: a sundial by the bench that tells the real time
// (and is closed at night), a mouse door at the foot of the hedge, and a fish
// that jumps once for someone who walks round the pond three times.

/** The parts of the dev-only scene handle (window.__garden) these tests read. */
type JokeScene = WalkScene & {
  pitch: number;
  layout: { pond: { x: number; z: number }; gate: { x: number }; bounds: { maxZ: number } };
  bench: { x: number; z: number };
  jokes: { shadow: { rotation: { y: number }; visible: boolean }; leapt: number | null; fish: { visible: boolean } };
};

async function openWalk(page: Page) {
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

/** Where things are: the sundial (by the bench), the mouse door and its mat (by the big door). */
const places = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __garden: JokeScene }).__garden;
    const z0 = s.layout.bounds.maxZ + 0.1;
    const mx = s.layout.gate.x - 0.9;
    return {
      sundial: { x: s.bench.x - 1.05, y: 0.5, z: s.bench.z },
      door: { x: mx, y: 0.1, z: z0 - 0.02 },
      mat: { x: mx, y: 0.02, z: z0 - 0.08 },
    };
  });

/** Stand `metres` from a point, on its garden side (-z), facing it; return where it shows on the page (pixels). */
const lookAt = (page: Page, p: { x: number; y: number; z: number }, metres: number) =>
  page.evaluate(
    ({ p, metres }) => {
      const s = (window as unknown as { __garden: JokeScene }).__garden;
      // Forward is -z at yaw 0: yaw π faces +z.
      Object.assign(s, { x: p.x, z: p.z - metres, yaw: Math.PI, pitch: -Math.atan2(1.05 - p.y, metres) });
      return new Promise<[number, number]>((done) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const v = new s.tmp.constructor(p.x, p.y, p.z).project(s.camera);
            const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
            done([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
          }),
        ),
      );
    },
    { p, metres },
  );

const jokes = (page: Page) =>
  page.evaluate(() => {
    const j = (window as unknown as { __garden: JokeScene }).__garden.jokes;
    return { shadow: j.shadow.rotation.y, shadowShows: j.shadow.visible, leapt: j.leapt, fish: j.fish.visible };
  });

test.beforeEach(async ({ page }) => {
  // Three in the afternoon.
  await page.clock.setFixedTime(new Date("2026-06-01T15:00:00"));
  await page.setViewportSize({ width: 1280, height: 800 });
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("the sundial tells the time and is closed at night; the mouse door is the wrong size; its mat says welcome", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?demo=es:3#/today");
  await openWalk(page);
  const at = await places(page);

  // Three o'clock: the shadow is a quarter of the way round from noon, toward the east.
  expect((await jokes(page)).shadow).toBeCloseTo(-Math.PI / 4);
  // By day a tap names it.
  await page.mouse.click(...(await lookAt(page, at.sundial, 1.5)));
  await expect(page.locator(".gw-tag").filter({ hasText: "el reloj de sol" })).toBeVisible();

  // The mouse door, low in the hedge by the big door.
  await page.mouse.click(...(await lookAt(page, at.door, 1)));
  await expect(page.locator(".gw-say")).toHaveText("Locked. Wrong size.");
  // A screen reader hears the line too.
  await expect(page.locator(".sr-only[role=status]")).toHaveText("Locked. Wrong size.");
  // Its mat, in the course language.
  await page.mouse.click(...(await lookAt(page, at.mat, 1)));
  await expect(page.locator('.gw-tag[lang="es"]').filter({ hasText: "la bienvenida" })).toBeVisible();

  // At night: no shadow, and the sundial is closed.
  await page.getByRole("button", { name: "Time of day: Day" }).click();
  await page.getByRole("button", { name: "Time of day: Evening" }).click();
  expect((await jokes(page)).shadowShows).toBe(false);
  await page.mouse.click(...(await lookAt(page, at.sundial, 1.5)));
  await expect(page.locator(".gw-say")).toHaveText("Sundial: closed until morning.");
  expect(errors).toEqual([]);
});

test("three times round the pond, and one fish jumps, once", async ({ page }) => {
  await page.goto("/?demo=es:3#/today");
  await openWalk(page);
  /** Walk `turns` times round the pond, facing it, a frame per step. */
  const round = (turns: number) =>
    page.evaluate(async (turns) => {
      const s = (window as unknown as { __garden: JokeScene }).__garden;
      const p = s.layout.pond;
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      for (let a = 0; a <= turns * Math.PI * 2; a += 0.3) {
        const [x, z] = [p.x + Math.cos(a) * 2, p.z + Math.sin(a) * 2];
        // Forward is -z at yaw 0.
        Object.assign(s, { x, z, yaw: Math.atan2(-(p.x - x), -(p.z - z)), pitch: -0.3 });
        await frame();
      }
    }, turns);

  await round(2.9);
  expect((await jokes(page)).leapt).toBeNull();
  await round(0.3);
  // With reduced motion (as in these tests) it shows, still, at the top of its leap.
  await expect.poll(async () => (await jokes(page)).fish).toBe(true);
  const leapt = (await jokes(page)).leapt;
  expect(leapt).not.toBeNull();
  // It goes back in, and three more laps bring no second fish.
  await expect.poll(async () => (await jokes(page)).fish, { timeout: 5_000 }).toBe(false);
  await round(3.2);
  expect(await jokes(page)).toMatchObject({ leapt, fish: false });
});
