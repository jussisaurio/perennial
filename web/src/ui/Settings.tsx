import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, lazy, Suspense } from "react";
import { askJSON, getLLMConfig, isLocalUrl, PRESETS, setLLMConfig, type LLMConfig } from "../ai/llm";
import { db, recomputeCourse, write } from "../db/db";
import { deleteSyncedData, getStatus, getSyncConfig, newSyncKey, onStatus, setSyncConfig, sync, type SyncConfig, type SyncStatus } from "../db/sync";
import type { Course } from "../model";
import { getAIPreference, setAIPreference, type AIMode } from "../ai/backend";
import { useSound } from "./Sound";
import { AccountPanel, useAccount } from "./Account";
import { DataSection } from "./DataSection";
import { CheckIcon } from "./icons";
import { getThemePref, setThemePref, type ThemePref } from "./theme";

const DevTools = import.meta.env.DEV ? lazy(() => import("../dev/DevTools")) : null;

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Turn provider/network failures into something a person can act on. */
function friendlyError(e: unknown, cfg: LLMConfig): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = Number(msg.match(/^(\d{3}):/)?.[1]);
  if (code === 401 || code === 403) return "The service did not accept this API key.";
  if (code === 404) return "Not found. Make sure that the model name and the address are correct.";
  if (code === 429) return "Too many requests, or no credit left with this service.";
  if (code >= 500) return "The service has a problem. Try again later.";
  if (/failed to fetch|load failed|networkerror/i.test(msg))
    return isLocalUrl(cfg.baseUrl)
      ? `Could not connect to ${hostOf(cfg.baseUrl)}. Make sure that it is running. Ollama must start with OLLAMA_ORIGINS=* to accept requests from a browser.`
      : `Could not connect to ${hostOf(cfg.baseUrl)}. Make sure that the address and your internet connection are correct.`;
  if (/timeout|timed out/i.test(msg)) return "The model did not answer in time. A smaller or faster model can help.";
  if (/unusable/i.test(msg)) return "Connected, but Perennial cannot use the answers from this model. Try a larger model.";
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
}

export function AISettings({ onSaved }: { onSaved?: () => void }) {
  const [saved, setSaved] = useState<LLMConfig | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [cfg, setCfg] = useState<LLMConfig>({ ...PRESETS.OpenAI, apiKey: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void getLLMConfig().then((c) => {
      setSaved(c);
      if (c) setCfg(c);
    });
  }, []);
  const preset = Object.entries(PRESETS).find(([, p]) => p.baseUrl === cfg.baseUrl && p.dialect === cfg.dialect)?.[0] ?? "Custom";
  const needsKey = !isLocalUrl(cfg.baseUrl);

  const save = async () => {
    setError("");
    if (needsKey && !cfg.apiKey.trim()) return setError("Add your API key first.");
    setBusy(true);
    try {
      const r = await askJSON("You are a connection test.", 'Reply with {"ok": true}', (x) => x as { ok: boolean }, { config: cfg });
      if (!r?.ok) throw new Error("unusable");
      await setLLMConfig(cfg);
      setSaved(cfg);
      setEditing(false);
      onSaved?.();
    } catch (e) {
      setError(friendlyError(e, cfg));
    } finally {
      setBusy(false);
    }
  };

  if (saved === undefined) return null;

  if (saved && !editing)
    return (
      <div className="status-card">
        <CheckIcon size={18} />
        <div>
          <strong>Connected</strong>
          <span className="muted small">
            {saved.model} · {hostOf(saved.baseUrl)}
          </span>
        </div>
        <button className="ghost" onClick={() => setEditing(true)}>
          Change
        </button>
      </div>
    );

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label>
        Service
        <select
          value={preset}
          onChange={(e) => {
            const p = PRESETS[e.target.value];
            if (p) setCfg({ ...cfg, ...p });
            setError("");
          }}
        >
          {Object.keys(PRESETS).map((k) => (
            <option key={k}>{k}</option>
          ))}
          <option>Custom</option>
        </select>
      </label>
      {needsKey && (
        <label>
          API key
          <input type="password" value={cfg.apiKey} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} placeholder="stored only on this device" autoComplete="off" />
        </label>
      )}
      <label>
        Model
        <input value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} />
      </label>
      <details className="more" open={preset === "Custom"}>
        <summary>Address and format</summary>
        <div className="form">
          <label>
            Address (URL)
            <input value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} />
          </label>
          <label>
            API format
            <select value={cfg.dialect} onChange={(e) => setCfg({ ...cfg, dialect: e.target.value as LLMConfig["dialect"] })}>
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
        </div>
      </details>
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Connecting…" : "Connect"}
        </button>
        {saved && (
          <button className="ghost" type="button" onClick={() => (setEditing(false), setCfg(saved), setError(""))}>
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {isLocalUrl(cfg.baseUrl) ? (
        <p className="muted small">Small models on your own computer often make language mistakes, for example wrong grammar or wrong translations. A cloud model or Perennial AI is more reliable.</p>
      ) : (
        <p className="muted small">Your browser sends requests directly to this service. A small, fast model is enough.</p>
      )}
    </form>
  );
}

