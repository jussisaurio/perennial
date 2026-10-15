// Accounts (Better Auth). Learners start without an account: the first write
// ("Start learning") creates an anonymous user. Signing in with an email code
// from that session moves their progress into the account.

import { anonymousClient, emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { linkAccount, reportSlowAuth, track } from "../observability";
import { captchaHeaders } from "./captcha";
import { adoptOnDevice, clearOutboxNow, forgetOnDevice, keepOnDevice, stopSyncNow } from "./device";

export const authClient = createAuthClient({ plugins: [emailOTPClient(), anonymousClient()] });

export interface SessionUser {
  id: string;
  email: string | null;
  anonymous: boolean;
}

const toUser = (u: { id: string; email: string; isAnonymous?: boolean | null }): SessionUser => ({ id: u.id, email: u.isAnonymous ? null : u.email, anonymous: !!u.isAnonymous });

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

/** The signed-in user's id as the auth client last saw it (no request), or null. */
export function sessionUserId(): string | null {
  const atom = (authClient.$store.atoms as Record<string, { get(): unknown } | undefined>).session;
  const s = atom?.get() as { data?: { user?: { id?: string } } | null } | undefined;
  return s?.data?.user?.id ?? null;
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

export class AuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// A request can hang with no answer and no error: seen on iPhones, likely
// HTTP/3 through Cloudflare (#312). The server answers in under a second, so
// after 20 s we stop waiting: a hung request must not leave the form stuck.
const AUTH_TIMEOUT_MS = 20_000;
// Halfway there, Sentry gets one report, so we learn how often this happens.
const SLOW_REPORT_MS = 10_000;

/** No answer within AUTH_TIMEOUT_MS. */
class TimedOut extends Error {}

/**
 * Runs Better Auth requests with a deadline. `fn` passes `signal` to each
 * request it makes. Uses setTimeout, not AbortSignal.timeout, so tests can
 * move the clock.
 */
async function withTimeout<T>(step: "send" | "sign-in", path: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const started = performance.now();
  const slow = setTimeout(() => reportSlowAuth(step, path, Math.round(performance.now() - started), protocolOf(path)), SLOW_REPORT_MS);
  const deadline = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    // An abort always throws here (the client has no catchAllError), never comes back as `error`.
    return await fn(controller.signal);
  } catch (e) {
    if (controller.signal.aborted) throw new TimedOut();
    throw e;
  } finally {
    clearTimeout(slow);
    clearTimeout(deadline);
  }
}

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
export async function sendCode(email: string): Promise<"sent" | "maybe-sent"> {
  track("signin_code_requested");
  const headers = await captchaHeaders();
  try {
    const r = await withTimeout("send", "/email-otp/send-verification-otp", (signal) => authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in", fetchOptions: { headers, signal } }));
    if (r.error) throw new AuthError(r.error.code ?? "send_failed", r.error.status === 429 ? "Too many codes. Wait a few minutes, then try again." : "Could not send the code. Check the email address.");
    return "sent";
  } catch (e) {
    if (e instanceof TimedOut) return "maybe-sent";
    throw e;
  }
}

const tooLong = () => new AuthError("timeout", "Signing in took too long. Check your internet connection, then try again. If the code does not work, send the code again.");

/** The user the session now has, if it is the account for `email`; else an AuthError. */
async function signedInAs(email: string): Promise<SessionUser> {
  let s;
  try {
    s = await withTimeout("sign-in", "/get-session", (signal) => authClient.getSession({ fetchOptions: { signal } }));
  } catch (e) {
    if (e instanceof TimedOut) throw tooLong();
    throw e;
  }
  const u = s.data?.user;
  if (u && !u.isAnonymous && u.email.toLowerCase() === email.toLowerCase()) return toUser(u);
  throw tooLong();
}

export async function signInWithCode(email: string, otp: string): Promise<SessionUser> {
  const started = performance.now();
  let before;
  try {
    before = (await withTimeout("sign-in", "/get-session", (signal) => authClient.getSession({ fetchOptions: { signal } }))).data?.user;
  } catch (e) {
    // Nothing was sent yet, so there is nothing to recover.
    if (e instanceof TimedOut) throw tooLong();
    throw e;
  }
  let user: SessionUser;
  let timedOut = false;
  try {
    const r = await withTimeout("sign-in", "/sign-in/email-otp", (signal) => authClient.signIn.emailOtp({ email, otp, fetchOptions: { signal } }));
    if (r.error || !r.data) throw new AuthError(r.error?.code ?? "sign_in_failed", r.error?.status === 429 ? "Too many tries. Wait a few minutes." : "That code is not correct, or it has expired.");
    user = toUser(r.data.user);
  } catch (e) {
    if (!(e instanceof TimedOut)) throw e;
    // The server may have signed us in and only the answer was lost: ask it.
    user = await signedInAs(email);
    timedOut = true;
  }
  if (before?.isAnonymous) {
    track("email_added");
    linkAccount(user.id);
    // Their progress moves into the account on the server; their unsent writes follow here.
    adoptOnDevice(before.id, user.id);
  }
  track("signin_done", { ms: Math.round(performance.now() - started), timedOut });
  // The lost answer would have told the app the user changed. Reload as the
  // account now (after the adoption above): a session refetch could hang too.
  if (timedOut) location.reload();
  return user;
}

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
