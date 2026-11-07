import { defineConfig, devices } from "@playwright/test";

// Ports are offset from the dev defaults so the suite can run beside `bun dev`.
// E2E_PORT_OFFSET shifts them again, so two checkouts can run the suite at once.
// An agent worktree (.claude/worktrees/<name>) gets its own offset from its name,
// so parallel agents need not pick one; a clash fails at start, as no server is reused.
// Needs Postgres: `docker compose up -d` at the repo root.
const OFFSET = Number(process.env.E2E_PORT_OFFSET ?? worktreeOffset(process.cwd()));

/** 10–4000 in steps of 10 (each offset uses 3 consecutive ports), or 0 outside a worktree. */
function worktreeOffset(dir: string): number {
  const name = /\/\.claude\/worktrees\/([^/]+)/.exec(dir)?.[1];
  if (name === undefined) return 0;
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 10 * (1 + (h % 400));
}
const WEB = 5181 + OFFSET;
const API = 18787 + OFFSET;
const LLM = 18788 + OFFSET;
const SERVER_ENV = [`PORT=${API}`, "PERENNIAL_DEV=1", "LOG_LEVEL=warn", `APP_URL=http://localhost:${WEB}`, "ANTHROPIC_API_KEY=test", `ANTHROPIC_BASE_URL=http://localhost:${LLM}`, "FREE_CREDITS=6"].join(" ");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry on CI: software WebGL on shared runners can be slow to start.
  retries: process.env.CI ? 1 : 0,
  // Every test makes its own learner, so tests run in any order and at once.
  // GitHub's runners for public repos have 4 vCPUs, but they also run vite, the
  // API and Postgres: 4 workers saved ~0–13 s and brought a new
  // ECONNRESET on the shared server (#287), so 2 per runner (CI also shards the suite).
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${WEB}`,
    trace: "retain-on-failure",
    // The app honours reduced motion; tests shouldn't depend on animations.
    reducedMotion: "reduce",
    // Only the session screen speaks; keep tests deterministic and silent.
    launchOptions: { args: ["--mute-audio"] },
  },
  // Each project must also be in a CI matrix entry (.github/workflows/ci.yml), or CI skips it.
  projects: [
    // The cold dev server's first page load runs before the tests (#610). One per browser,
    // as each CI job installs only its own. They run as dependencies, so need no CI entry.
    { name: "warm", use: { ...devices["Desktop Chrome"] }, testMatch: /warm\.setup/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /layout\.spec|garden-touch\.spec/, dependencies: ["warm"] },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /layout\.spec/, dependencies: ["warm"] },
    // Touch on iOS (#113): WebKit, for the one spec about it, so CI time barely grows.
    // No --mute-audio: it is a Chromium flag, and WebKit on Linux will not start with it.
    { name: "warm-webkit", use: { ...devices["iPhone 15"], launchOptions: { args: [] } }, testMatch: /warm\.setup/ },
    { name: "iphone", use: { ...devices["iPhone 15"], launchOptions: { args: [] } }, testMatch: /garden-touch\.spec/, dependencies: ["warm-webkit"] },
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


