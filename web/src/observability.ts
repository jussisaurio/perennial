// Error reports (Sentry) and product analytics (PostHog). Both are off unless
// their keys are set at build time (VITE_SENTRY_DSN, VITE_POSTHOG_KEY), and
// analytics is privacy-first: no cookies, no autocapture, no session replay,
// Do Not Track respected, and only a few named events.

import * as Sentry from "@sentry/react";
import type { PostHog } from "posthog-js";
import { APP_VERSION } from "./version";

let posthog: PostHog | null = null;

export function initObservability() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (dsn) {
    Sentry.init({
      dsn,
      release: (import.meta.env.VITE_RELEASE as string | undefined) ?? APP_VERSION,
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
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (key) {
    void import("posthog-js").then(({ default: ph }) => {
      ph.init(key, {
        api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://eu.i.posthog.com",
        persistence: "memory",
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
        respect_dnt: true,
        person_profiles: "identified_only",
      });
      posthog = ph;
    });
  }
}

/** The handful of product events we look at (see #16). */
export type Event = "course_started" | "session_finished" | "email_added" | "garden_opened" | "words_added";

export function track(event: Event, props: Record<string, unknown> = {}) {
  posthog?.capture(event, props);
}

/** Tie events to the learner (an id only, never the email). */
export function identify(userId: string) {
  posthog?.identify(userId);
  Sentry.setUser({ id: userId });
}

export const reactErrorHandler = Sentry.reactErrorHandler;