/**
 * Sync setup. In "link" mode (a new device joining) it only asks for the code;
 * in "settings" mode it also creates codes and manages an active sync.
 */
export function SyncSettings({ mode = "settings" }: { mode?: "settings" | "link" }) {
  const [url, setUrl] = useState(location.origin);
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState<SyncConfig | null>(null);
  const [status, setStatus] = useState<SyncStatus>(getStatus());
  const [copied, setCopied] = useState(false);
  const courseCount = useLiveQuery(() => db.courses.filter((c) => !c.deleted).count(), []);
  useEffect(() => {
    void getSyncConfig().then((c) => {
      setSaved(c);
      if (c) {
        setUrl(c.url);
        setKey(c.key);
      }
    });
    return onStatus(setStatus);
  }, []);

  const turnOn = async (k = key) => {
    const cfg = { url, key: k };
    await setSyncConfig(cfg);
    setSaved(cfg);
    setKey(k);
  };

  const statusText =
    status.state === "syncing" ? "Syncing…" : status.state === "error" ? `Could not sync: ${status.message}` : status.state === "idle" ? `Last sync ${new Date(status.at).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}` : "";

  const server = (
    <details className="more">
      <summary>Server address</summary>
      <label className="form">
        <span className="muted small">Change this only if you have your own server.</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
    </details>
  );

  if (mode === "link") {
    const linkedButEmpty = saved && status.state === "idle" && courseCount === 0;
    return (
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.length >= 12) void turnOn();
        }}
      >
        <label>
          Sync code
          <input value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="xxxxx-xxxxx-xxxxx" autoComplete="off" autoCapitalize="off" spellCheck={false} />
        </label>
        {server}
        <div className="row">
          <button className="primary" type="submit" disabled={key.length < 12 || status.state === "syncing"}>
            {status.state === "syncing" ? "Connecting…" : "Connect this device"}
          </button>
        </div>
        {linkedButEmpty && (
          <p className="error" role="alert">
            No data found for this code. Make sure that the code is correct, or start a new course below.
          </p>
        )}
        {status.state === "error" && <p className="error">{statusText}</p>}
      </form>
    );
  }

  if (saved)
    return (
      <div className="form">
        <div className="status-card">
          <CheckIcon size={18} />
          <div>
            <strong>Sync is on</strong>
            <span className="muted small">{statusText}</span>
          </div>
          <button className="ghost" onClick={() => void sync()}>
            Sync now
          </button>
        </div>
        <label>
          Your sync code
          <div className="row">
            <input value={saved.key} readOnly onFocus={(e) => e.target.select()} />
            <button
              className="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(saved.key).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                });
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <span className="muted small">Type this code on your other device. Keep it private. Anyone with the code can see and change your data.</span>
        </label>
        <div className="row">
          <button
            className="ghost"
            onClick={async () => {
              await setSyncConfig(null);
              setSaved(null);
            }}
          >
            Turn off sync on this device
          </button>
        </div>
        <EraseSyncedData onDone={() => setSaved(null)} />
      </div>
    );

  return (
    <div className="form">
      <p className="muted small">Use your words and progress on all your devices. You do not need an account. You get a private code.</p>
      <div className="row">
        <button className="primary" onClick={() => void turnOn(newSyncKey())}>
          Turn on sync
        </button>
      </div>
      <details className="more">
        <summary>I already have a code</summary>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.length >= 12) void turnOn();
          }}
        >
          <input value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="xxxxx-xxxxx-xxxxx" autoComplete="off" spellCheck={false} />
          <button className="secondary" type="submit" disabled={key.length < 12}>
            Connect
          </button>
        </form>
      </details>
      {server}
    </div>
  );
}

