/**
 * Lets the browser paint and handle input. scheduler.yield resumes this work
 * ahead of other queued tasks; where it is missing (Safari, for one), a new
 * task via setTimeout does the same, only queued last.
 */
export function yieldToBrowser(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return s?.yield ? s.yield() : new Promise((r) => setTimeout(r, 0));
}

/** Run a generator's steps all at once. */
export function runAll<T>(steps: Generator<void, T>): T {
  for (;;) {
    const s = steps.next();
    if (s.done) return s.value;
  }
}

/** Under the 10 ms task budget at CPU 10× (perf/ui.ts), with room for the rest of the task. */
const SLICE_MS = 5;

/** Run a generator's steps in slices of about SLICE_MS, letting the browser paint and handle input between them. */
export async function inSlices<T>(steps: Generator<void, T>): Promise<T> {
  let start = performance.now();
  for (;;) {
    const s = steps.next();
    if (s.done) return s.value;
    if (performance.now() - start > SLICE_MS) {
      await yieldToBrowser();
      start = performance.now();
    }
  }
}
