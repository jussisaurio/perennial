// The e2e `test`: Playwright's, with the browser's speech silenced in every page.
// --mute-audio does not reach speechSynthesis on macOS (it uses the system's
// voice), so local runs spoke every word aloud. Silenced on the prototype: a
// spec that checks speech sets its own recorder on the instance, which wins
// whatever order the init scripts run in (sound.spec.ts).

import { test as base } from "@playwright/test";

export { expect, type Locator, type Page } from "@playwright/test";

export const test = base.extend<{ silentSpeech: void }>({
  silentSpeech: [
    async ({ context }, use) => {
      await context.addInitScript(() => {
        if ("SpeechSynthesis" in window) SpeechSynthesis.prototype.speak = () => {};
      });
      await use();
    },
    { auto: true },
  ],
});
