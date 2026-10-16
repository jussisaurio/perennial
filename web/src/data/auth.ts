// Accounts (Better Auth). Learners start without an account: the first write
// ("Start learning") creates an anonymous user. Signing in with an email code
// from that session moves their progress into the account.

import { anonymousClient, emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { Clock, Effect, Fiber, Schema } from "effect";
import { UserId } from "perennial-contract";
import { linkAccount, reportSlowAuth, track } from "../observability";
import { captchaHeaders } from "./captcha";
import { adoptOnDevice, clearOutboxNow, forgetOnDevice, keepOnDevice, stopSyncNow } from "./device";

export const authClient = createAuthClient({ plugins: [emailOTPClient(), anonymousClient()] });

export interface SessionUser {
  id: UserId;
  email: string | null;
  anonymous: boolean;
}

/** What the app reads of Better Auth's session user. */
const AuthUser = Schema.Struct({ id: UserId, email: Schema.String, isAnonymous: Schema.optional(Schema.NullOr(Schema.Boolean)) });

// A session user without these is a bug in Better Auth's answer: it throws, loudly.
const decodeUser = Schema.decodeUnknownSync(AuthUser);

const toUser = (raw: unknown): SessionUser => {
  const u = decodeUser(raw);
  return { id: u.id, email: u.isAnonymous ? null : u.email, anonymous: u.isAnonymous === true };
};

/** The signed-in user (anonymous or not), or null. Re-renders on sign-in/out. */
// Pending means the first session check, nothing later. Better Auth checks the
// session again whenever the tab comes back, and while it does, it reports
// isPending if there is no session yet (signed out, or waiting for a sign-in
// code). App shows a loading screen while pending, which would wipe the page.
let sessionKnown = false;

export function useUser(): { user: SessionUser | null; pending: boolean } {
  const { data, isPending } = authClient.useSession();
  if (!isPending) sessionKnown = true;
  return { user: data?.user ? toUser(data.user) : null, pending: isPending && !sessionKnown };
}

/** The auth client's session store: no session (null) until it knows of one. */
const SessionAtom = Schema.Struct({ data: Schema.NullOr(Schema.Struct({ user: Schema.Struct({ id: UserId }) })) });
const decodeSessionAtom = Schema.decodeUnknownSync(SessionAtom);

/** The signed-in user's id as the auth client last saw it (no request), or null. */
export function sessionUserId(): UserId | null {
  return decodeSessionAtom(authClient.$store.atoms.session?.get()).data?.user.id ?? null;
}

/** The signed-in user (asks the server), or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const s = await authClient.getSession();
  return s.data?.user ? toUser(s.data.user) : null;
}

/** The current user, creating an anonymous one if there is none. */
export async function ensureUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (user) return user;
  const r = await authClient.signIn.anonymous({ fetchOptions: { headers: await captchaHeaders() } });
  if (r.error || !r.data) throw new Error(r.error?.message ?? "Could not start a session");
  return toUser(r.data.user);
}

/** A refusal the learner can act on: `message` says what to do. */
export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", { code: Schema.String, message: Schema.String }) {}

// A request can hang with no answer and no error: seen on iPhones, likely
// HTTP/3 through Cloudflare (#312). The server answers in under a second, so
// after 20 s we stop waiting: a hung request must not leave the form stuck.
const AUTH_TIMEOUT = "20 seconds";
// Halfway there, Sentry gets one report, so we learn how often this happens.
const SLOW_REPORT = "10 seconds";

/**
 * A Better Auth request with a deadline: it fails with TimeoutError, and its
 * signal aborts the fetch. Effect's clock and timers, so tests can move time.
 */
const timed = <A>(step: "send" | "sign-in", path: string, send: (signal: AbortSignal) => Promise<A>) =>
  Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    const slow = yield* Effect.sleep(SLOW_REPORT).pipe(
      Effect.andThen(Clock.currentTimeMillis),
      Effect.map((now) => reportSlowAuth(step, path, now - started, protocolOf(path))),
      Effect.forkChild({ startImmediately: true }),
    );
    // A failed request (not a refusal: the client has no catchAllError) rejects; the screens say "try again".
    return yield* Effect.tryPromise(send).pipe(Effect.timeout(AUTH_TIMEOUT), Effect.ensuring(Fiber.interrupt(slow)));
  });

/**
 * The protocol (h3, h2) of the last finished request to `path`, or else to any
 * auth path: a hung request has no timing entry until it ends, and the earlier
 * requests show which connection it is likely stuck on. Undefined when the
 * browser has no entry.
 */
function protocolOf(path: string): string | undefined {
  const auth = performance.getEntriesByType("resource").filter((e): e is PerformanceResourceTiming => e instanceof PerformanceResourceTiming && e.name.includes("/api/auth/"));
  const entry = auth.findLast((e) => e.name.includes(path)) ?? auth.at(-1);
  // `||`: the browser gives "" when it does not know the protocol.
  return entry?.nextHopProtocol || undefined;
}

