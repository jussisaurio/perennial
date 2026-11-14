// The pebble you carry (#358, garden/carry.ts) as a paper cut-out (#1091),
// in visitorArt.ts's style. Drawn into the walk's texture (textures.ts
// carryAtlas) and, while you hold it, into the page (GardenWalk.tsx), so both
// show the same pebble.

import { flat, oval, part, type Cutout } from "./visitorArt";

const BODY = oval(4, 3, 3.4, 2.4);

/** Round and blue-grey, its lower half a shade darker, with a shine: a cut-out with its own pale edge, not one of the path's grey specks. */
export const PEBBLE: Cutout = {
  w: 8,
  h: 6,
  pieces: [
    part(BODY, "#a4aeb8"),
    // Its shade: the lower part, under a curve.
    flat("M0.6 3 C0.6 4.33 2.12 5.4 4 5.4 C5.88 5.4 7.4 4.33 7.4 3 Q5 4.5 0.6 3 Z", "#87919b"),
    // Its shine: a thin sliver of paler card along its top.
    flat("M1.5 2.4 C2.1 1.3 3.5 0.95 5.2 1.05 C3.9 1.35 2.6 1.75 1.5 2.4 Z", "#dce3e8"),
  ],
};
