// Writes the server refused for good (#253). They are gone from this device
// too, so every place that could say "saved" asks here first.

import { useLayoutEffect, useSyncExternalStore } from "react";
import { useStore } from "../data/learner";
import type { Refused } from "../data/store";
import { refusedLine } from "./format";

export function useRefused(): Refused {
  const store = useStore();
  return useSyncExternalStore(store.onRefused, store.refused);
}

/**
 * The line, in place on a screen that has room for it (the session, Settings):
 * the toast then stays away, so it is not said twice or over the answer buttons.
 * `since`: count only refusals after this point (a session chunk's start).
 */
export function RefusedLine({ since }: { since?: Pick<Refused, "count" | "clock" | "gardenClock"> }) {
  const store = useStore();
  const r = useRefused();
  // No `since`: every refusal so far.
  const lost = { count: r.count - (since?.count ?? 0), clock: r.clock - (since?.clock ?? 0), gardenClock: r.gardenClock - (since?.gardenClock ?? 0) };
  // Before paint, so the toast never shows for a moment first.
  useLayoutEffect(() => {
    if (lost.count) store.seeRefused();
  }, [store, lost.count]);
  if (!lost.count) return null;
  return (
    <p className="error refused" role="status">
      {refusedLine(lost)}
    </p>
  );
}

/** Says so on any other screen, when it happens. OK hides it until the next refusal. */
export function RefusedBanner() {
  const store = useStore();
  const r = useRefused();
  if (r.count === r.seen) return null;
  return (
    // A status, like the other toast: a screen that reports its own failed write (starting a course) keeps the one alert.
    <div className="toast" role="status">
      <span>{refusedLine(r)}</span>
      <button className="ghost" onClick={store.seeRefused}>
        OK
      </button>
    </div>
  );
}
