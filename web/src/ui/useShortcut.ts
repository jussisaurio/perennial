import { useEffect, useLayoutEffect, useRef } from "react";

/** True for keys that belong to the browser, the OS or a text field, not to a shortcut. */
function notForUs(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return true;
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.("input, textarea, select, [contenteditable]");
}

/** A single-key shortcut for a screen. Ignored while typing in a field, with a
 *  modifier held, or when the key would activate a focused button or link. */
export function useShortcut(key: string, run: () => void) {
  const ref = useRef(run);
  useEffect(() => {
    ref.current = run;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== key || notForUs(e)) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("button, a, summary, [role=dialog]")) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key]);
}

/** Several single-key shortcuts, keyed by `KeyboardEvent.key`. Ignored while
 *  typing in a field or with a modifier held, so Cmd/Ctrl+R still reloads. */
export function useKeys(map: Record<string, () => void>) {
  const ref = useRef(map);
  useLayoutEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (notForUs(e)) return;
      const fn = ref.current[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
