// All server configuration comes from the environment. Anything without a
// production value falls back to a safe local-development default.

import { fileURLToPath } from "node:url";

const env = process.env;
const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export interface Config {
  port: number;
  databaseUrl: string;
  /** The built web app (served by this process in production). */
  staticDir: string;
  /** Public URL of the web app: emails, auth callbacks, cookie origin. */
  appUrl: string;
  /** Signs sessions and cookies (Better Auth). */
  secret: string;
  /** Dev mode: sign-in codes go to an in-memory outbox (readable at /api/dev/outbox). */
  dev: boolean;
  /** Build identifier (git sha) for logs and error reports. */
  release: string;
  /** Clients older than this get "please reload" instead of writing. */
  minClientVersion: string;

  electric: { url: string; secret?: string };
  anthropic: { apiKey?: string; baseURL?: string; model: string };
  mail: { resendKey?: string; from: string };
  observability: { sentryDsn?: string; posthogHost?: string };

  /** AI words per learner per month. */
  freeCredits: number;
  /** Hard stop for AI spend across all users, per calendar month. */
  monthlyBudgetUsd: number;
  /** AI requests per user per minute (per instance). */
  aiRequestsPerMinute: number;
  /** Anonymous learners with no activity for this long are deleted. */
  anonymousRetentionDays: number;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dev = env.PERENNIAL_DEV === "1" || !env.RESEND_API_KEY;
  return {
    port: num(env.PORT, 8787),
    databaseUrl: env.DATABASE_URL ?? "postgres://perennial:perennial@localhost:55432/perennial",
    staticDir: env.PERENNIAL_STATIC ?? fileURLToPath(new URL("../../web/dist", import.meta.url)),
    appUrl: (env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),
    secret: env.BETTER_AUTH_SECRET ?? "dev-secret-change-me-dev-secret-change-me",
    dev,
    release: env.RAILWAY_GIT_COMMIT_SHA ?? env.RELEASE ?? "dev",
    minClientVersion: env.MIN_CLIENT_VERSION ?? "0.0.0",
    electric: { url: (env.ELECTRIC_URL ?? "http://localhost:30009").replace(/\/$/, ""), secret: env.ELECTRIC_SECRET },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
      baseURL: env.ANTHROPIC_BASE_URL,
      // Priced for per-user generation; change here to trade cost for quality.
      model: env.PERENNIAL_MODEL ?? "claude-haiku-4-5",
    },
    mail: { resendKey: env.RESEND_API_KEY, from: env.MAIL_FROM ?? "Perennial <hello@perennial.local>" },
    observability: { sentryDsn: env.SENTRY_DSN, posthogHost: env.POSTHOG_HOST },
    freeCredits: num(env.FREE_CREDITS, 25),
    monthlyBudgetUsd: num(env.MONTHLY_BUDGET_USD, 200),
    aiRequestsPerMinute: num(env.AI_RPM, 20),
    anonymousRetentionDays: num(env.ANONYMOUS_RETENTION_DAYS, 60),
    ...overrides,
  };
}

/** USD per million tokens [input, output]. Used for the global spend breaker. */
export const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5": [5, 25],
  "claude-opus-5-5": [4, 20],
};