/**
 * Sends a sign-in code. "maybe-sent" means no answer came in time: the code
 * may still arrive, so the learner can enter it or ask again.
 */
export const sendCode = (email: string): Promise<"sent" | "maybe-sent"> =>
  Effect.runPromise(
    Effect.gen(function* () {
      track("signin_code_requested");
      // The bot check failing rejects; the screens say "try again".
      const headers = yield* Effect.tryPromise(captchaHeaders);
      return yield* timed("send", "/email-otp/send-verification-otp", (signal) => authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in", fetchOptions: { headers, signal } })).pipe(
        Effect.flatMap((r) =>
          r.error
            ? Effect.fail(new AuthError({ code: r.error.code ?? "send_failed", message: r.error.status === 429 ? "Too many codes. Wait a few minutes, then try again." : "Could not send the code. Check the email address." }))
            : Effect.succeed("sent" as const),
        ),
        Effect.catchTag("TimeoutError", () => Effect.succeed("maybe-sent" as const)),
      );
    }),
  );

const tooLong = () => new AuthError({ code: "timeout", message: "Signing in took too long. Check your internet connection, then try again. If the code does not work, send the code again." });

/** The session's user, as the server says now. No answer in time is tooLong. */
const askSession = timed("sign-in", "/get-session", (signal) => authClient.getSession({ fetchOptions: { signal } })).pipe(
  Effect.map((s) => (s.data?.user ? toUser(s.data.user) : null)),
  Effect.catchTag("TimeoutError", () => Effect.fail(tooLong())),
);

/** The user the session now has, if it is the account for `email`; else an AuthError. */
const signedInAs = (email: string) =>
  askSession.pipe(Effect.flatMap((u) => (u && !u.anonymous && u.email?.toLowerCase() === email.toLowerCase() ? Effect.succeed(u) : Effect.fail(tooLong()))));

export const signInWithCode = (email: string, otp: string): Promise<SessionUser> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Clock.currentTimeMillis;
      // Nothing was sent yet, so there is nothing to recover.
      const before = yield* askSession;
      const { user, timedOut } = yield* timed("sign-in", "/sign-in/email-otp", (signal) => authClient.signIn.emailOtp({ email, otp, fetchOptions: { signal } })).pipe(
        Effect.flatMap((r) =>
          r.error || !r.data
            ? Effect.fail(new AuthError({ code: r.error?.code ?? "sign_in_failed", message: r.error?.status === 429 ? "Too many tries. Wait a few minutes." : "That code is not correct, or it has expired." }))
            : Effect.succeed({ user: toUser(r.data.user), timedOut: false }),
        ),
        // The server may have signed us in and only the answer was lost: ask it.
        Effect.catchTag("TimeoutError", () => signedInAs(email).pipe(Effect.map((user) => ({ user, timedOut: true })))),
      );
      if (before?.anonymous) {
        track("email_added");
        linkAccount(user.id);
        // Their progress moves into the account on the server; their unsent writes follow here.
        adoptOnDevice(before.id, user.id);
      }
      track("signin_done", { ms: (yield* Clock.currentTimeMillis) - started, timedOut });
      // The lost answer would have told the app the user changed. Reload as the
      // account now (after the adoption above): a session refetch could hang too.
      if (timedOut) location.reload();
      return user;
    }),
  );

/** Signs out, and forgets this user's data on this device (see device.ts). */
export async function signOut() {
  const userId = (await authClient.getSession()).data?.user?.id;
  let stopped = false;
  if (userId) {
    forgetOnDevice(userId);
    // Stop syncing first: a table still loading would get a 401 once the session ends.
    stopped = stopSyncNow(userId);
  }
  const r = await authClient.signOut().catch((e: unknown) => ({ error: e }));
  if (r.error) {
    // Still signed in: keep their data, and reload so a stopped sync starts again.
    if (userId) keepOnDevice(userId);
    console.warn("[auth] sign-out failed", r.error);
    if (stopped) location.reload();
    return;
  }
  // Nothing more uploads for them from this tab.
  if (userId) await clearOutboxNow(userId);
}

/** Deletes the account on the server and signs out. `lang` picks the goodbye's language. */
export async function deleteAccount(lang?: string) {
  const userId = (await authClient.getSession()).data?.user?.id;
  const res = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (!res.ok) throw new Error(`Could not delete the account (${res.status})`);
  try {
    // One goodbye on the landing page (see Onboarding).
    sessionStorage.setItem("perennial-farewell", JSON.stringify({ lang: lang ?? null, at: Date.now() }));
  } catch {
    // No storage: no goodbye line. Fine.
  }
  // The account is gone: forget its data here, even if signing out fails.
  if (userId) forgetOnDevice(userId);
  await authClient.signOut().catch(() => {});
  if (userId) await clearOutboxNow(userId);
}
