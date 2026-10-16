// Error reports (Sentry) and product analytics (PostHog). Both are off unless
// their keys are set at build time (VITE_SENTRY_DSN, VITE_POSTHOG_KEY), and
// analytics is privacy-first: no cookies, no autocapture, no session replay,
// Do Not Track respected, and only a few named events.

import * as Sentry from "@sentry/react";
import type { PostHog } from "posthog-js";
import { RELEASE } from "./version";

let posthog: PostHog | null = null;

export function initObservability() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (dsn) {
    Sentry.init({
      // Not the learner's IP: by default Sentry works it out from the connection.
      dataCollection: { userInfo: false },
      dsn,
      release: RELEASE,
      environment: import.meta.env.MODE,
      integrations: [
        Sentry.browserTracingIntegration(),
        // Replays only around errors, and blind: all text and inputs masked,
        // media blocked, so no words, names or emails are ever recorded.
        Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
        Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
      ],
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
      // Same-origin API only: never send trace headers to other services.
      tracePropagationTargets: [/^\//],
      // Long polls are cancelled by design; not errors.
      ignoreErrors: [/AbortError/, /The user aborted a request/],
    });
  }
}

// PostHog starts once the learner is known (identify), with their id as the
// distinct id: no cookies (memory persistence), and still one person per
// learner, not a new one each page load. Events before that wait in a queue.
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
// `||`, not `??`: the Docker build passes an unset host as "".
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://eu.i.posthog.com";
// Queued with the time they happened, so they keep it when they are sent.
let waiting: [Event, Record<string, unknown>, Date][] = [];
let started = false;

function startPostHog(userId: string) {
  // `started`, not `posthog`: a second identify() can come before the import resolves.
  if (!POSTHOG_KEY || started) return;
  started = true;
  import("posthog-js").then(({ default: ph }) => {
    ph.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      persistence: "memory",
      bootstrap: { distinctID: userId, isIdentifiedID: true },
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      // Off in code, whatever the PostHog project settings say: named events only,
      // no scripts loaded from PostHog (the CSP allows none), no flags or surveys.
      enable_heatmaps: false,
      capture_performance: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      disable_external_dependency_loading: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      respect_dnt: true,
      person_profiles: "identified_only",
    });
    // No location from the IP (PostHog's GeoIP): only the named events (privacy.html).
    ph.register({ $geoip_disable: true });
    posthog = ph;
    for (const [event, props, timestamp] of waiting) ph.capture(event, props, { timestamp });
    waiting = [];
  })
    // Analytics never breaks the app. A missing chunk after a deploy reloads the page (main.tsx).
    .catch(() => {});
}

/** The handful of product events we look at (see #16). */
export type Event =
  | "course_started"
  | "session_finished"
  | "email_added"
  | "garden_opened"
  | "words_added"
  | "seed_shared"
  | "seed_planted"
  | "page_shared"
  // The sign-in steps (#312), to see where people stop.
  | "signin_code_requested"
  | "signin_code_shown"
  | "signin_done";

export function track(event: Event, props: Record<string, unknown> = {}) {
  if (posthog) posthog.capture(event, props);
  // Few events come before identify (onboarding); 50 only bounds a queue that never starts.
  else if (POSTHOG_KEY && waiting.length < 50) waiting.push([event, props, new Date()]);
}

/** Tie events to the learner (an id only, never the email). A new user reloads the app (App.tsx). */
export function identify(userId: string) {
  startPostHog(userId);
  Sentry.setUser({ id: userId });
}

/**
 * An anonymous learner signed in to an account: the account's id becomes the
 * same PostHog person, so their story continues after the reload. (PostHog
 * keeps them apart if the account already has events of its own.)
 */
export function linkAccount(accountId: string) {
  posthog?.alias(accountId);
}

/**
 * A sign-in request has no answer yet (#312). A real exception, so Sentry also
 * sends the masked replay of the moments before. Ids and timings only: no email.
 * `protocol` is the connection's protocol (h3, h2), when the browser shows it.
 */
export function reportSlowAuth(step: "send" | "sign-in", path: string, ms: number, protocol: string | undefined) {
  Sentry.captureException(new Error(`auth request slow: ${step}`), { tags: { step, path, protocol }, extra: { ms } });
}

const badAnswerPaths = new Set<string>();

/**
 * Our server answered with a body that breaks the contract (data/http.ts): a
 * bug on one side, or a server newer than this app. The path and what did not
 * fit, never the body itself.
 */
export function reportBadAnswer(path: string, issue: string) {
  // Once per path per page load: a broken answer comes back on every request
  // (each write, each recheck), and one report says all there is to say.
  if (badAnswerPaths.has(path)) return;
  badAnswerPaths.add(path);
  Sentry.captureException(new Error(`bad answer: ${path}`), { tags: { path }, extra: { issue } });
}

export const reactErrorHandler = Sentry.reactErrorHandler;
