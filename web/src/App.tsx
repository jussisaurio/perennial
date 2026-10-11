import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, type ReactNode } from "react";
import { aiMode, canRefreshInBackground } from "./ai/backend";
import { refreshMe } from "./hosted/api";
import { ensurePool, refreshExamples } from "./content/builder";
import { language } from "./content/languages";
import { db, getMeta, setMeta } from "./db/db";
import { Home } from "./ui/Home";
import { FlowerIcon, GearIcon, HomeIcon, ListIcon, SproutMark } from "./ui/icons";
import { GardenWalk } from "./ui/GardenWalk";
import { Onboarding } from "./ui/Onboarding";
import { SessionScreen } from "./ui/Session";
import { SettingsScreen } from "./ui/Settings";
import { WordsScreen } from "./ui/Words";

type Route = "/today" | "/garden" | "/words" | "/words/add" | "/settings" | "/session" | "/new-language";
const ROUTES: Route[] = ["/today", "/garden", "/words", "/words/add", "/settings", "/session", "/new-language"];

const TABS: { route: Route; label: string; icon: ReactNode }[] = [
  { route: "/today", label: "Today", icon: <HomeIcon /> },
  { route: "/garden", label: "Garden", icon: <FlowerIcon /> },
  { route: "/words", label: "Words", icon: <ListIcon /> },
  { route: "/settings", label: "Settings", icon: <GearIcon /> },
];

/** Screens live in the URL hash, so the browser's Back and Forward work. */
function useRoute(): [Route, (to: Route, opts?: { replace?: boolean }) => void] {
  const read = (): Route => {
    const h = location.hash.slice(1) as Route;
    return ROUTES.includes(h) ? h : "/today";
  };
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const go = (to: Route, opts: { replace?: boolean } = {}) => {
    if (to === route) return;
    if (opts.replace) history.replaceState(null, "", `#${to}`);
    else history.pushState(null, "", `#${to}`);
    setRoute(to);
  };
  return [route, go];
}

export default function App() {
  const courses = useLiveQuery(() => db.courses.filter((c) => !c.deleted).sortBy("createdAt"), []);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [route, go] = useRoute();
  const [sessionMinutes, setSessionMinutes] = useState<number | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    void getMeta<string | null>("course", null).then(setCourseId);
    // Back from Stripe Checkout. The webhook can take a moment, so poll briefly.
    const billing = new URLSearchParams(location.search).get("billing");
    if (billing) {
      history.replaceState(null, "", location.pathname + location.hash);
      if (billing === "success") {
        setNotice("Thank you! Turning on Pro…");
        void (async () => {
          for (let i = 0; i < 10; i++) {
            const me = await refreshMe().catch(() => null);
            if (me?.plan === "pro") return setNotice("Pro is on. Thank you for supporting Perennial.");
            await new Promise((r) => setTimeout(r, 1500));
          }
          setNotice("Payment received. Pro turns on in a few minutes.");
        })();
      }
    }
  }, []);
  useEffect(() => {
    if (!notice || notice.endsWith("…")) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  const selectCourse = (id: string) => {
    setCourseId(id);
    void setMeta("course", id);
  };

  if (!courses) return null;
  const course = courses.find((c) => c.id === courseId) ?? courses[0];

  if (!course || route === "/new-language")
    return (
      <Onboarding
        existing={courses}
        onCreated={(id) => {
          selectCourse(id);
          go("/today", { replace: true });
        }}
        onCancel={course ? () => history.back() : undefined}
      />
    );

  if (route === "/session")
    return (
      <SessionScreen
        course={course}
        minutes={sessionMinutes ?? course.minutes}
        onExit={() => {
          go("/today", { replace: true });
          // Top up content in the background while the learner is away.
          void (async () => {
            if (!(await aiMode())) return;
            await ensurePool(course);
            if (await canRefreshInBackground()) await refreshExamples(course);
          })().catch(() => {});
        }}
      />
    );

  if (route === "/garden")
    return (
      <GardenWalk
        course={course}
        onExit={() => (history.length > 1 ? history.back() : go("/today", { replace: true }))}
        onWater={() => {
          setSessionMinutes(null);
          go("/session");
        }}
      />
    );

  return (
    <div className="app">
      <nav className="top">
        <span className="wordmark">
          <SproutMark /> perennial
        </span>
        {courses.length > 1 && (
          <select className="course-pick" aria-label="Language" value={course.id} onChange={(e) => (e.target.value === "+" ? go("/new-language") : selectCourse(e.target.value))}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {language(c.lang).name}
              </option>
            ))}
            <option value="+">+ Add a language</option>
          </select>
        )}
        <div className="tabs" role="tablist">
          {TABS.map((t) => {
            const on = route === t.route || (t.route === "/words" && route === "/words/add");
            return (
              <button key={t.route} role="tab" aria-selected={on} className={on ? "tab on" : "tab"} onClick={() => go(t.route)}>
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
      {route === "/today" && (
        <Home
          course={course}
          onStart={(m) => {
            setSessionMinutes(m);
            go("/session");
          }}
          onAddWords={() => go("/words/add")}
          onWalk={() => go("/garden")}
        />
      )}
      {(route === "/words" || route === "/words/add") && <WordsScreen course={course} adding={route === "/words/add"} onAdd={() => go("/words/add")} onBack={() => go("/words")} />}
      {route === "/settings" && <SettingsScreen course={course} onAddLanguage={() => go("/new-language")} />}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
