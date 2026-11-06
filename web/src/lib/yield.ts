/**
 * Lets the browser paint and handle input. scheduler.yield resumes this work
 * ahead of other queued tasks; where it is missing (Safari, for one), a new
 * task via setTimeout does the same, only queued last.
 */
export function yieldToBrowser(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return s?.yield ? s.yield() : new Promise((r) => setTimeout(r, 0));
}
