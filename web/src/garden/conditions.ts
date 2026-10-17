// What the walk-in garden is like right now (#324): everything a part or a
// visitor may react to besides the frame. Parts and visitors read only this,
// never the clock. The learner picks the time of day; weather and the season
// will join it here.

import type { TimeOfDay } from "./scene";

export interface Conditions {
  time: TimeOfDay;
  /** Dusk or night: lanterns lit, fireflies, the moth, the frog awake. */
  dark: boolean;
  /** Night only: the moon, the sleeping bloom's z's; the butterflies gone. */
  night: boolean;
}

export function conditions(time: TimeOfDay): Conditions {
  return { time, dark: time !== "day", night: time === "night" };
}
