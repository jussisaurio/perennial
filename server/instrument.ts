// Error reporting and traces (Sentry). Preloaded before the app so it can
// instrument Bun.serve and fetch. Does nothing without SENTRY_DSN.

import * as Sentry from "@sentry/bun";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "development",
    release: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Shape requests are long polls by design; as traces they are noise.
    ignoreTransactions: [/\/api\/shape/],
  });
}
