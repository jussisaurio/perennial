// Screenshots of named screens for a UI change (#699), so each agent need not write its
// own spec: every screen on a phone and a desktop, light and dark, and each garden spot
// by day, at dusk and by night. From web/:
//
//   SHOTS_DIR=/abs/folder bun run shots -g "today|door"
//
// -g picks screens by name (leave it out for all). Each PNG is named
// <screen>-<phone|desktop>-<light|dark>[-<day|dusk|night>].png. To add a screen, add an
// entry to APP or GARDEN below.

import { pinDetail, readRowsAgain, reveal, standAtDoor, startSession } from "./helpers";
import { expect, test, type Page } from "./test";

const DIR = process.env.SHOTS_DIR;
if (DIR === undefined) throw new Error("set SHOTS_DIR to the folder for the PNGs");

// In the past: the server refuses reviews from its future. The night is a full moon (night.spec.ts).
const DAY = new Date("2026-10-11T12:00:00");
const DUSK = new Date("2026-09-26T19:30:00");
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
type Scene = { x: number; z: number; yaw: number; pitch: number; layout: object };

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
  // The same, for a learner without the hill's note (WORDS): brambles over the stile (#749, #770).
  "stile-shut": (page) => GARDEN.stile(page),
  lookout: (page) =>
    page.evaluate(async () => {
      const { lookoutAt } = await import(/* @vite-ignore */ "/src/garden/lookout.ts");
      const { stileAt } = await import(/* @vite-ignore */ "/src/garden/stile.ts");
      const s = (window as unknown as { __garden: Scene }).__garden;
      const hill = lookoutAt(stileAt(s.layout as Parameters<typeof stileAt>[0]));
      // On the hilltop, a step in from where the old path comes up, the lantern's post ahead on the left, facing out across the valley.
      const [x, z] = hill.top;
      Object.assign(s, { x, z: z + 0.5, yaw: 0.08, pitch: 0 });
    }),
  // By the lookout's lantern, on the post's far side from the stool, facing it (#858): its halo up close.
  "hill-post": (page) => standOnHill(page, "post"),
  // Behind the stool, in reach of it (#858): it reads as a seat, not a little gate.
  "hill-stool": (page) => standOnHill(page, "stool"),
  // Beside the stool, across the slope, looking down at its feet (#861): each foot on the grass.
  "hill-stool-side": (page) =>
    page.evaluate(async () => {
      const { lookoutAt } = await import(/* @vite-ignore */ "/src/garden/lookout.ts");
      const { stileAt } = await import(/* @vite-ignore */ "/src/garden/stile.ts");
      const s = (window as unknown as { __garden: Scene }).__garden;
      const hill = lookoutAt(stileAt(s.layout as Parameters<typeof stileAt>[0]));
      // Downhill from the top through the stool, and across it: stand 1.4 m to the side, facing the stool.
      const [dx, dz] = [hill.stool[0] - hill.top[0], hill.stool[1] - hill.top[1]];
      const d = Math.hypot(dx, dz);
      const [ax, az] = [-dz / d, dx / d];
      Object.assign(s, { x: hill.stool[0] + ax * 1.4, z: hill.stool[1] + az * 1.4, yaw: Math.atan2(ax, az), pitch: -0.45 });
    }),
  // Sat on the stool (#858): the far house ahead, your lantern in front of you on the left.
  "hill-seated": async (page) => {
    await standOnHill(page, "stool");
    await page.getByRole("button", { name: "Sit on the stool", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { __garden: { walker: { kind: string } } }).__garden.walker.kind === "seated");
    // Sitting down eases the eye down over 0.4 s (scene.ts SEAT.speed): wait it out in game time.
    const from = await page.evaluate(() => (window as unknown as { __garden: { elapsed: number } }).__garden.elapsed);
    await page.waitForFunction((from) => (window as unknown as { __garden: { elapsed: number } }).__garden.elapsed > from + 1.5, from);
  },
  // Up close to the details the thoughts name (#869): the cup rings on the bench's seat, from the pond's side, and
  // the letters on the sundial's pillar, from the garden's side.
  "cup-rings": (page) =>
    page.evaluate(() => {
      const s = (window as unknown as { __garden: Scene & { bench: { x: number; z: number } } }).__garden;
      Object.assign(s, { x: s.bench.x + 0.05, z: s.bench.z + 0.85, yaw: 0, pitch: -0.65 });
    }),
  "carved-letters": (page) =>
    page.evaluate(() => {
      const s = (window as unknown as { __garden: Scene & { bench: { x: number; z: number } } }).__garden;
      Object.assign(s, { x: s.bench.x - 1.05, z: s.bench.z - 0.75, yaw: Math.PI, pitch: -0.45 });
    }),
  // By the diary's stone, in reach of it (#858): the book, and its ribbon while a page is unread.
  "hill-stone": (page) => standOnHill(page, "stone"),
  // A tap on the bench (#864): its tag with a thought under it.
  thought: async (page) => {
    // Its parts all in first: the tag shows for ten seconds.
    await expect(page.locator(".gw-loading")).toHaveCount(0, { timeout: 30_000 });
    const at = await page.evaluate(async () => {
      const s = (window as unknown as { __garden: Scene & { bench: { x: number; z: number }; pickAny(x: number, y: number, w: number, h: number): { kind: string; s?: { view: { id: string } } } | null } }).__garden;
      Object.assign(s, { x: s.bench.x + 0.4, z: s.bench.z - 2.2, yaw: Math.PI, pitch: -0.25 });
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
      // A visitor may sit on it: look for a spot of the bench itself.
      for (let y = 0.4; y < 0.9; y += 0.02)
        for (let x = 0.3; x < 0.7; x += 0.02) {
          const hit = s.pickAny(r.width * x, r.height * y, r.width, r.height);
          if (hit?.kind === "scenery" && hit.s?.view.id === "bench") return [r.left + r.width * x, r.top + r.height * y] as [number, number];
        }
      throw new Error("no bench in view");
    });
    await page.mouse.click(...at);
    await expect(page.locator(".gw-thought")).toBeVisible();
  },
};

