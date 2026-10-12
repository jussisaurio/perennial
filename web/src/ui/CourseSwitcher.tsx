// The language in the top bar: a garden per language. Switch to one you have,
// or plant a new one. Courses are never deleted (a garden left alone just
// waits), so starting one asks once. Nothing to choose: a plain label.

import { useEffect, useRef, useState } from "react";
import { COURSE_LANGUAGES, language } from "../content/languages";
import type { CourseRow } from "../data/rows";
import { SproutMark } from "./icons";

export function CourseSwitcher({ courses, current, onSwitch, onStart }: { courses: CourseRow[]; current: string; onSwitch: (lang: string) => void; onStart: (lang: string) => void }) {
  const [open, setOpen] = useState(false);
  // A language waiting for "yes, start it".
  const [asking, setAsking] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // The path, not the target: a click that swaps the menu's content leaves its target detached.
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !e.composedPath().includes(root.current!)) setOpen(false);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const have = new Set(courses.map((c) => c.lang));
  const mine = COURSE_LANGUAGES.filter((l) => have.has(l.code));
  const others = COURSE_LANGUAGES.filter((l) => !have.has(l.code));
  const name = language(current).name;
  if (mine.length <= 1 && others.length === 0) return <span className="course-switch-label">{name}</span>;

  const done = (fn: (lang: string) => void, lang: string) => {
    setOpen(false);
    fn(lang);
  };

  return (
    <div className="course-switch" ref={root}>
      <button
        className="course-switch-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setAsking(null);
          setOpen(!open);
        }}
      >
        {name}
        <span aria-hidden className="caret">
          ▾
        </span>
      </button>
      {open && (
        <div className="course-menu" role="menu" aria-label="Your languages">
          {asking ? (
            <div className="course-ask">
              <p>
                Start {language(asking).name}? It gets its own garden, from the first word. Your {name} garden stays as it is.
              </p>
              <div className="row">
                <button className="primary small" onClick={() => done(onStart, asking)}>
                  Start {language(asking).name}
                </button>
                <button className="ghost small" onClick={() => setAsking(null)}>
                  Not now
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="course-menu-head">{mine.length > 1 ? "Your gardens" : "Your garden"}</p>
              {mine.map((l) => (
                <button key={l.code} role="menuitemradio" aria-checked={l.code === current} className="course-item" onClick={() => done(onSwitch, l.code)}>
                  <span>{l.name}</span>
                  {l.code === current && <span className="muted small">here now</span>}
                </button>
              ))}
              {others.length > 0 && <p className="course-menu-head">Plant a new one</p>}
              {others.map((l) => (
                <button key={l.code} role="menuitem" className="course-item" onClick={() => setAsking(l.code)}>
                  <span>
                    <SproutMark size={14} /> {l.name}
                  </span>
                  <span className="muted small">new</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
