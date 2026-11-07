import { startTransition, Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { signOut, useUser } from "./data/auth";
import { identify, initObservability, track } from "./observability";
import { saveCourse, StoreContext, useCourses, useDeck, useDeckSentences, useStore } from "./data/learner";
import { boot } from "./data/boot";
import { loadDeck, loadSentences } from "./data/deck";
import { cleanUpForgotten, keepCourse, readCourse } from "./data/device";
import { language } from "./content/languages";
import { reloadNeeded } from "./data/http";
import { createStore, type Store } from "./data/store";
import { Home } from "./ui/Home";
import { FlowerIcon, GearIcon, HomeIcon, ListIcon, SproutMark } from "./ui/icons";
import { CourseSwitcher } from "./ui/CourseSwitcher";
import { courseArrived, Onboarding, useStartingCourse } from "./ui/Onboarding";
import { Settling } from "./ui/Settling";
import { RefusedBanner, useRefused } from "./ui/Refused";
import { LearnerGardenWalk, preloadScreens, preloadSession, SessionScreen, SettingsScreen, WordsScreen } from "./ui/screens";
import { DAILY_MINUTES } from "./data/practice";
import { arrowKeys } from "./ui/arrows";

// The downloads after this code, in the order the learner needs them (#615).
// On a slow link they share it, so each starts once the one before is in.
// 1. The course's words: Today waits for them. Asked for here, as soon as this
//    code is in, not after Today's first paint (useDeck). At the boot answer they
//    would take the link from this code and hold up that paint.
// 2. Its sentences (deck.ts) and the Session screen: a session needs both.
// 3. Error reports, analytics and the other screens.
// Only the course this device keeps (Main shows it): with none, the screens load the deck.
void boot()
  .then(
    async (b) => {
      const lang = readCourse();
      if (!lang || !b.rows?.course.some((c) => c.lang === lang)) return;
      await loadDeck(lang).then(preloadSession);
      await loadSentences(lang);
    },
    // No boot answer: its readers ask their own endpoints and the screens load the deck.
    () => {},
  )
  // A failed deck is logged (deck.ts) and shown by Main: step 3 still comes.
  .catch(() => {})
  .then(() => {
    initObservability();
    preloadScreens();
  });

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
    const onChange = () => startTransition(() => setRoute(read()));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const go = (to: Route, opts: { replace?: boolean } = {}) => {
    if (to === route) return;
    if (opts.replace) history.replaceState(null, "", `#${to}`);
    else history.pushState(null, "", `#${to}`);
    // A transition: on a slow device React draws the new screen in short slices, and the old one stays until it is ready.
    startTransition(() => setRoute(to));
  };
  return [route, go];
}

/** One store per signed-in user; a new user (sign-in, sign-out) gets a fresh one. */
function StoreProvider({ userId, email, children }: { userId: string; email: string | null; children: ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let made: Store | null = null;
    createStore(userId, email).then(
      (s) => {
        made = s;
        if (alive) setStore(s);
        else s.dispose();
      },
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
      // Dispose after the screens using this store have unmounted.
      setTimeout(() => made?.dispose(), 0);
    };
  }, [userId, email]);
  if (error) return <div className="page narrow"><p className="error">Could not open your data: {error}</p></div>;
  if (!store) return <Settling />;
  // Keyed by user: a new user remounts every screen, so none holds the old store.
  return (
    <StoreContext.Provider key={store.userId} value={store}>
      <WriterOnly store={store}>{children}</WriterOnly>
    </StoreContext.Provider>
  );
}