/** Stand by one of the lookout's things (#858) as a learner would: behind the stool or the stone (from the path), or on the post's far side from the stool. */
const standOnHill = (page: Page, by: "post" | "stool" | "stone") =>
  page.evaluate(async (by) => {
    const { lookoutAt } = await import(/* @vite-ignore */ "/src/garden/lookout.ts");
    const { stileAt } = await import(/* @vite-ignore */ "/src/garden/stile.ts");
    const s = (window as unknown as { __garden: Scene }).__garden;
    const hill = lookoutAt(stileAt(s.layout as Parameters<typeof stileAt>[0]));
    // Facing the far house from the stool, and its left.
    const [fx, fz] = [-Math.sin(hill.face), -Math.cos(hill.face)];
    const [lx, lz] = [fz, -fx];
    if (by === "post") Object.assign(s, { x: hill.post[0] + lx * 0.6, z: hill.post[1] + lz * 0.6, yaw: Math.atan2(lx, lz), pitch: -0.1 });
    else Object.assign(s, { x: hill[by][0] - fx * 0.7, z: hill[by][1] - fz * 0.7, yaw: hill.face, pitch: -0.2 });
  }, by);

/**
 * Spots seen by another learner: 500 words put the stile's notes at its foot, but not the hill's note (n08);
 * one who knows exactly 760 words (dev/boot.ts) has the diary's first page (n09), still unread; one who knows 1400 has the bench's last thought (#864).
 */
const WORDS: Partial<Record<string, number | `known:${number}`>> = { "stile-shut": 500, "hill-stone": "known:760", thought: "known:1400" };

/**
 * Open the walk for a demo learner far into the course: 800 words put notes on the shed's
 * nails (each needs 60 or more known words) and under the stile's step, and open the way
 * over the stile to the lookout (note n08, 620 known: not every demo word is known). The door is opened too.
 * A spot in WORDS opens for its own learner.
 */
async function openWalk(page: Page, words: number | `known:${number}`) {
  await page.goto(`/?demo=es:${words}#/today`);
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
        ["dusk", DUSK],
        ["night", NIGHT],
      ] as const)
        test(`${name} ${theme} ${time}`, async ({ page }, info) => {
          await page.clock.setFixedTime(at);
          // Normal detail, as most learners see it, whatever this machine's frame times.
          await pinDetail(page, "normal");
          // Every other spot opens the way over the stile.
          await openWalk(page, WORDS[name] ?? 800);
          await stand(page);
          // The walk builds its parts after it opens, with a progress line until they are all in.
          await expect(page.locator(".gw-loading")).toHaveCount(0, { timeout: 30_000 });
          await frames(page);
          await shoot(page, `${name}-${info.project.name}-${theme}-${time}`);
        });
  });
}
