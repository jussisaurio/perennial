import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, type ReactNode } from "react";
import { aiMode } from "./ai/backend";
import { ensurePool } from "./content/builder";
import { db, getMeta, setMeta } from "./db/db";
import { Home } from "./ui/Home";
import { FlowerIcon, GearIcon, HomeIcon, ListIcon, SproutMark } from "./ui/icons";
import { GardenWalk } from "./ui/GardenWalk";
import { Onboarding } from "./ui/Onboarding";
import { SessionScreen } from "./ui/Session";
import { SettingsScreen } from "./ui/Settings";
import { WordsScreen } from "./ui/Words";

type Route = "/today" | "/garden" | "/words" | "/words/add" | "/settings" | "/session";
const ROUTES: Route[] = ["/today", "/garden", "/words", "/words/add", "/settings", "/session"];

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

  useEffect(() => {
    void getMeta<string | null>("course", null).then(setCourseId);
  }, []);
  const selectCourse = (id: string) => {
    setCourseId(id);
    void setMeta("course", id);
  };

  if (!courses) return null;
  const course = courses.find((c) => c.id === courseId) ?? courses[0];

  if (!course)
    return (
      <Onboarding
        onCreated={(id) => {
          selectCourse(id);
          go("/today", { replace: true });
        }}
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
      {route === "/settings" && <SettingsScreen course={course} />}
    </div>
  );
}
