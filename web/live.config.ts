// The robot learner (#1024): the e2e setup (servers, ports, database, slot queue) with only
// e2e/live.run.ts. See e2e/live.ts for use.
import { defineConfig, devices } from "@playwright/test";

import e2e from "./playwright.config.ts";

export default defineConfig({
  ...e2e,
  testMatch: /live\.run\.ts$/,
  // A run is days of app use; each step waits with its own limit, so the run has none.
  timeout: 0,
  // A trace of a whole run would be gigabytes: the diary and the pictures say what happened.
  use: { ...e2e.use, trace: "off" },
  projects: [
    { name: "warm", use: { ...devices["Desktop Chrome"] }, testMatch: /warm\.setup/ },
    // The robot makes its own phone and desktop contexts (live.run.ts).
    { name: "live", dependencies: ["warm"] },
  ],
});
