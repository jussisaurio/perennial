import { useEffect, useRef } from "react";

/** A single-key shortcut for a screen. Ignored while typing in a field, with a
 *  modifier held, or when the key would activate a focused button or link. */
export function useShortcut(key: string, run: () => void) {
  const ref = useRef(run);
  useEffect(() => {
    ref.current = run;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== key || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable], button, a, summary, [role=dialog]")) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key]);
}
