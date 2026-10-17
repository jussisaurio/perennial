// The e2e `test`: Playwright's, with the browser's speech silenced in every page.
// --mute-audio does not reach speechSynthesis on macOS (it uses the system's
// voice), so local runs spoke every word aloud. Silenced on the prototype: a
// spec that checks speech sets its own recorder on the instance, which wins
// whatever order the init scripts run in (sound.spec.ts).

import { expect as baseExpect, test as base } from "@playwright/test";

export { expect, type Locator, type Page } from "@playwright/test";

// console.error messages seen on plain main that are not bugs. Keep this list short and
// specific: a broad pattern here would hide a real one (#375, found via a part that threw
// on every frame, caught and printed with console.error instead of raising a Playwright
// pageerror, so a spec's own `errors.toEqual([])` — listening only for pageerror — missed it).
const ALLOWED_CONSOLE_ERRORS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /NotFoundError: The object can not be found here/,
    reason: "WebKit's vite dev-server HMR noise on iPhone runs; seen on plain main, not caused by app code.",
  },
];

export const test = base.extend<{
  silentSpeech: void;
  // A spec that deliberately makes the page log a console.error calls this before it
  // happens, with why that one error is expected. Not for noise seen across many specs:
  // that goes in ALLOWED_CONSOLE_ERRORS above, with its own reason.
  allowConsoleError: (pattern: RegExp, reason: string) => void;
}>({
  silentSpeech: [
    async ({ context }, use) => {
      await context.addInitScript(() => {
        if ("SpeechSynthesis" in window) SpeechSynthesis.prototype.speak = () => {};
      });
      await use();
    },
    { auto: true },
  ],

  // Fails the test on any console.error the page logs that isn't expected.
  allowConsoleError: [
    async ({ page }, use) => {
      const expectedByThisTest: { pattern: RegExp; reason: string }[] = [];
      const unexpected: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (ALLOWED_CONSOLE_ERRORS.some((a) => a.pattern.test(text))) return;
        if (expectedByThisTest.some((a) => a.pattern.test(text))) return;
        unexpected.push(text);
      });
      await use((pattern, reason) => expectedByThisTest.push({ pattern, reason }));
      baseExpect(unexpected, "unexpected console.error: fix the bug, or call allowConsoleError with a reason if it's expected").toEqual([]);
    },
    { auto: true },
  ],
});
