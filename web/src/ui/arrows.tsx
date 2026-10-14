import type { KeyboardEvent } from "react";

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Arrow keys move focus among the radios, tabs or menu items inside the
 * element, as a screen reader user expects (#266). On a radio or a tab the
 * move also chooses it, as with the browser's own radio buttons.
 */
export function arrowKeys(e: KeyboardEvent<HTMLElement>) {
  const step = STEP[e.key];
  if (!step) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=radio], [role=tab], [role^=menuitem]")];
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return; // focus is on something else inside, such as the language menu's "Start" question
  e.preventDefault();
  const next = items[(at + step + items.length) % items.length];
  next.focus();
  if (!next.getAttribute("role")!.startsWith("menuitem")) next.click();
}

/** A row of chips with one chosen: a radio group, one Tab stop, arrow keys to change it. */
export function RadioChips<T extends string | boolean>({ label, options, value, onChange, className }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={className ? `chips ${className}` : "chips"} role="radiogroup" aria-label={label} onKeyDown={arrowKeys}>
      {options.map(([v, text]) => (
        <button key={String(v)} role="radio" aria-checked={value === v} tabIndex={value === v ? 0 : -1} className={value === v ? "chip on" : "chip"} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}
