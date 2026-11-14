// Every app screen, on a phone and a desktop, light and dark, has no mechanical UI fault
// (#977): see uiFaults.ts for the rules. `bun run shots` runs the same check on the
// screens it shoots; this spec keeps `main` clean when nobody took shots.

import { devices } from "@playwright/test";

import { SCREENS } from "./screens";
import { TIMES } from "./spots";
import { expect, test } from "./test";
import { uiFaults } from "./uiFaults";

// The devices of shots.config.ts. A describe block cannot change the browser, so the phone is its screen, not its engine.
const { defaultBrowserType: _, ...phone } = devices["Pixel 7"];
const VIEWS = { phone, desktop: { viewport: devices["Desktop Chrome"].viewport } };

for (const [view, device] of Object.entries(VIEWS))
  for (const theme of ["light", "dark"] as const)
    test.describe(() => {
      test.use({ ...device, colorScheme: theme });

      for (const [name, go] of Object.entries(SCREENS))
        test(`ui.no-faults: ${name}, ${view}, ${theme}`, async ({ page }) => {
          await page.clock.setFixedTime(TIMES.day);
          await go(page);
          const faults = await uiFaults(page, `${name} ${view} ${theme}`);
          // The message is the list: one line per fault.
          expect(faults.length, faults.join("\n")).toBe(0);
        });
    });

// A check that finds nothing is worth nothing: each rule must find a fault put there on purpose.
test("the check finds seeded faults, and not their meant twins", async ({ page }) => {
  await SCREENS.settings(page);
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.style.cssText = "position:relative;width:300px;height:400px";
    box.innerHTML = `
      <p id="cut" style="width:60px;overflow:hidden;white-space:nowrap;color:#000;background:#fff">Text that is cut off here</p>
      <p id="dots" style="width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#000;background:#fff">Text that ends in dots</p>
      <p id="scrolls" style="width:60px;overflow:auto;white-space:nowrap;color:#000;background:#fff">Text that scrolls sideways</p>
      <p id="spill" style="width:60px;white-space:nowrap;color:#000;background:#fff;border:1px solid #000">Text that spills out</p>
      <p id="faint" style="color:#bbb;background:#fff">Faint text</p>
      <button id="under" style="position:absolute;left:0;top:200px;width:100px;height:44px">Under</button>
      <button id="over" style="position:absolute;left:60px;top:220px;width:100px;height:44px">Over</button>
      <button id="wide" style="position:absolute;left:0;top:300px;width:3000px;height:44px">Too wide</button>
      <button id="tiny" aria-label="Tiny" style="position:absolute;left:0;top:360px;width:10px;height:10px;padding:0"></button>
      <button id="tiny2" aria-label="Tiny too" style="position:absolute;left:12px;top:360px;width:10px;height:10px;padding:0"></button>`;
    document.body.append(box);
  });
  const faults = await uiFaults(page, "seeded");
  const found = (rule: string, text: string) => faults.some((f) => f.includes(`| ${rule} |`) && f.includes(text));
  expect(found("text-cut", "Text that is cut off here"), faults.join("\n")).toBe(true);
  expect(found("text-overflows-box", "Text that spills out")).toBe(true);
  expect(found("controls-overlap", 'button "Under"')).toBe(true);
  expect(found("off-screen", 'button "Too wide"')).toBe(true);
  expect(found("page-scrolls-sideways", "html")).toBe(true);
  expect(found("axe target-size", "#tiny")).toBe(true);
  expect(found("axe color-contrast", "#faint")).toBe(true);
  // The text that scrolls is the cut text's meant twin, but a keyboard cannot scroll it: nothing in it takes focus.
  expect(found("axe scrollable-region-focusable", "#scrolls")).toBe(true);
  expect(faults.filter((f) => f.includes("ends in dots") || f.includes("scrolls sideways"))).toEqual([]);
});
