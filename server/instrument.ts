// Error reporting and traces (Sentry). Preloaded before the app so it can
// instrument Bun.serve and fetch. Does nothing without SENTRY_DSN.

import * as Sentry from "@sentry/bun";

/**
 * Last line of defence before an event leaves: no cookies, auth headers,
 * request bodies (sign-in codes, emails) or user details, whatever the SDK
 * collected. dataCollection below already asks for none of these.
 */
export function scrub<E extends Sentry.Event>(event: E): E {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    const headers = event.request.headers;
    if (headers) for (const k of Object.keys(headers)) if (/cookie|authorization/i.test(k)) delete headers[k];
  }
  if (event.user) event.user = { id: event.user.id };
  return event;
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "development",
    release: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Shape requests are long polls by design; as traces they are noise.
    ignoreTransactions: [/\/api\/shape/],
    // SDK 11 replaced sendDefaultPii with this, and collects a lot by default.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { deny: ["cookie", "authorization"] }, response: { deny: ["set-cookie"] } },
      httpBodies: [],
      databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
    },
    beforeSend: scrub,
    beforeSendTransaction: scrub,
  });
}
