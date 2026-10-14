// Writes the server refused for good (#253). They are gone from this device
// too, so every place that could say "saved" asks here first.

import { useState, useSyncExternalStore } from "react";
import { useStore } from "../data/learner";
import type { Refused } from "../data/store";
import { plural } from "./format";

export function useRefused(): Refused {
  const store = useStore();
  return useSyncExternalStore(store.onRefused, store.refused);
}

/** What was lost, and what the learner can do about it. */
export function refusedLine(r: Refused): string {
  const n = (one: string) => `${plural(r.count, one)} ${r.count === 1 ? "was" : "were"}`;
  // The server refuses answers dated more than a day ahead of its own clock.
  if (r.code === "review_from_the_future") return `${n("answer")} not saved, because the date or time on this device is wrong. Set the correct date and time, then answer again.`;
  return `${n("change")} not saved. The server did not accept ${r.count === 1 ? "it" : "them"}.`;
}

/** Says so on any screen, when it happens. OK hides it until the next refusal. */
export function RefusedBanner() {
  const r = useRefused();
  const [seen, setSeen] = useState(0);
  if (r.count === seen) return null;
  return (
    // A status, like the other toast: a screen that reports its own failed write (starting a course) keeps the one alert.
    <div className="toast" role="status">
      <span>{refusedLine(r)}</span>
      <button className="ghost" onClick={() => setSeen(r.count)}>
        OK
      </button>
    </div>
  );
}
