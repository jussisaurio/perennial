// Screenshots of named screens for a UI change (#699), so each agent need not write its
// own spec: every screen on a phone and a desktop, light and dark, and each garden spot
// by day, at dusk and by night. From web/:
//
//   SHOTS_DIR=/abs/folder bun run shots -g "today|door"
//
// -g picks screens by name (leave it out for all). Each PNG is named
// <screen>-<phone|desktop>-<light|dark>[-<day|dusk|night>].png. To add a screen, add an
// entry to APP below or to SPOTS in spots.ts.

import { pinDetail, reveal, startSession } from "./helpers";
import { frames, openToday, openWalk, SPOTS, TIMES, WORDS } from "./spots";
import { expect, test, type Page } from "./test";

const DIR = process.env.SHOTS_DIR;
if (DIR === undefined) throw new Error("set SHOTS_DIR to the folder for the PNGs");

/** Screens of the app, each reached from a fresh demo learner with 30 words. */
const APP: Record<string, (page: Page) => Promise<void>> = {
  today: async (page) => {
    await openToday(page, "es:30");
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

const shoot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${name}.png` });

for (const theme of ["light", "dark"] as const) {
  test.describe(() => {
    test.use({ colorScheme: theme });

    for (const [name, go] of Object.entries(APP))
      test(`${name} ${theme}`, async ({ page }, info) => {
        await page.clock.setFixedTime(TIMES.day);
        await go(page);
        await shoot(page, `${name}-${info.project.name}-${theme}`);
      });

    for (const [name, stand] of Object.entries(SPOTS))
      for (const [time, at] of Object.entries(TIMES))
        test(`${name} ${theme} ${time}`, async ({ page }, info) => {
          await page.clock.setFixedTime(at);
          // Normal detail, as most learners see it, whatever this machine's frame times.
          await pinDetail(page, "normal");
          // A spot in WORDS opens for its own learner; every other one opens the way over the stile. The door is opened too.
          await openWalk(page, `es:${WORDS[name] ?? 800}`, "open");
          await stand(page);
          await frames(page);
          await shoot(page, `${name}-${info.project.name}-${theme}-${time}`);
        });
  });
}
