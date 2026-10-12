// All server configuration comes from the environment. Anything without a
// production value falls back to a safe local-development default.

import { fileURLToPath } from "node:url";

const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

const DEFAULT_SECRET = "dev-secret-change-me-dev-secret-change-me";

export interface Config {
  port: number;
  databaseUrl: string;
  /** The built web app (served by this process in production). */
  staticDir: string;
  /** Public URL of the web app: emails, auth callbacks, cookie origin. */
  appUrl: string;
  /** Signs sessions and cookies (Better Auth). */
  secret: string;
  /** NODE_ENV=production: strict checks, never dev mode. */
  production: boolean;
  /** Dev mode: sign-in codes go to an in-memory outbox (readable at /api/dev/outbox). Never in production. */
  dev: boolean;
  /** Build identifier (git sha) for logs and error reports. */
  release: string;
  /** Clients older than this get "please reload" instead of writing. */
  minClientVersion: string;

  electric: { url: string; secret?: string };
  anthropic: { apiKey?: string; baseURL?: string; model: string };
  mail: { resendKey?: string; from: string };
  /** Server reports go to sentryDsn. connect lists the origins the browser
   *  may send reports and analytics to (CSP connect-src). */
  observability: { sentryDsn?: string; connect: string[] };
  /** Bot check (Cloudflare Turnstile) on new anonymous users and sign-in codes. Off without a secret. */
  turnstile: { secretKey?: string; siteKey?: string };
  /** Headers that carry the client IP, set by our proxy (rate limits). The first usable one wins. */
  clientIpHeaders: string[];
  /** Sign-in codes per email address: per 15 minutes, and per day. */
  codesPerEmail: { short: number; day: number };

  /** AI words per learner per month. */
  freeCredits: number;
  /** Hard stop for AI spend across all users, per calendar month. */
  monthlyBudgetUsd: number;
  /** AI requests per user per minute (per instance). */
  aiRequestsPerMinute: number;
  /** Anonymous learners with no activity for this long are deleted. */
  anonymousRetentionDays: number;
}

/**
 * The deployed commit, or "dev". `||`: a build or host can pass an unset value as "".
 * The app uses the same rule (web/src/version.ts), so both name the same release.
 */
export const releaseOf = (env: Record<string, string | undefined>) => env.RAILWAY_GIT_COMMIT_SHA || env.RELEASE || "dev";

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env;
  const production = env.NODE_ENV === "production";
  // Fail closed: production is never dev mode, whatever else is (not) set.
  const dev = !production && (env.PERENNIAL_DEV === "1" || !env.RESEND_API_KEY);
  return {
    port: num(env.PORT, 8787),
    databaseUrl: env.DATABASE_URL ?? "postgres://perennial:perennial@localhost:25432/perennial",
    staticDir: env.PERENNIAL_STATIC ?? fileURLToPath(new URL("../../web/dist", import.meta.url)),
    appUrl: (env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),
    secret: env.BETTER_AUTH_SECRET ?? DEFAULT_SECRET,
    production,
    dev,
    release: releaseOf(env),
    minClientVersion: env.MIN_CLIENT_VERSION ?? "0.0.0",
    electric: { url: (env.ELECTRIC_URL ?? "http://localhost:30009").replace(/\/$/, ""), secret: env.ELECTRIC_SECRET },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
      baseURL: env.ANTHROPIC_BASE_URL,
      // Priced for per-user generation; change here to trade cost for quality.
      model: env.PERENNIAL_MODEL ?? "claude-haiku-4-5",
    },
    mail: { resendKey: env.RESEND_API_KEY, from: env.MAIL_FROM ?? "Perennial <hello@perennial.local>" },
    // The browser's keys are baked in at build time; Railway gives the same
    // variables to the build and the running server, so the CSP follows them.
    observability: {
      sentryDsn: env.SENTRY_DSN,
      connect: [env.VITE_SENTRY_DSN, env.VITE_POSTHOG_KEY ? env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com" : undefined, env.POSTHOG_HOST]
        .map(origin)
        .filter((o): o is string => !!o),
    },
    turnstile: { secretKey: env.TURNSTILE_SECRET_KEY, siteKey: env.VITE_TURNSTILE_SITE_KEY },
    // Railway's edge sets X-Real-IP to the connecting address. X-Forwarded-For
    // can carry client-made entries; Better Auth trusts it only with one value.
    clientIpHeaders: (env.CLIENT_IP_HEADERS ?? "x-real-ip,x-forwarded-for").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
    codesPerEmail: { short: num(env.CODES_PER_EMAIL_15MIN, 3), day: num(env.CODES_PER_EMAIL_DAY, 10) },
    freeCredits: num(env.FREE_CREDITS, 25),
    monthlyBudgetUsd: num(env.MONTHLY_BUDGET_USD, 200),
    aiRequestsPerMinute: num(env.AI_RPM, 20),
    anonymousRetentionDays: num(env.ANONYMOUS_RETENTION_DAYS, 60),
    ...overrides,
  };
}

/**
 * Production must be configured, not defaulted: refuse to start rather than
 * run with a public secret, an open dev outbox, or no email.
 */
export function configProblems(c: Config): string[] {
  if (!c.production) return [];
  const out: string[] = [];
  if (c.dev) out.push("dev mode is on in production");
  if (!c.secret || c.secret === DEFAULT_SECRET || c.secret.length < 32) out.push("BETTER_AUTH_SECRET must be set to a random value of at least 32 characters");
  if (!c.mail.resendKey) out.push("RESEND_API_KEY must be set (sign-in codes are sent by email)");
  if (!c.mail.from || c.mail.from.includes("perennial.local")) out.push("MAIL_FROM must be set to an address on your sending domain");
  if (!c.appUrl.startsWith("https://")) out.push("APP_URL must be the public https URL");
  if (c.databaseUrl.includes("@localhost:25432/")) out.push("DATABASE_URL must be set");
  if (!c.electric.secret) out.push("ELECTRIC_SECRET must be set (and match the Electric service)");
  if (!!c.turnstile.secretKey !== !!c.turnstile.siteKey) out.push("TURNSTILE_SECRET_KEY and VITE_TURNSTILE_SITE_KEY must be set together");
  return out;
}

/** USD per million tokens [input, output]. Used for the global spend breaker. */
export const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5": [1, 5],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5": [5, 25],
  "claude-opus-5-5": [4, 20],
};

/** The origin of a URL (a Sentry DSN's ingest host, a PostHog host), or undefined. */
function origin(url: string | undefined) {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
