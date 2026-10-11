import { defineConfig, devices } from "@playwright/test";

// Ports are offset from the dev defaults so the suite can run beside `bun dev`.
const WEB = 5181;
const SYNC = 18787;
const LLM = 18788;
const STRIPE = 12199;
export const WEBHOOK_SECRET = "whsec_e2e";

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
    // Stripe's official API mock, so the real Stripe SDK runs end to end.
    { command: `docker run --rm -p ${STRIPE}:12111 stripe/stripe-mock:latest`, port: STRIPE, reuseExistingServer: true },
    {
      command: [
        `PORT=${SYNC}`,
        `PERENNIAL_DB=/tmp/perennial-e2e-${Date.now()}.db`,
        "PERENNIAL_DEV=1",
        `APP_URL=http://localhost:${WEB}`,
        "ANTHROPIC_API_KEY=test",
        `ANTHROPIC_BASE_URL=http://localhost:${LLM}`,
        "FREE_CREDITS=6",
        "STRIPE_SECRET_KEY=sk_test_e2e",
        `STRIPE_WEBHOOK_SECRET=${WEBHOOK_SECRET}`,
        "STRIPE_PRICE_MONTHLY=price_monthly",
        "STRIPE_PRICE_YEARLY=price_yearly",
        "STRIPE_HOST=localhost",
        `STRIPE_PORT=${STRIPE}`,
        "STRIPE_PROTOCOL=http",
        "bun ../server/index.ts",
      ].join(" "),
      port: SYNC,
      reuseExistingServer: false,
    },
    { command: `SYNC_PORT=${SYNC} bunx vite --port ${WEB} --strictPort`, port: WEB, reuseExistingServer: false },
  ],
});

export const MOCK_LLM_URL = `http://localhost:${LLM}/v1`;
