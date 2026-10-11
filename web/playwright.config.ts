import { defineConfig, devices } from "@playwright/test";

// Ports are offset from the dev defaults so the suite can run beside `bun dev`.
// Needs Postgres + Electric: `docker compose up -d` at the repo root.
const WEB = 5181;
const API = 18787;
const LLM = 18788;
const SERVER_ENV = [`PORT=${API}`, "PERENNIAL_DEV=1", "LOG_LEVEL=warn", `APP_URL=http://localhost:${WEB}`, "ANTHROPIC_API_KEY=test", `ANTHROPIC_BASE_URL=http://localhost:${LLM}`, "FREE_CREDITS=6"].join(" ");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry on CI: software WebGL on shared runners can be slow to start.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${WEB}`,
    trace: "retain-on-failure",
    // The app honours reduced motion; tests shouldn't depend on animations.
    reducedMotion: "reduce",
    // Only the session screen speaks; keep tests deterministic and silent.
    launchOptions: { args: ["--mute-audio"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /layout\.spec/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /layout\.spec/ },
  ],
  webServer: [
    { command: `PORT=${LLM} bun ../server/mock-llm.ts`, port: LLM, reuseExistingServer: false },
    {
      command: `${SERVER_ENV} bun ../server/src/migrate.ts && ${SERVER_ENV} bun ../server/index.ts`,
      port: API,
      reuseExistingServer: false,
    },
    { command: `SYNC_PORT=${API} bunx vite --port ${WEB} --strictPort`, port: WEB, reuseExistingServer: false },
  ],
});


