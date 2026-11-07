import { useId, type KeyboardEvent, type ReactNode } from "react";
import { CheckIcon } from "./icons";

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

/**
 * One choice from a few, side by side: a radio group, one Tab stop, arrow keys to change it (#266).
 * The chosen option is raised and has a check, so color is not the only sign of it (WCAG 1.4.1, #678).
 */
export function Segmented<T extends string | boolean>({ label, options, value, onChange, className }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={className ? `segmented ${className}` : "segmented"} role="radiogroup" aria-label={label} onKeyDown={arrowKeys}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} tabIndex={value === v ? 0 : -1} className="segment" onClick={() => onChange(v)}>
          {value === v && <CheckIcon size={16} strokeWidth={2.4} />}
          <span>{text}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * A setting that is on or off, with an effect at once (WAI-ARIA APG switch pattern). The label says what
 * the setting does and never changes with the state. `blocked` is a reason from the device: the switch
 * then shows off and does nothing, and stays focusable so a screen reader still hears why.
 */
export function Switch({ label, on, onChange, help, blocked }: { label: string; on: boolean; onChange: (on: boolean) => void; help: ReactNode; blocked?: string }) {
  const id = useId();
  const checked = on && !blocked;
  return (
    <div className="form">
      <button type="button" role="switch" className="switch-row" aria-checked={checked} aria-disabled={!!blocked} aria-describedby={id} onClick={() => !blocked && onChange(!on)}>
        <span>{label}</span>
        <span className="switch" aria-hidden="true">
          <span className="switch-thumb">{checked && <CheckIcon size={14} strokeWidth={2.6} />}</span>
        </span>
      </button>
      <p className="muted small" id={id}>
        {help}
        {blocked && ` ${blocked}`}
      </p>
    </div>
  );
}
