// Screenshots of named screens for a UI change (#699), so each agent need not write its
// own spec: every screen on a phone and a desktop, light and dark, and each garden spot
// by day and by night. From web/:
//
//   SHOTS_DIR=/abs/folder bun run shots -g "today|door"
//
// -g picks screens by name (leave it out for all). Each PNG is named
// <screen>-<phone|desktop>-<light|dark>[-<day|night>].png. To add a screen, add an
// entry to APP or GARDEN below.

import { pinDetail, readRowsAgain, reveal, standAtDoor, startSession } from "./helpers";
import { expect, test, type Page } from "./test";

const DIR = process.env.SHOTS_DIR;
if (DIR === undefined) throw new Error("set SHOTS_DIR to the folder for the PNGs");

// In the past: the server refuses reviews from its future. The night is a full moon (night.spec.ts).
const DAY = new Date("2026-10-11T12:00:00");
const NIGHT = new Date("2026-09-26T22:00:00");

/** Screens of the app, each reached from a fresh demo learner with 30 words. */
const APP: Record<string, (page: Page) => Promise<void>> = {
  today: async (page) => {
    await page.goto("/?demo=es:30#/today");
    await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  },
  card: async (page) => {
    await APP.today(page);
    await startSession(page);
  },
  answer: async (page) => {
    await APP.card(page);
    await reveal(page);
  },
  summary: async (page) => {
    await APP.card(page);
    for (let i = 0; i < 2; i++) {
      await reveal(page);
      await page.keyboard.press("1");
    }
    await page.getByRole("button", { name: "End session" }).click();
    await expect(page.locator("main.summary")).toBeVisible();
  },
  words: async (page) => {
    await page.goto("/?demo=es:30#/words");
    await expect(page.locator(".word-row").first()).toBeVisible({ timeout: 20_000 });
  },
  settings: async (page) => {
    await page.goto("/?demo=es:30#/settings");
    await expect(page.getByRole("tab", { name: "Settings", selected: true })).toBeVisible({ timeout: 20_000 });
  },
  // The story points to jump to (#751): no learner made.
  jump: async (page) => {
    await page.goto("/?demo");
    await expect(page.getByRole("heading", { name: "Jump to a story point" })).toBeVisible();
  },
};

/** The parts of the dev-only scene handle (window.__garden) the spots move. */
type Scene = { x: number; z: number; yaw: number; pitch: number; over: boolean; layout: object };

/** Spots in the garden walk, each a place to stand once the walk is open. Forward is -z at yaw 0. */
const GARDEN: Record<string, (page: Page) => Promise<unknown>> = {
  // Where the walk opens.
  walk: async () => {},
  shed: (page) =>
    page.evaluate(async () => {
      const { shedAt } = await import(/* @vite-ignore */ "/src/garden/shed.ts");
      const s = (window as unknown as { __garden: Scene }).__garden;
      const at = shedAt(s.layout as Parameters<typeof shedAt>[0]);
      // In front of the notes on its back wall, facing it (+x is yaw -π/2).
      Object.assign(s, { x: at.x - 2, z: at.z, yaw: -Math.PI / 2, pitch: 0.05 });
    }),
  // Among the plants, with their names over them (#729).
  names: (page) =>
    page.evaluate(() => {
      const s = (window as unknown as { __garden: Scene & { layout: { plants: { x: number; z: number }[] } } }).__garden;
      const p = s.layout.plants[40];
      Object.assign(s, { x: p.x + 0.3, z: p.z + 1.8, yaw: 0, pitch: 0.45 });
    }),
  door: (page) => standAtDoor(page),
  stile: (page) =>
    page.evaluate(async () => {
      const { stileAt } = await import(/* @vite-ignore */ "/src/garden/stile.ts");
      const s = (window as unknown as { __garden: Scene }).__garden;
      const at = stileAt(s.layout as Parameters<typeof stileAt>[0]);
      // A few steps back from it, facing the back fence and the hill past it (−z is yaw 0).
      Object.assign(s, { x: at.x + 0.6, z: at.z + 4, yaw: 0.1, pitch: -0.02 });
    }),
  // The same, for a learner without the hill's note (WORDS): brambles, no stile (#749).
  "stile-shut": (page) => GARDEN.stile(page),
  lookout: (page) =>
    page.evaluate(async () => {
      const { lookoutAt } = await import(/* @vite-ignore */ "/src/garden/lookout.ts");
      const { stileAt } = await import(/* @vite-ignore */ "/src/garden/stile.ts");
      const s = (window as unknown as { __garden: Scene }).__garden;
      const hill = lookoutAt(stileAt(s.layout as Parameters<typeof stileAt>[0]));
      // Where the old path ends on the hill, beside the lantern's post, facing out across the valley, as the walk up leaves you (scene.ts goOver).
      const [x, z] = hill.way[hill.way.length - 1];
      Object.assign(s, { over: true, x, z, yaw: 0.08, pitch: 0 });
    }),
  // The dog called from behind a bed (#761): halfway round it, on its way to you.
  dog: async (page) => {
    await expect(page.locator(".gw-loading")).toHaveCount(0, { timeout: 30_000 });
    await page.evaluate(async () => {
      const { standAt } = await import(/* @vite-ignore */ "/src/garden/ground.ts");
      type Dog = Scene & { ground: Parameters<typeof standAt>[0]; call(): void; guests: { sprites: { v: { id: string }; body: { x: number; z: number } }[] } };
      const s = (window as unknown as { __garden: Dog }).__garden;
      const dog = s.guests.sprites.find((g) => g.v.id === "dog")!.body;
      const beds = (s.layout as { beds: { x: number; z: number; w: number; d: number }[] }).beds;
      const bed = beds.reduce((a, b) => (Math.hypot(b.x - dog.x, b.z - dog.z) < Math.hypot(a.x - dog.x, a.z - dog.z) ? b : a));
      // On the far side of the bed from the dog, facing it (forward is -z at yaw 0).
      const d = Math.hypot(bed.x - dog.x, bed.z - dog.z);
      const reach = Math.hypot(bed.w, bed.d) / 2 + 1.5;
      const at = standAt(s.ground, bed.x + ((bed.x - dog.x) / d) * reach, bed.z + ((bed.z - dog.z) / d) * reach);
      Object.assign(s, { x: at.x, z: at.z, yaw: Math.atan2(-(dog.x - at.x), -(dog.z - at.z)), pitch: 0.3 });
      s.call();
    });
    await page.waitForTimeout(1200);
  },
};

