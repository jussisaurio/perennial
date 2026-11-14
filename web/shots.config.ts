// Screenshots for a UI change (#699): the e2e setup (servers, ports, database, slot
// queue) with only e2e/shots.ts, on a phone and a desktop. See e2e/shots.ts for use.
import { defineConfig, devices } from "@playwright/test";

import e2e from "./playwright.config.ts";

// Playwright matches -g against "<project> <file> <title>", so a pattern that starts with ^ finds no
// screen, and the run only says "No tests found" (#656). Say why instead.
const argv = process.argv;
const grep = argv.flatMap((a, i) => (a === "-g" || a === "--grep" ? [argv[i + 1]] : a.startsWith("--grep=") ? [a.slice(7)] : []));
if (grep.some((g) => g?.startsWith("^"))) throw new Error(`-g ${grep.join(" ")}: Playwright matches -g against "<project> <file> <title>", so ^ never matches. Leave out the ^: -g "today|door"`);

export default defineConfig({
  ...e2e,
  testMatch: /shots\.ts$/,
  projects: [
    { name: "warm", use: { ...devices["Desktop Chrome"] }, testMatch: /warm\.setup/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, dependencies: ["warm"] },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, dependencies: ["warm"] },
  ],
});
