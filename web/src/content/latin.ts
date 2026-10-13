// Latin names for known words (#212): deadpan botanical names, shown in the
// field guide. Flavour only: never in sessions or reviews. Loaded when the
// field guide asks, so they cost nothing elsewhere.

import { useEffect, useState } from "react";

const loaders = import.meta.glob<Record<string, string>>("../../../decks/*/latin.json", { import: "default" });

/** A course's names by "lemma|pos", or null while they load (or for a course with none). */
export function useLatinNames(lang: string): Record<string, string> | null {
  const [names, setNames] = useState<{ lang: string; names: Record<string, string> } | null>(null);
  useEffect(() => {
    const load = loaders[`../../../decks/${lang}/latin.json`];
    // A course with no names file shows none: they are flavour, not content.
    if (!load) return;
    let alive = true;
    load().then(
      (n) => alive && setNames({ lang, names: n }),
      // Flavour, not content: a page without its Latin name is still complete, so a note in the log is enough.
      (e: unknown) => console.warn("[latin] names did not load", e),
    );
    return () => {
      alive = false;
    };
  }, [lang]);
  return names?.lang === lang ? names.names : null;
}