function EraseSyncedData({ onDone }: { onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  return (
    <details className="more danger">
      <summary>Delete my synced data from the server</summary>
      <div className="form">
        <p className="small">
          This deletes everything this sync code stored on the server. Your words stay on this device, and sync turns off. Other devices with this code keep their own copy. <strong>You cannot undo this.</strong>
        </p>
        <label>
          Type <strong>delete</strong> to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
        <div className="row">
          <button
            className="fail"
            disabled={typed.trim().toLowerCase() !== "delete"}
            onClick={() =>
              void deleteSyncedData()
                .then(onDone)
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
            }
          >
            Delete synced data
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </details>
  );
}

function CourseSettings({ course }: { course: Course }) {
  const [retention, setRetention] = useState(course.retention);
  // Save once the user lets go (mouse, touch, keyboard, or leaving the control).
  const commit = () => {
    if (retention !== course.retention) void write<Course>("courses", { id: course.id, retention }).then(() => recomputeCourse(course.id));
  };
  return (
    <div className="form">
      <label>
        Time per day
        <select value={course.minutes} onChange={(e) => void write<Course>("courses", { id: course.id, minutes: Number(e.target.value) })}>
          {[3, 5, 7, 10, 15, 20, 30].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </select>
      </label>
      <details className="more">
        <summary>How often to review</summary>
        <label className="form">
          <span>Target: remember {Math.round(retention * 100)}% of words</span>
          <input type="range" min={0.8} max={0.95} step={0.01} value={retention} onChange={(e) => setRetention(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
          <span className="muted small">
            When a word comes back, this is how sure you are to remember it. 90% is good for most people. A higher number gives you many more reviews. A lower number makes you forget more.
          </span>
        </label>
      </details>
    </div>
  );
}

function SoundSetting() {
  const [on, set] = useSound();
  return (
    <div className="form">
      <div className="chips" role="radiogroup" aria-label="Sound">
        {[true, false].map((v) => (
          <button key={String(v)} role="radio" aria-checked={on === v} className={on === v ? "chip on" : "chip"} onClick={() => set(v)}>
            {v ? "Sound on" : "Sound off"}
          </button>
        ))}
      </div>
      <p className="muted small">When sound is off, Perennial does not speak words or sentences, and there are no listening exercises. This setting is only for this device.</p>
    </div>
  );
}

function Appearance() {
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  return (
    <div className="chips" role="radiogroup" aria-label="Theme">
      {(["system", "light", "dark"] as ThemePref[]).map((t) => (
        <button
          key={t}
          role="radio"
          aria-checked={pref === t}
          className={pref === t ? "chip on" : "chip"}
          onClick={() => {
            setThemePref(t);
            setPref(t);
          }}
        >
          {t === "system" ? "Same as my device" : t === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  );
}

/** Perennial AI (with an account) or the learner's own provider. */
export function AIChoice() {
  const { signedIn } = useAccount();
  const [pref, setPref] = useState<AIMode | null>(null);
  const [hasOwn, setHasOwn] = useState(false);
  // Switching to an own key takes effect only after it connects, so one tap
  // never leaves the learner without AI. (Hooks stay above the early returns.)
  const [trying, setTrying] = useState(false);
  useEffect(() => {
    void getAIPreference().then(setPref);
    void getLLMConfig().then((c) => setHasOwn(!!c));
  }, []);
  if (signedIn === null) return null;
  if (!signedIn)
    return (
      <div className="form">
        <p className="muted small">Sign in to use Perennial AI. You do not need to set anything up.</p>
        {/* Show a connected key openly; otherwise keep the form one step away. */}
        <details className="more" open={hasOwn}>
          <summary>Use my own API key or a local model</summary>
          <AISettings />
        </details>
      </div>
    );
  const mode = pref ?? "hosted";
  const shown = trying ? "own" : mode;
  const choose = (m: AIMode) => {
    if (m === "own" && !hasOwn) return setTrying(true);
    setTrying(false);
    setPref(m);
    void setAIPreference(m);
  };
  return (
    <div className="form">
      <div className="choice" role="radiogroup" aria-label="AI model">
        <label>
          <input type="radio" name="ai" checked={shown === "hosted"} onChange={() => choose("hosted")} />
          <span>
            <strong>Perennial AI</strong>
            <span className="muted small">Included with your account. Nothing to set up.</span>
          </span>
        </label>
        <label>
          <input type="radio" name="ai" checked={shown === "own"} onChange={() => choose("own")} />
          <span>
            <strong>My own API key (for developers)</strong>
            <span className="muted small">An OpenAI, Anthropic, or local model account. Uses no Perennial AI words.</span>
          </span>
        </label>
      </div>
      {shown === "own" && (
        <>
          {trying && <p className="muted small">Perennial AI stays on until your own key is connected.</p>}
          <AISettings
            onSaved={() => {
              setHasOwn(true);
              setTrying(false);
              setPref("own");
              void setAIPreference("own");
            }}
          />
        </>
      )}
    </div>
  );
}

function AccountSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>(getStatus());
  useEffect(() => onStatus(setStatus), []);
  const text =
    status.state === "syncing"
      ? "Syncing…"
      : status.state === "error"
        ? `Could not sync: ${status.message}. Your words are safe on this device; Perennial tries again automatically.`
        : status.state === "idle"
          ? `Up to date. Last sync ${new Date(status.at).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}.`
          : "Waiting to sync…";
  return (
    <div className="form">
      <p className="muted small">Your words and progress sync with your account on every device where you sign in.</p>
      <div className="row">
        <span className="small">{text}</span>
        <button className="ghost" onClick={() => void sync()}>
          Sync now
        </button>
      </div>
    </div>
  );
}

function SyncSection() {
  const { signedIn } = useAccount();
  if (signedIn === null) return null;
  if (signedIn) return <AccountSyncStatus />;
  return (
    <details className="more">
      <summary>Sync without an account</summary>
      <SyncSettings />
    </details>
  );
}

export function SettingsScreen({ course, onAddLanguage }: { course: Course | undefined; onAddLanguage: () => void }) {
  return (
    <div className="page">
      <h1>Settings</h1>
      <section>
        <h2>Account</h2>
        <AccountPanel />
      </section>
      {course && (
        <section>
          <h2>Course</h2>
          <CourseSettings course={course} />
          <button className="ghost link" style={{ marginTop: "0.75rem" }} onClick={onAddLanguage}>
            + Learn another language
          </button>
        </section>
      )}
      <section>
        <h2>Colors</h2>
        <Appearance />
      </section>
      <section>
        <h2>Sound</h2>
        <SoundSetting />
      </section>
      <section>
        <h2>AI model</h2>
        <AIChoice />
      </section>
      <section>
        <h2>Sync</h2>
        <SyncSection />
      </section>
      <section>
        <h2>Your data</h2>
        <DataSection course={course} />
      </section>
      {DevTools && (
        <Suspense>
          <DevTools />
        </Suspense>
      )}
    </div>
  );
}
