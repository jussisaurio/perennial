import { useEffect, useState } from "react";
import { useFeatures } from "../data/server";
import { errorLine, sendingLabel } from "../content/voice";
import { getMe, resetDate, type Me } from "../data/ai";
import { AuthError, sendCode, signInWithCode, signOut, useUser } from "../data/auth";
import { track } from "../observability";
import { CheckIcon } from "./icons";

/** Account details from the server (credits), refreshed when the user changes. */
export function useMe(): { me: Me | null; refresh: () => void } {
  const { user } = useUser();
  const [me, setMe] = useState<Me | null>(null);
  const [tick, setTick] = useState(0);
  const id = user?.id;
  const anonymous = user?.anonymous;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void getMe()
      .then((m) => alive && setMe(m))
      // A failed fetch leaves `me` null, the same as while it loads.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, anonymous, tick]);
  return { me: id ? me : null, refresh: () => setTick((t) => t + 1) };
}

/**
 * True when the learner has fewer than `needed` AI words left. While the count
 * is unknown (loading, or the fetch failed) nothing is blocked: the server
 * checks credits on every AI request and says when they ran out.
 */
export function tooFewCredits(me: Me | null, needed: number): boolean {
  return me !== null && me.credits.left < needed;
}

// After each send, "Send the code again" waits this long, so a slow email has time to come.
const RESEND_WAIT_MS = 30_000;

/** What the code step says about the code. */
type Sent = "sent" | "maybe-sent" | "sent-again" | "have-code";

export function SignIn({ cta }: { cta: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [sent, setSent] = useState<Sent>("sent");
  const [busy, setBusy] = useState<"send" | "sign-in" | null>(null);
  const [error, setError] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Counts down to resendAt, once a second.
  useEffect(() => {
    if (now >= resendAt) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [now, resendAt]);
  const resendIn = Math.ceil((resendAt - now) / 1000);

  const run = async (what: "send" | "sign-in", fn: () => Promise<unknown>) => {
    setBusy(what);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : errorLine());
    } finally {
      setBusy(null);
    }
  };

  const send = async (again: boolean) => {
    const result = await sendCode(email.trim());
    setSent(result === "maybe-sent" ? "maybe-sent" : again ? "sent-again" : "sent");
    setResendAt(Date.now() + RESEND_WAIT_MS);
    setNow(Date.now());
    if (!again) track("signin_code_shown", { timedOut: result === "maybe-sent" });
    setStep("code");
  };

  const alert = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );

  if (step === "email")
    return (
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run("send", () => send(false));
        }}
      >
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        </label>
        <div className="row">
          <button className="primary" type="submit" disabled={!!busy || !email.includes("@")}>
            {busy ? sendingLabel() : cta}
          </button>
          <button className="ghost" type="button" disabled={!!busy || !email.includes("@")} onClick={() => (setSent("have-code"), setStep("code"), setError(""))}>
            Enter a code I already have
          </button>
        </div>
        {alert}
        <p className="muted small">You do not need a password. We send you a code by email.</p>
      </form>
    );

  const to = <strong>{email}</strong>;
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void run("sign-in", () => signInWithCode(email.trim(), code));
      }}
    >
      <p className="muted small" role="status">
        {sent === "sent" && <>We sent a 6-digit code to {to}.</>}
        {sent === "sent-again" && <>We sent the code to {to} again.</>}
        {sent === "maybe-sent" && <>The code to {to} may still be on its way. If no email comes in a minute, send it again.</>}
        {sent === "have-code" && <>Enter the 6-digit code we sent to {to}.</>}
      </p>
      <label>
        Code
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" autoFocus />
      </label>
      <div className="row">
        <button className="primary" type="submit" disabled={!!busy || code.length !== 6}>
          {busy === "sign-in" ? "Signing in…" : "Sign in"}
        </button>
        <button className="ghost" type="button" disabled={!!busy || resendIn > 0} onClick={() => void run("send", () => send(true))}>
          {busy === "send" ? sendingLabel() : resendIn > 0 ? `Send the code again in ${resendIn} s` : "Send the code again"}
        </button>
        <button className="ghost" type="button" disabled={!!busy} onClick={() => (setStep("email"), setCode(""), setError(""))}>
          Use another email
        </button>
      </div>
      {alert}
    </form>
  );
}

function Credits({ me }: { me: Me }) {
  const { ai } = useFeatures();
  if (!ai) return null; // No AI on this server, so no AI words to count.
  // The bar shows what is left, like a fuel gauge: empty means used up.
  const pct = Math.min(100, (me.credits.left / Math.max(1, me.credits.limit)) * 100);
  return (
    <div className="credits">
      <div className={me.credits.left === 0 ? "credits-bar empty" : "credits-bar"} aria-hidden="true">
        <div style={{ width: `${pct}%` }} />
      </div>
      <span className="muted small">
        {me.credits.left} of {me.credits.limit} AI words left this month. New AI words on {resetDate()}.
      </span>
      <span className="muted small">AI words are used when the AI makes cards from your own texts or writes new sentences. The course itself is free.</span>
    </div>
  );
}

export function AccountPanel() {
  const { user } = useUser();
  const { me } = useMe();
  const { ai } = useFeatures();
  if (!user) return null;
  if (user.anonymous)
    return (
      <div className="form">
        <p className="small">
          <strong>Keep your garden safe.</strong> Add your email to keep your words on all your devices{ai && " and to use Perennial AI"}. Your progress stays.
        </p>
        <SignIn cta="Send me a code" />
      </div>
    );
  return (
    <div className="form">
      <div className="status-card">
        <CheckIcon size={18} />
        <div>
          <strong>{user.email}</strong>
          <span className="muted small">Your words sync on all your devices</span>
        </div>
        <button className="ghost" onClick={() => void signOut()} title="Your garden stays in your account. Sign in again to see it.">
          Sign out
        </button>
      </div>
      {me && <Credits me={me} />}
    </div>
  );
}
