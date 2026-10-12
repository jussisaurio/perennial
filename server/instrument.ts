// Error reporting and traces (Sentry). Preloaded before the app so it can
// instrument Bun.serve and fetch. Does nothing without SENTRY_DSN.

import * as Sentry from "@sentry/bun";
import { releaseOf } from "./src/config";

/**
 * Last line of defence before an event leaves: no cookies, auth headers,
 * request bodies (sign-in codes, emails) or user details, whatever the SDK
 * collected. dataCollection below already asks for none of these.
 */
/**
 * Request headers Sentry never gets: sessions, and who and where the learner is (their IP
 * from any proxy, their browser). Matched as substrings, like Sentry's own deny list.
 */
const PRIVATE_HEADERS = ["cookie", "authorization", "x-real-ip", "forwarded", "cf-connecting-ip", "true-client-ip", "x-perennial-client-ip", "user-agent", "sec-ch-ua"];
const isPrivateHeader = (name: string) => PRIVATE_HEADERS.some((p) => name.toLowerCase().includes(p));

export function scrub<E extends Sentry.Event>(event: E): E {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    const headers = event.request.headers;
    if (headers) for (const k of Object.keys(headers)) if (isPrivateHeader(k)) delete headers[k];
  }
  if (event.user) event.user = { id: event.user.id };
  return event;
}

/** What Sentry is told from the environment. `||`: a host can pass an unset value as "". */
export function sentrySettings(env: Record<string, string | undefined>) {
  return {
    environment: env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || "development",
    release: releaseOf(env),
    tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
  };
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    ...sentrySettings(process.env),
    // SDK 11 streams spans by default, and then skips beforeSendTransaction and
    // ignoreTransactions below (our scrub and the shape filter). Keep whole transactions.
    traceLifecycle: "static",
    // Shape requests are long polls by design; as traces they are noise.
    ignoreTransactions: [/\/api\/shape/],
    // SDK 11 replaced sendDefaultPii with this, and collects a lot by default.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: PRIVATE_HEADERS },
        response: { deny: ["set-cookie"] },
      },
      httpBodies: [],
      databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
    },
    beforeSend: scrub,
    beforeSendTransaction: scrub,
  });
}
