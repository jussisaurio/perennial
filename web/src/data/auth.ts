// Accounts (Better Auth). Learners start without an account: the first write
// ("Start learning") creates an anonymous user. Signing in with an email code
// from that session moves their progress into the account.

import { anonymousClient, emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { track } from "../observability";
import { captchaHeaders } from "./captcha";
import { adoptOnDevice, clearOutboxNow, forgetOnDevice, keepOnDevice } from "./device";

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

/** The current user, creating an anonymous one if there is none. */
export async function ensureUser(): Promise<SessionUser> {
  const s = await authClient.getSession();
  if (s.data?.user) return toUser(s.data.user);
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

export async function sendCode(email: string) {
  const r = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in", fetchOptions: { headers: await captchaHeaders() } });
  if (r.error) throw new AuthError(r.error.code ?? "send_failed", r.error.status === 429 ? "Too many codes. Wait a few minutes, then try again." : "Could not send the code. Check the email address.");
}

export async function signInWithCode(email: string, otp: string): Promise<SessionUser> {
  const before = (await authClient.getSession()).data?.user;
  const r = await authClient.signIn.emailOtp({ email, otp });
  if (r.error || !r.data) throw new AuthError(r.error?.code ?? "sign_in_failed", r.error?.status === 429 ? "Too many tries. Wait a few minutes." : "That code is not correct, or it has expired.");
  if (before?.isAnonymous) {
    track("email_added");
    // Their progress moves into the account on the server; their unsent writes follow here.
    adoptOnDevice(before.id, r.data.user.id);
  }
  return toUser(r.data.user);
}

/** Signs out, and forgets this user's data on this device (see device.ts). */
export async function signOut() {
  const userId = (await authClient.getSession()).data?.user?.id;
  if (userId) forgetOnDevice(userId);
  const r = await authClient.signOut().catch((e: unknown) => ({ error: e }));
  if (r.error) {
    // Still signed in: keep their data.
    if (userId) keepOnDevice(userId);
    console.warn("[auth] sign-out failed", r.error);
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
