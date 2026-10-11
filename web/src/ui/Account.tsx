import { useEffect, useState } from "react";
import { getCachedMe, getSession, hostedMessage, onAccountChange, openBillingPortal, refreshMe, requestCode, resetDate, signOut, startCheckout, verifyCode, type Me } from "../hosted/api";
import { CheckIcon } from "./icons";

/** Current account state, kept fresh when anything signs in, out, or changes plan. */
export function useAccount(): { signedIn: boolean | null; me: Me | null } {
  const [state, setState] = useState<{ signedIn: boolean | null; me: Me | null }>({ signedIn: null, me: null });
  useEffect(() => {
    const load = async () => setState({ signedIn: !!(await getSession()), me: await getCachedMe() });
    void load();
    void refreshMe().catch(() => {});
    return onAccountChange(() => void load());
  }, []);
  return state;
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
      setError(hostedMessage(e));
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
            await requestCode(email);
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
            {busy ? "Sending…" : cta}
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
        void run(() => verifyCode(email, code));
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
      <span className="muted small">AI words are used when the AI makes cards from your own texts. The daily course words are free.</span>
    </div>
  );
}

export function UpgradeOffer({ me }: { me: Me }) {
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<"month" | "year" | null>(null);
  const [busy, setBusy] = useState(false);
  if (me.plan === "pro" || !me.billing) return null;
  const price = chosen === "year" ? me.billing.yearly : me.billing.monthly;
  const go = async () => {
    if (!chosen) return;
    setBusy(true);
    setError("");
    try {
      await startCheckout(chosen);
    } catch (e) {
      setError(hostedMessage(e));
      setBusy(false);
    }
  };
  return (
    <div className="upgrade">
      <strong>Perennial Pro</strong>
      <ul>
        <li>{me.plans.pro.toLocaleString("en")} AI words a month for cards from your own texts</li>
        <li>New example sentences for your words, made automatically</li>
        <li>Your payment pays for the AI and keeps Perennial free of ads</li>
      </ul>
      {chosen ? (
        <div className="confirm">
          <p className="small">
            <strong>{price}</strong>, renews every {chosen}. You pay on Stripe, a payment company. You can cancel at any time in Settings → Manage subscription.
          </p>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => void go()}>
              {busy ? "Opening Stripe…" : "Continue to payment"}
            </button>
            <button className="ghost" onClick={() => setChosen(null)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          {me.billing.yearly && (
            <button className="primary" onClick={() => setChosen("year")}>
              Pro · {me.billing.yearly}
            </button>
          )}
          {me.billing.monthly && (
            <button className="secondary" onClick={() => setChosen("month")}>
              {me.billing.monthly}
            </button>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function AccountPanel() {
  const { signedIn, me } = useAccount();
  const [error, setError] = useState("");
  if (signedIn === null) return null;
  if (!signedIn)
    return (
      <div className="form">
        <p className="muted small">Sign in to use Perennial AI and to keep your words on all your devices.</p>
        <SignIn cta="Sign in" />
      </div>
    );
  return (
    <div className="form">
      <div className="status-card">
        <CheckIcon size={18} />
        <div>
          <strong>{me?.email ?? "Signed in"}</strong>
          <span className="muted small">{me?.plan === "pro" ? "Perennial Pro" : "Free plan"} · words sync on all your devices</span>
        </div>
        <button className="ghost" onClick={() => void signOut()} title="Your words stay on this device. Sign in again to sync them.">
          Sign out
        </button>
      </div>
      <p className="muted small">If you sign out, your words stay on this device. Sign in again to sync them.</p>
      {me && <Credits me={me} />}
      {me && <UpgradeOffer me={me} />}
      {me?.plan === "pro" && me.billing && (
        <div className="row">
          <button className="secondary" onClick={() => void openBillingPortal().catch((e) => setError(hostedMessage(e)))}>
            Manage subscription
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
