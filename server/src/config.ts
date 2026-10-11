// All server configuration comes from the environment. Anything without a
// production value falls back to a safe local-development default.

import { join } from "node:path";

const env = process.env;
const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export interface Config {
  port: number;
  dbPath: string;
  staticDir: string;
  /** Public URL of the web app, used in emails and Stripe redirects. */
  appUrl: string;
  /** Secret used to hash login codes and sessions. */
  secret: string;
  /** Dev mode: login codes go to an in-memory outbox (readable at /api/dev/outbox). */
  dev: boolean;

  anthropic: { apiKey?: string; baseURL?: string; model: string };
  stripe: { secretKey?: string; webhookSecret?: string; priceMonthly?: string; priceYearly?: string; host?: string; port?: number; protocol?: "http" | "https"; labelMonthly?: string; labelYearly?: string };
  mail: { resendKey?: string; from: string };

  plans: Record<Plan, { credits: number }>;
  /** Hard stop for AI spend across all users, per calendar month. */
  monthlyBudgetUsd: number;
  /** New (uncached) shared course batches one user may trigger per day. */
  courseBatchesPerUserPerDay: number;
  /** AI requests per user per minute. */
  aiRequestsPerMinute: number;
}

export type Plan = "free" | "pro";

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dev = env.PERENNIAL_DEV === "1" || !env.RESEND_API_KEY;
  return {
    port: num(env.PORT, 8787),
    dbPath: env.PERENNIAL_DB ?? join(import.meta.dir, "../perennial.db"),
    staticDir: env.PERENNIAL_STATIC ?? join(import.meta.dir, "../../web/dist"),
    appUrl: (env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),
    secret: env.PERENNIAL_SECRET ?? "dev-secret-change-me",
    dev,
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
      baseURL: env.ANTHROPIC_BASE_URL,
      // Priced for per-user generation; change here to trade cost for quality.
      model: env.PERENNIAL_MODEL ?? "claude-haiku-4-5",
    },
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      priceMonthly: env.STRIPE_PRICE_MONTHLY,
      priceYearly: env.STRIPE_PRICE_YEARLY,
      host: env.STRIPE_HOST,
      port: env.STRIPE_PORT ? Number(env.STRIPE_PORT) : undefined,
      protocol: env.STRIPE_PROTOCOL as "http" | "https" | undefined,
      labelMonthly: env.PRICE_LABEL_MONTHLY ?? "$6 / month",
      labelYearly: env.PRICE_LABEL_YEARLY ?? "$48 / year",
    },
    mail: { resendKey: env.RESEND_API_KEY, from: env.MAIL_FROM ?? "Perennial <hello@perennial.local>" },
    plans: { free: { credits: num(env.FREE_CREDITS, 25) }, pro: { credits: num(env.PRO_CREDITS, 2000) } },
    monthlyBudgetUsd: num(env.MONTHLY_BUDGET_USD, 200),
    courseBatchesPerUserPerDay: num(env.COURSE_BATCHES_PER_DAY, 20),
    aiRequestsPerMinute: num(env.AI_RPM, 20),
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
