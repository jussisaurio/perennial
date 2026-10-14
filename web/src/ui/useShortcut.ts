import { useEffect, useLayoutEffect, useRef } from "react";

/** True for keys that belong to the browser, the OS or a text field, not to a shortcut. */
function notForUs(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return true;
  const el = e.target as HTMLElement | null;
  return !!el?.closest?.("input, textarea, select, [contenteditable]");
}

// Whether the focused element got focus from the keyboard (#256). Not
// :focus-visible: Chrome marks a clicked button with it at the next key press.
// A pointer press clears it, even on a button that already had focus, and focus
// that lands where the pointer went down came from the pointer.
let keyboardFocus = false;
let pressed: Node | null = null;
document.addEventListener(
  "pointerdown",
  (e) => {
    pressed = e.target as Node;
    keyboardFocus = false;
  },
  true,
);
// A key press ends the pointer's claim: Tab back onto the clicked button is keyboard focus.
document.addEventListener("keydown", () => (pressed = null), true);
document.addEventListener("focusin", (e) => {
  keyboardFocus = !(pressed && (e.target as Node).contains(pressed));
});

/** True when Space or Enter would press a button or link the learner reached
 *  with the keyboard: that key then belongs to the button (#256). A clicked
 *  button keeps focus too, but a mouse user's keys still mean the shortcuts. */
function pressesFocused(e: KeyboardEvent): boolean {
  if (e.key !== " " && e.key !== "Enter") return false;
  const el = e.target as HTMLElement | null;
  return keyboardFocus && !!el?.closest("button, a, summary");
}

/** A single-key shortcut for a screen. Ignored while typing in a field, with a
 *  modifier held, in a dialog, or when the key would press a focused button or link. */
export function useShortcut(key: string, run: () => void) {
  const ref = useRef(run);
  useEffect(() => {
    ref.current = run;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== key || notForUs(e) || pressesFocused(e)) return;
      if ((e.target as HTMLElement | null)?.closest("[role=dialog]")) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key]);
}

/** Several single-key shortcuts, keyed by `KeyboardEvent.key`. Ignored while
 *  typing in a field or with a modifier held, so Cmd/Ctrl+R still reloads, and
 *  when the key would press a focused button or link. */
export function useKeys(map: Record<string, () => void>) {
  const ref = useRef(map);
  useLayoutEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (notForUs(e) || pressesFocused(e)) return;
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