/** One tab writes (see data/tabLock.ts); another tab says so instead of losing answers. */
function WriterOnly({ store, children }: { store: Store; children: ReactNode }) {
  const writer = useSyncExternalStore(store.onWriterChange, store.isWriter);
  if (writer) return children;
  return (
    <div className="other-tab" role="status">
      <p>Perennial is open in another tab. Use that tab, or close it and reload here.</p>
      <button className="primary" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}

function ReloadBanner() {
  const refused = useRefused().count > 0;
  const [needed, setNeeded] = useState(reloadNeeded.needed);
  useEffect(() => {
    const on = () => setNeeded(true);
    if (reloadNeeded.needed) on();
    reloadNeeded.addEventListener("reload", on);
    return () => reloadNeeded.removeEventListener("reload", on);
  }, []);
  if (!needed) return null;
  return (
    <div className="toast" role="status">
      <span>A new version of Perennial is ready.{!refused && " Your answers are saved."}</span>
      <button className="ghost" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}

/** The deck could not load and no copy was kept (say, no connection when it was first needed). */
function DeckFailed({ lang }: { lang: string }) {
  return (
    <div className="page narrow deck-failed">
      <p className="error" role="alert">
        Could not load the {language(lang).name} words. Check your internet connection, then reload.
      </p>
      <button className="primary" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}

export default function App() {
  const { user, pending } = useUser();
  const [route, go] = useRoute();
  // Signing in, or linking an anonymous learner to an account, changes the
  // user: start clean with a reload. Queued writes belong to their user: an
  // anonymous learner's move to the account they sign in to, a signed-out
  // learner's are dropped (see data/device.ts). Signing out does not reload:
  // the landing page shows at once, not after a blank page (#682). A user
  // after that still reloads: this page's boot answer was the old user's.
  const lastUser = useRef<string | null | undefined>(undefined);
  const hadUser = useRef(false);
  useEffect(() => {
    if (pending) return;
    const id = user?.id ?? null;
    if (id !== null && hadUser.current && id !== lastUser.current) location.reload();
    lastUser.current = id;
    if (id) {
      hadUser.current = true;
      identify(id);
    }
  }, [user?.id, pending]);
  // Signed out: delete what earlier learners left on this device (see device.ts).
  useEffect(() => {
    if (!pending && !user) void cleanUpForgotten();
  }, [pending, user]);
  if (pending) return <Settling />;
  if (!user) return <Onboarding signedIn={false} onStarted={() => go("/today", { replace: true })} />;
  return (
    <StoreProvider key={user.id} userId={user.id} email={user.email}>
      {/* While a screen's chunk loads (ui/screens.ts). Below the store, so its effects stay up. Tab changes are transitions, so they keep the old screen up instead. */}
      <Suspense fallback={<Settling />}>
        <Main route={route} go={go} />
      </Suspense>
      <ReloadBanner />
      <RefusedBanner />
    </StoreProvider>
  );
}

function Main({ route, go }: { route: Route; go: (to: Route, opts?: { replace?: boolean }) => void }) {
  const { user } = useUser();
  const { courses, ready } = useCourses();
  const [chosen, setChosen] = useState(readCourse);
  const [sessionMinutes, setSessionMinutes] = useState<number | null>(null);
  const [startError, setStartError] = useState("");
  const course = courses.find((c) => c.lang === chosen) ?? courses[0];
  const { failed: wordsFailed } = useDeck(course?.lang);
  // Asked for here, so the sentences come right after the words, whatever screen is open (#608).
  const { failed: sentencesFailed } = useDeckSentences(course?.lang);
  // Cards, reading and the word page need the sentences: without them they would wait forever.
  const deckFailed = wordsFailed || sentencesFailed;
  const store = useStore();
  const choose = (lang: string) => {
    setChosen(lang);
    keepCourse(lang);
  };
  const { lang: starting, saved } = useStartingCourse();
  useEffect(() => {
    if (course && starting) courseArrived();
  }, [course, starting]);
  // Written straight to the server, not through the store: read it from there.
  useEffect(() => {
    if (saved && !course) void store.refetchAll();
  }, [saved, course, store]);

  // Still loading, or a course was just started and is on its way: not the landing page.
  if (!course && (!ready || starting)) return <Settling />;
  if (!course)
    return (
      <Onboarding
        signedIn
        onStarted={(lang) => {
          choose(lang);
          go("/today", { replace: true });
        }}
      />
    );
  const lang = course.lang;
  /** Start a course in another language: from the language menu. */
  const startAnother = (l: string) => {
    setStartError("");
    const previous = course.lang;
    // Refused (by the server, or another tab is the writer): the new course is
    // rolled back, so go back to the one they came from and say why.
    // Counted once the server has it (offline: when the queue sends it). A tab closed
    // before then loses the event, though the course is still sent: a slight undercount.
    void saveCourse(store, l, {}).then(
      () => track("course_started", { lang: l, another: true }),
      (e) => {
        console.error("course not saved", e);
        choose(previous);
        setStartError(`Could not start ${language(l).name}. Please try again later.`);
      },
    );
    choose(l);
    go("/today");
  };
  // Every screen but Settings needs the deck: without it they would wait forever.
  // The top bar stays, so the learner can still switch language or open Settings.
  const noDeck = deckFailed && route !== "/settings";

  if (route === "/session" && !noDeck)
    // No minutes chosen: the page was reloaded on the session screen, so a fresh 5 minutes.
    return <SessionScreen lang={lang} minutes={sessionMinutes ?? DAILY_MINUTES} onExit={() => go("/today", { replace: true })} onWalk={() => go("/garden", { replace: true })} />;

  if (route === "/garden" && !noDeck)
    return (
      <LearnerGardenWalk
        lang={lang}
        onExit={() => (history.length > 1 ? history.back() : go("/today", { replace: true }))}
        onWater={(m) => {
          setSessionMinutes(m);
          go("/session");
        }}
      />
    );

  return (
    <div className="app">
      <nav className="top">
        {/* Learners click the logo to go home, as on most sites. */}
        <a
          className="wordmark"
          href="#/today"
          aria-label="Perennial: go to Today"
          onClick={(e) => {
            e.preventDefault();
            go("/today");
          }}
        >
          <SproutMark /> perennial
        </a>
        <CourseSwitcher
          courses={courses}
          current={lang}
          onSwitch={(l) => {
            setStartError("");
            choose(l);
            go("/today");
          }}
          onStart={startAnother}
        />
        <div className="tabs" role="tablist" onKeyDown={arrowKeys}>
          {TABS.map((t) => {
            const on = route === t.route || (t.route === "/words" && route === "/words/add");
            return (
              <button key={t.route} role="tab" aria-selected={on} tabIndex={on ? 0 : -1} className={on ? "tab on" : "tab"} onClick={() => go(t.route)}>
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </div>
        {/* From the first day on: a learner with an account elsewhere signs in here, and their garden so far comes along (data/auth.ts). Settings holds the form. */}
        {user?.anonymous && route !== "/settings" && (
          <button className="secondary top-signin" onClick={() => go("/settings")}>
            Sign in
          </button>
        )}
      </nav>
      {startError && (
        <p className="error" role="alert">
          {startError}
        </p>
      )}
      {noDeck && <DeckFailed lang={lang} />}
      {route === "/today" && !noDeck && (
        <Home
          lang={lang}
          onStart={(m) => {
            setSessionMinutes(m);
            go("/session");
          }}
          onWalk={() => go("/garden")}
        />
      )}
      {(route === "/words" || route === "/words/add") && !noDeck && <WordsScreen lang={lang} adding={route === "/words/add"} onAdd={() => go("/words/add")} onBack={() => go("/words")} />}
      {route === "/settings" && <SettingsScreen lang={lang} onSignedOut={() => void signOut()} />}
    </div>
  );
}
