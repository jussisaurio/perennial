import { useEffect, useState, lazy, Suspense } from "react";
import { saveCourse, useLearner, useStore } from "../data/learner";
import type { CourseRow } from "../data/rows";
import { useSound } from "./Sound";
import { AccountPanel } from "./Account";
import { DataSection } from "./DataSection";
import { getThemePref, setThemePref, type ThemePref } from "./theme";

const DevTools = import.meta.env.DEV ? lazy(() => import("../dev/DevTools")) : null;

function CourseSettings({ course }: { course: CourseRow }) {
  const store = useStore();
  const [retention, setRetention] = useState(course.retention);
  // Save once the user lets go (mouse, touch, keyboard, or leaving the control).
  const commit = () => {
    if (Math.abs(retention - course.retention) > 1e-6) void saveCourse(store, course.lang, { retention });
  };
  return (
    <div className="form">
      <label>
        Time per day
        <select value={course.minutes} onChange={(e) => void saveCourse(store, course.lang, { minutes: Number(e.target.value) })}>
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

/** Signed in: the account is the sync. Shows its status, nothing to set up. */
/** Whether the device has changes the server hasn't received yet (offline, for example). */
function SavedStatus() {
  const store = useStore();
  const [pending, setPending] = useState(store.pendingWrites());
  useEffect(() => {
    const t = setInterval(() => setPending(store.pendingWrites()), 2000);
    return () => clearInterval(t);
  }, [store]);
  return (
    <p className="muted small" role="status">
      {pending ? `${pending} ${pending === 1 ? "change is" : "changes are"} saved on this device and will upload when you are online.` : "All changes are saved."}
    </p>
  );
}

export function SettingsScreen({ lang }: { lang: string; onSignedOut?: () => void }) {
  const learner = useLearner(lang);
  const course = learner?.course;
  return (
    <div className="page">
      <h1>Settings</h1>
      <section>
        <h2>Account</h2>
        <AccountPanel />
        <SavedStatus />
      </section>
      {course && (
        <section>
          <h2>Course</h2>
          <CourseSettings course={course} />
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
        <h2>Your data</h2>
        <DataSection lang={lang} />
      </section>
      {DevTools && (
        <Suspense>
          <DevTools />
        </Suspense>
      )}
    </div>
  );
}
