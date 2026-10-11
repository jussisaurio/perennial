// Client for the hosted Perennial service (same origin: /api/...).

import { getMeta, setMeta } from "../db/db";

export interface Me {
  email: string;
  plan: "free" | "pro";
  subscription: { status: string; periodEnd: number | null } | null;
  credits: { used: number; limit: number; left: number; period: string };
  billing: { monthly: string | null; yearly: string | null } | null;
  plans: { free: number; pro: number };
}

interface Session {
  token: string;
  email: string;
}

export class HostedError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: Record<string, unknown>;
  constructor(status: number, code: string, detail: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const listeners = new Set<() => void>();
/** Notified when sign-in state or account details change. */
export const onAccountChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const changed = () => listeners.forEach((fn) => fn());

export const getSession = () => getMeta<Session | null>("session", null);
export const getCachedMe = () => getMeta<Me | null>("me", null);

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const session = await getSession();
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(session ? { authorization: `Session ${session.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && session) await clearSession();
    const { error, ...detail } = data;
    throw new HostedError(res.status, String(error ?? "error"), detail);
  }
  return data as T;
}

export const requestCode = (email: string) => api<{ ok: true }>("/auth/code", { email });

export async function verifyCode(email: string, code: string): Promise<Me> {
  const r = await api<{ token: string; me: Me }>("/auth/verify", { email, code });
  await setMeta("session", { token: r.token, email: r.me.email });
  await setMeta("me", r.me);
  changed();
  return r.me;
}

async function clearSession() {
  await setMeta("session", null);
  await setMeta("me", null);
  changed();
}

export async function signOut() {
  await api("/auth/signout", {}).catch(() => {});
  await clearSession();
}

export async function refreshMe(): Promise<Me | null> {
  if (!(await getSession())) return null;
  const me = await api<Me>("/me");
  await setMeta("me", me);
  changed();
  return me;
}

export async function deleteAccount() {
  await api("/account/delete", { confirm: "delete" });
  await clearSession();
}

export async function startCheckout(interval: "month" | "year") {
  const { url } = await api<{ url: string }>("/billing/checkout", { interval });
  location.assign(url);
}

export async function openBillingPortal() {
  const { url } = await api<{ url: string }>("/billing/portal", {});
  location.assign(url);
}

const formatDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? "next month" : d.toLocaleDateString("en", { month: "long", day: "numeric" });
};

/** First day of next month, when AI words reset. */
export const resetDate = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString("en", { month: "long", day: "numeric" });
};

/** Plain-language text for errors the learner can act on. */
export function hostedMessage(e: unknown): string {
  if (!(e instanceof HostedError)) return e instanceof Error ? e.message : String(e);
  switch (e.code) {
    case "out_of_credits":
      return "You used all your AI words for this month.";
    case "busy":
      return "Perennial AI is very busy now. Try again in a few minutes.";
    case "paused":
      return `Perennial AI is paused until ${formatDate(String(e.detail.until ?? ""))} because it reached its monthly cost limit. Your own API key still works.`;
    case "slow_down":
    case "daily_limit":
      return "Too many requests. Wait a moment and try again.";
    case "wrong_code":
      return "This code is not correct.";
    case "code_expired":
      return "This code is too old. Ask for a new code.";
    case "too_many_attempts":
    case "too_many_codes":
      return "Too many tries. Wait an hour and try again.";
    case "invalid_email":
      return "This email address is not correct.";
    case "billing_not_configured":
      return "Payments are not available on this server.";
    case "cancel_subscription_first":
      return "Cancel your Pro subscription first (Manage subscription), then delete your account.";
    case "sign_in_required":
      return "Sign in to use Perennial AI.";
    default:
      return "Something went wrong. Try again later.";
  }
}
