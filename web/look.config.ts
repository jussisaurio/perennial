// The look tool (#974): the screenshot setup (shots.config.ts: the e2e servers, a phone and
// a desktop) with only e2e/look.run.ts. See e2e/look.ts for use.
import { defineConfig } from "@playwright/test";

import shots from "./shots.config.ts";

export default defineConfig({
  ...shots,
  testMatch: /look\.run\.ts$/,
  // One run is one script; a long walk takes more than the default 30 s.
  timeout: 5 * 60_000,
  // Motion as most learners have it: the e2e suite turns it off, which makes a walk to a plant one jump.
  use: { ...shots.use, reducedMotion: "no-preference" },
});
