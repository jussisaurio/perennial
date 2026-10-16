// Pixel art for leave it out (#351), in visitorArt.ts's style: the bowl, the
// basket and what it offers, what the guests leave, and their prints. Drawn
// into the walk's textures (textures.ts leaveAtlas, prints) and, for what you
// hold, into the page (GardenWalk.tsx). The guests themselves are in visitorArt.ts.

import type { Find, FruitKind, Guest } from "./leave";
import { TREE_SHAPES } from "./orchardArt";
import type { PixelArt } from "./visitorArt";

const INK = "#3a2416";

const BOWL_PAL = { o: INK, C: "#c46a3c", c: "#e08a54", d: "#6a3018", y: "#efcf86", Y: "#c89a50" };
/** The bowl's body, under its rim. */
const BOWL_BODY = ["oCcCCCCCCCCCCo", ".oCCCCCCCCCCo.", "..oCCCCCCCCo..", "...oooooooo..."];

/** A clay bowl on the ground, empty: its dark inside shows. */
export const BOWL: PixelArt = { rows: ["..oooooooooo..", ".oddddddddddo.", ...BOWL_BODY], pal: BOWL_PAL };
/** The bowl with crumbs heaped in it. */
export const BOWL_CRUMBS: PixelArt = { rows: ["....y.Y.y.....", "..oyYyyYyYyo..", ".oyYyYyyYyYyo.", ...BOWL_BODY], pal: BOWL_PAL };

/** A fruit, round, with a stem and a leaf, in its tree's colours (orchardArt.ts). */
export function fruitArt(kind: FruitKind): PixelArt {
  const [light, dark] = TREE_SHAPES[kind].fruit.color;
  return { rows: ["...s...", "..sg...", ".oLLLo.", "oLwLLDo", "oLLLLDo", "oLLLDDo", ".ooooo."], pal: { o: INK, s: "#5a3a20", g: "#5aa83c", L: light, D: dark, w: "#fff8e7" } };
}

/** The bowl with a fruit in it. */
export function bowlFruitArt(kind: FruitKind): PixelArt {
  const f = fruitArt(kind);
  // The fruit's lower rows sink into the bowl.
  const fruit = f.rows.slice(0, 5).map((r) => `...${r}....`);
  return { rows: [...fruit, ".oddddddddddo.", ...BOWL_BODY], pal: { ...BOWL_PAL, ...f.pal, o: INK } };
}

/** A small paper bag of bread crumbs, its top rolled down. */
export const CRUMB_BAG: PixelArt = {
  rows: ["..yY.y....", ".oooooooo.", ".oPPPPPPo.", "oPpPPPPPPo", "oPPPPPpPPo", "oPPPPPPPPo", "oPPpPPPPPo", "oPPPPPPPPo", ".oooooooo."],
  pal: { o: "#6a4a2a", P: "#d8b47c", p: "#b8925a", y: "#efcf86", Y: "#c89a50" },
};

/** A wicker basket with a handle. */
export const BASKET: PixelArt = {
  rows: [
    "....oooooooo....",
    "...o........o...",
    "..o..........o..",
    "oooooooooooooooo",
    "oWwWwWwWwWwWwWwo",
    "owWwWwWwWwWwWwWo",
    "oWwWwWwWwWwWwWwo",
    ".owWwWwWwWwWwWo.",
    "..oooooooooooo..",
  ],
  pal: { o: "#5a3a1a", W: "#c8964e", w: "#a0703a" },
};

/** What the guests leave (leave.ts FINDS). */
export const FIND_ART: Record<Find, PixelArt> = {
  feather: {
    rows: ["....oo", "...oFo", "..oFfo", "..oFfo", ".oFfo.", ".oFfo.", "oFfo..", "oFo...", "oo....", ".s....", "s....."],
    pal: { o: "#5a4a3a", F: "#e4d8c0", f: "#a08a6a", s: "#6a5a44" },
  },
  acorn: {
    rows: ["..s...", ".oooo.", "oCcCCo", "oooooo", "oNNNNo", "oNnNNo", ".oNNo.", "..oo.."],
    pal: { o: INK, s: "#5a3a20", C: "#8a6a3c", c: "#6e522c", N: "#c08a4a", n: "#e8bc7a" },
  },
  button: {
    rows: [".oooo.", "oBBBBo", "oBkBko", "oBBBBo", "oBkBko", ".oooo."],
    pal: { o: "#24406e", B: "#4a7ad8", k: "#24406e" },
  },
  bone: {
    rows: [".oo......oo.", "oWWo....oWWo", ".oWWWWWWWWo.", "oWWo....oWWo", ".oo......oo."],
    pal: { o: "#8a7a60", W: "#f4ecda" },
  },
  leaf: {
    rows: ["....o...", "...oRo..", "..oRrRo.", ".oRRrRRo", "oRRRrRRo", ".oRRrRo.", "..oRro..", "...s...."],
    pal: { o: "#7a2a12", R: "#e0602e", r: "#a8381a", s: "#5a3a20" },
  },
  ribbon: {
    rows: ["oo.....oo", "oBo...oBo", ".oBo.oBo.", "..oBBBo..", ".oBo.oBo.", "oBo...oBo", "oo.....oo"],
    pal: { o: "#1e3a7a", B: "#4a7ae0" },
  },
};

/** A guest's prints on the path, seen from above, toes up (the way it went). "#" is a print. */
export const PRINT_ROWS: Record<Guest, readonly string[]> = {
  sparrow: ["#.#.#", ".###.", "..#..", "..#.."],
  mouse: ["#.#", ".#."],
  dog: [".#.#.", "#...#", ".###.", ".###."],
  hedgehog: ["#.#.#", ".###.", ".###."],
  fox: [".#.#.", "#...#", ".###.", "..#.."],
};
