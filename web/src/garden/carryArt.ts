// The pebble you carry (#358, garden/carry.ts) as a paper cut-out (#1091),
// in visitorArt.ts's style. Drawn into the walk's texture (textures.ts
// carryAtlas) and, while you hold it, into the page (GardenWalk.tsx), so both
// show the same pebble.

import { flat, line, oval, type Cutout } from "./visitorArt";

const BODY = oval(4, 3, 3.4, 2.4);

/** Round, blue-grey and outlined, with a shine: not one of the path's grey specks. */
export const PEBBLE: Cutout = {
  w: 8,
  h: 6,
  pieces: [
    flat(BODY, "#a4aeb8"),
    // Its shade: the lower part, under a curve.
    flat("M0.6 3 C0.6 4.33 2.12 5.4 4 5.4 C5.88 5.4 7.4 4.33 7.4 3 Q5 4.5 0.6 3 Z", "#78828c"),
    flat(oval(3.2, 1.9, 1.1, 0.6), "#e8eef2"),
    line(BODY, "#33383e", 0.4),
  ],
};
