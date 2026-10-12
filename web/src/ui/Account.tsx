import { useEffect, useState } from "react";
import { useFeatures } from "../data/server";
import { errorLine, sendingLabel } from "../content/voice";
import { apiMessage, getMe, resetDate, type Me } from "../data/ai";
import { AuthError, sendCode, signInWithCode, signOut, useUser } from "../data/auth";
import { CheckIcon } from "./icons";

export { apiMessage };

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
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, anonymous, tick]);
  return { me: id ? me : null, refresh: () => setTick((t) => t + 1) };
}

export function SignIn({ cta = "Send me a code" }: { cta?: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : errorLine());
    } finally {
      setBusy(false);
    }
  };

  if (step === "email")
    return (
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await sendCode(email.trim());
            setStep("code");
          });
        }}
      >
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
        </label>
        <div className="row">
          <button className="primary" type="submit" disabled={busy || !email.includes("@")}>
            {busy ? sendingLabel() : cta}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="muted small">You do not need a password. We send you a code by email.</p>
      </form>
    );

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => signInWithCode(email.trim(), code));
      }}
    >
      <p className="muted small">
        We sent a 6-digit code to <strong>{email}</strong>.
      </p>
      <label>
        Code
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" autoFocus />
      </label>
      <div className="row">
        <button className="primary" type="submit" disabled={busy || code.length !== 6}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button className="ghost" type="button" onClick={() => (setStep("email"), setCode(""), setError(""))}>
          Use another email
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function Credits({ me }: { me: Me }) {
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
