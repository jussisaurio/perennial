// Screenshots for a UI change (#699): the e2e setup (servers, ports, database, slot
// queue) with only e2e/shots.ts, on a phone and a desktop. See e2e/shots.ts for use.
import { defineConfig, devices } from "@playwright/test";

import e2e from "./playwright.config.ts";

export default defineConfig({
  ...e2e,
  testMatch: /shots\.ts$/,
  projects: [
    { name: "warm", use: { ...devices["Desktop Chrome"] }, testMatch: /warm\.setup/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, dependencies: ["warm"] },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, dependencies: ["warm"] },
  ],
});
