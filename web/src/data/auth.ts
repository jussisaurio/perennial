// Accounts (Better Auth). Learners start without an account: the first write
// ("Start learning") creates an anonymous user. Signing in with an email code
// from that session moves their progress into the account.

import { anonymousClient, emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { track } from "../observability";

export const authClient = createAuthClient({ plugins: [emailOTPClient(), anonymousClient()] });

export interface SessionUser {
  id: string;
  email: string | null;
  anonymous: boolean;
}

const toUser = (u: { id: string; email: string; isAnonymous?: boolean | null }): SessionUser => ({ id: u.id, email: u.isAnonymous ? null : u.email, anonymous: !!u.isAnonymous });

/** The signed-in user (anonymous or not), or null. Re-renders on sign-in/out. */
export function useUser(): { user: SessionUser | null; pending: boolean } {
  const { data, isPending } = authClient.useSession();
  return { user: data?.user ? toUser(data.user) : null, pending: isPending };
}

/** The current user, creating an anonymous one if there is none. */
export async function ensureUser(): Promise<SessionUser> {
  const s = await authClient.getSession();
  if (s.data?.user) return toUser(s.data.user);
  const r = await authClient.signIn.anonymous();
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
  const r = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
  if (r.error) throw new AuthError(r.error.code ?? "send_failed", r.error.status === 429 ? "Too many codes. Wait a few minutes, then try again." : "Could not send the code. Check the email address.");
}

export async function signInWithCode(email: string, otp: string): Promise<SessionUser> {
  const wasAnonymous = !!(await authClient.getSession()).data?.user?.isAnonymous;
  const r = await authClient.signIn.emailOtp({ email, otp });
  if (r.error || !r.data) throw new AuthError(r.error?.code ?? "sign_in_failed", r.error?.status === 429 ? "Too many tries. Wait a few minutes." : "That code is not correct, or it has expired.");
  if (wasAnonymous) track("email_added");
  return toUser(r.data.user);
}

export async function signOut() {
  await authClient.signOut();
}

export async function deleteAccount() {
  const res = await fetch("/api/account/delete", { method: "POST" });
  if (!res.ok) throw new Error(`Could not delete the account (${res.status})`);
  await authClient.signOut().catch(() => {});
}
