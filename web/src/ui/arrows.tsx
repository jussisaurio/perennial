import type { KeyboardEvent } from "react";

const ACROSS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
const ANY: Record<string, number> = { ...ACROSS, ArrowDown: 1, ArrowUp: -1 };

/**
 * Arrow keys move focus among the radios, tabs or menu items inside the
 * element, as a screen reader user expects (#266). A radio is also chosen as
 * it gets focus, as the browser's own radios are. A tab only gets focus, and
 * Enter or Space opens it: the Garden tab opens a full-screen walk without
 * the tab bar, so an arrow key must not take the learner there.
 */
export function arrowKeys(e: KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=radio], [role=tab], [role^=menuitem]")];
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return; // focus is on something else inside, such as the language menu's "Start" question
  const role = items[at].getAttribute("role")!;
  // The tabs are a row in the page header: Up and Down still scroll the page.
  const step = (role === "tab" ? ACROSS : ANY)[e.key];
  if (!step) return;
  e.preventDefault();
  const next = items[(at + step + items.length) % items.length];
  next.focus();
  if (role === "radio") next.click();
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
