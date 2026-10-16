import { describe, expect, mock, test } from "bun:test";

const calls: { init?: [string, Record<string, unknown>]; captured: [string, unknown, unknown][]; aliases: string[]; inits: number; registered: Record<string, unknown>[] } = { captured: [], aliases: [], inits: 0, registered: [] };
mock.module("posthog-js", () => ({
  default: {
    init: (key: string, config: Record<string, unknown>) => {
      calls.init = [key, config];
      calls.inits++;
    },
    capture: (event: string, props: unknown, options?: unknown) => void calls.captured.push([event, props, options]),
    alias: (id: string) => void calls.aliases.push(id),
    register: (props: Record<string, unknown>) => void calls.registered.push(props),
  },
}));
let sentryOptions: Record<string, unknown> | undefined;
const sentryErrors: string[] = [];
mock.module("@sentry/react", () => ({
  init: (options: Record<string, unknown>) => void (sentryOptions = options),
  browserTracingIntegration: () => ({}),
  replayIntegration: () => ({}),
  consoleLoggingIntegration: () => ({}),
  setUser: () => {},
  reactErrorHandler: () => {},
  // Bun's module mocks last for the whole test run, so every export the app calls
  // must be here, or a later file that reaches Sentry fails (send.test.ts).
  captureException: (e: Error) => void sentryErrors.push(e.message),
}));
// As the Docker build sets them: keys, and an unset host and release passed as "".
const env = { VITE_POSTHOG_KEY: "phc_test", VITE_POSTHOG_HOST: "", VITE_SENTRY_DSN: "https://key@sentry.test/1", VITE_RELEASE: "" };
const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
Object.assign(process.env, env);
const { identify, initObservability, linkAccount, reportBadAnswer, track } = await import("./observability");
initObservability();
for (const [k, v] of Object.entries(saved)) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

test("Sentry: a broken answer is reported once per path, never once per request", () => {
  for (let i = 0; i < 3; i++) reportBadAnswer("/api/write", "Expected number");
  reportBadAnswer("/api/server", "Expected boolean");
  expect(sentryErrors).toEqual(["bad answer: /api/write", "bad answer: /api/server"]);
});

test("Sentry: an unset release is named as the server names it, never empty", () => {
  expect(sentryOptions?.release).toBe("dev");
});

test("Sentry: the browser never asks Sentry to work out the learner's IP", () => {
  expect(sentryOptions?.dataCollection).toMatchObject({ userInfo: false });
});

describe("PostHog", () => {
  test("starts at identify, as that learner, on the EU host; earlier events wait and then go", async () => {
    track("course_started", { lang: "es" });
    const happened = Date.now();
    expect(calls.init).toBeUndefined();
    identify("user-1");
    identify("user-1"); // StrictMode runs the effect twice: one start
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.inits).toBe(1);
    expect(calls.registered).toContainEqual({ $geoip_disable: true }); // no location from the IP
    const [key, config] = calls.init!;
    expect(key).toBe("phc_test");
    expect(config).toMatchObject({
      api_host: "https://eu.i.posthog.com",
      persistence: "memory",
      bootstrap: { distinctID: "user-1", isIdentifiedID: true },
      autocapture: false,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
    });
    // Sent once, with the time it happened, not the time it was sent.
    expect(calls.captured).toHaveLength(1);
    const [event, props, options] = calls.captured[0] as [string, unknown, { timestamp: Date }];
    expect([event, props]).toEqual(["course_started", { lang: "es" }]);
    expect(Math.abs(options.timestamp.getTime() - happened)).toBeLessThan(50);
    track("garden_opened");
    expect(calls.captured.at(-1)?.slice(0, 2)).toEqual(["garden_opened", {}]);
  });

  test("an anonymous learner who adds an email stays one person: the account id is an alias", () => {
    linkAccount("account-1");
    expect(calls.aliases).toEqual(["account-1"]);
  });
});
