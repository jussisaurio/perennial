// Screenshots of named screens for a UI change (#699), so each agent need not write its
// own spec: every screen on a phone and a desktop, light and dark, and each garden spot
// by day, at dusk and by night. From web/:
//
//   SHOTS_DIR=/abs/folder bun run shots -g "today|door"
//
// -g picks screens by name (leave it out for all). Each PNG is named
// <screen>-<phone|desktop>-<light|dark>[-<day|dusk|night>].png. To add a screen, add an
// entry to SCREENS in screens.ts or to SPOTS in spots.ts.
//
// Each app screen is also checked for mechanical UI faults (uiFaults.ts): the run prints
// one line per fault and fails, after the PNG is written.

import { pinDetail } from "./helpers";
import { SCREENS } from "./screens";
import { frames, openWalk, plantsIn, SPOTS, TIMES, walkReady, WORDS } from "./spots";
import { expect, test, type Page } from "./test";
import { uiFaults } from "./uiFaults";

const DIR = process.env.SHOTS_DIR;
if (DIR === undefined) throw new Error("set SHOTS_DIR to the folder for the PNGs");

const shoot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${name}.png` });

for (const theme of ["light", "dark"] as const) {
  test.describe(() => {
    test.use({ colorScheme: theme });

    for (const [name, go] of Object.entries(SCREENS))
      test(`${name} ${theme}`, async ({ page }, info) => {
        await page.clock.setFixedTime(TIMES.day);
        await go(page);
        await shoot(page, `${name}-${info.project.name}-${theme}`);
        const faults = await uiFaults(page, `${name} ${info.project.name} ${theme}`);
        // The message is the list: one line per fault.
        expect(faults.length, faults.join("\n")).toBe(0);
      });

    for (const [name, stand] of Object.entries(SPOTS))
      for (const [time, at] of Object.entries(TIMES))
        test(`${name} ${theme} ${time}`, async ({ page }, info) => {
          await page.clock.setFixedTime(at);
          // Normal detail, as most learners see it, whatever this machine's frame times.
          await pinDetail(page, "normal");
          // A spot in WORDS opens for its own learner; every other one opens the way over the stile. The door is opened too.
          await openWalk(page, `es:${WORDS[name] ?? 800}`, "open");
          await walkReady(page);
          await stand(page);
          await plantsIn(page);
          await frames(page);
          await shoot(page, `${name}-${info.project.name}-${theme}-${time}`);
        });
  });
}
