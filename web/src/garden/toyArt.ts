// Pixel art for the lawn and pond toys (#360), in visitorArt.ts's style: a
// dandelion clock, fluffy and blown. Drawn into the walk's toy atlas
// (textures.ts toyAtlas). The paper boat is drawn with its word (textures.ts boat).

import type { PixelArt } from "./visitorArt";

const PAL = { w: "#d8d4ca", W: "#fbfaf4", c: "#c8b878", C: "#a08a50", s: "#5a8a3a", L: "#3e7a2c", l: "#6aac44" };

/** The stem and the leaves at its foot, under the head. */
const STEM = [
  "......s......",
  "......s......",
  "......s......",
  "......s......",
  ".......s.....",
  ".......s.....",
  "..LL...s..LL.",
  "...LL..s.LL..",
  "..LlLL.sLLlL.",
  "...LLlLsLlL..",
  "....LLLsLL...",
];

/** A dandelion clock: a round white puff of seeds on its stem. */
export const CLOCK: PixelArt = {
  rows: [
    "....w.w.w....",
    "..w.wWwWw.w..",
    ".wWwWWWWWwWw.",
    "..WWWWWWWWW..",
    "wwWWWcCcWWWww",
    "..WWWWCWWWW..",
    ".wWwWWWWWwWw.",
    "..w.wWwWw.w..",
    "....w.wsw....",
    ...STEM,
  ],
  pal: PAL,
};

/** The same clock blown: only the bare seed bed is left on the stem. */
export const BLOWN: PixelArt = {
  rows: [".............", ".............", ".............", ".............", ".............", ".............", ".....cCc.....", "....cCCCc....", ".....sCs.....", ...STEM],
  pal: PAL,
};
