import { useEffect, useState, lazy, Suspense, type CSSProperties } from "react";
import { saveCourse, useLearner, useStore } from "../data/learner";
import type { CourseRow } from "../data/rows";
import { useSound } from "./Sound";
import { reducedMotion, useGrowthSetting } from "./Growth";
import { AccountPanel } from "./Account";
import { DataSection } from "./DataSection";
import { RefusedLine, useRefused } from "./Refused";
import { getThemePref, setThemePref, type ThemePref } from "./theme";
import { Segmented, Switch } from "./arrows";

const DevTools = import.meta.env.DEV ? lazy(() => import("../dev/DevTools")) : null;

// The retention slider's ends.
const LOW = 0.8;
const HIGH = 0.95;

function CourseSettings({ course }: { course: CourseRow }) {
  const store = useStore();
  const [retention, setRetention] = useState(course.retention);
  // Save once the user lets go (mouse, touch, keyboard, or leaving the control).
  const commit = () => {
    if (Math.abs(retention - course.retention) > 1e-6) void saveCourse(store, course.lang, { retention });
  };
  // React's style type has no custom properties: --fill inks the track up to the thumb (index.css).
  const fill = { "--fill": (retention - LOW) / (HIGH - LOW) } as CSSProperties;
  return (
    <div className="form">
      <label className="form">
        <span>Target: remember {Math.round(retention * 100)}% of words</span>
        <input type="range" style={fill} aria-valuetext={`${Math.round(retention * 100)}%`} min={LOW} max={HIGH} step={0.01} value={retention} onChange={(e) => setRetention(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
        <span className="muted small">
          When a word comes back, this is how sure you are to remember it. 90% is good for most people. A higher number gives you many more reviews. A lower number makes you forget more.
        </span>
      </label>
    </div>
  );
}

function GrowthSetting() {
  const [on, set] = useGrowthSetting();
  return (
    <Switch
      label="Watch the plant grow after a good answer"
      on={on}
      onChange={set}
      help="The word's plant gets water and grows. A new word's seed goes into the soil. It takes about a second, and a tap skips it. This setting is only for this device."
      // The device's own setting wins, and the switch says so (docs/accessibility.md).
      blocked={reducedMotion() ? "Your device asks for less motion, so this is off. To turn it on, change the motion setting on your device." : undefined}
    />
  );
}

function SoundSetting() {
  const [on, set] = useSound();
  return (
    <Switch
      label="Speak words aloud"
      on={on}
      onChange={set}
      help="When this is off, Perennial does not speak words or sentences, and there are no listening exercises. This setting is only for this device."
    />
  );
}

function Appearance() {
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  return (
    <Segmented<ThemePref>
      label="Colors"
      options={[
        ["system", "Same as my device"],
        ["light", "Light"],
        ["dark", "Dark"],
      ]}
      value={pref}
      onChange={(t) => {
        setThemePref(t);
        setPref(t);
      }}
    />
  );
}

/** Whether the device has changes the server hasn't received yet (offline, for example). */
function SavedStatus() {
  const store = useStore();
  const [pending, setPending] = useState(store.pendingWrites());
  useEffect(() => {
    const t = setInterval(() => setPending(store.pendingWrites()), 2000);
    return () => clearInterval(t);
  }, [store]);
  const refused = useRefused().count > 0;
  const waiting = pending ? `${pending} ${pending === 1 ? "change is" : "changes are"} saved on this device and will upload when you are online.` : null;
  return (
    <>
      <RefusedLine />
      {/* "All changes are saved" would be untrue after a refusal. */}
      {(waiting || !refused) && (
        <p className="muted small" role="status">
          {waiting ?? "All changes are saved."}
        </p>
      )}
    </>
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
        <h2>Growing plants</h2>
        <GrowthSetting />
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