/** Spots seen by a learner with fewer words: 500 put the stile's notes at its foot, but not the hill's note (n08). */
const WORDS: Partial<Record<string, number>> = { "stile-shut": 500 };
/** Spots that need a visitor brought in (the URL's `visitors`), and that show it moving, so not with reduced motion. */
const VISITORS: Partial<Record<string, string>> = { dog: "dog" };

/**
 * Open the walk for a demo learner far into the course: 800 words put notes on the shed's
 * nails (each needs 60 or more known words) and under the stile's step, and open the way
 * over the stile to the lookout (note n08, 620 known: not every demo word is known). The door is opened too.
 * A spot in WORDS opens with fewer words.
 */
async function openWalk(page: Page, words: number, visitors: string | undefined) {
  await page.goto(`/?demo=es:${words}${visitors === undefined ? "" : `&visitors=${visitors}`}#/today`);
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(async () => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    await postWrite([{ type: "course.upsert", row: { lang: "es", door_open: true } }]);
  });
  await readRowsAgain(page);
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

/** Two frames: the scene draws a moved camera on the next one. */
const frames = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

const shoot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${name}.png` });

for (const theme of ["light", "dark"] as const) {
  test.describe(() => {
    test.use({ colorScheme: theme });

    for (const [name, go] of Object.entries(APP))
      test(`${name} ${theme}`, async ({ page }, info) => {
        await page.clock.setFixedTime(DAY);
        await go(page);
        await shoot(page, `${name}-${info.project.name}-${theme}`);
      });

    for (const [name, stand] of Object.entries(GARDEN))
      for (const [time, at] of [
        ["day", DAY],
        ["night", NIGHT],
      ] as const)
        test(`${name} ${theme} ${time}`, async ({ page }, info) => {
          await page.clock.setFixedTime(at);
          // Normal detail, as most learners see it, whatever this machine's frame times.
          await pinDetail(page, "normal");
          if (VISITORS[name] !== undefined) await page.emulateMedia({ reducedMotion: "no-preference" });
          // Every other spot opens the way over the stile.
          await openWalk(page, WORDS[name] ?? 800, VISITORS[name]);
          await stand(page);
          // The walk builds its parts after it opens, with a progress line until they are all in.
          await expect(page.locator(".gw-loading")).toHaveCount(0, { timeout: 30_000 });
          await frames(page);
          await shoot(page, `${name}-${info.project.name}-${theme}-${time}`);
        });
  });
}
