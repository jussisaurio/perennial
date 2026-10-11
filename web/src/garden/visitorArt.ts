// Pixel art for the garden visitors, as character maps: each letter is a
// colour from the palette, "." is clear. Drawn into canvas textures for the
// walk (textures.ts) and as SVG rects in the 2D strip (Garden.tsx), so both
// show the same animals.

export interface PixelArt {
  rows: string[];
  pal: Record<string, string>;
}

const INK = "#3a2416";

export const SNAIL: PixelArt = {
  rows: [
    "............o.o.",
    "............b.b.",
    "....oooo....b.b.",
    "...osSSso...b.b.",
    "..osSddSso..bbb.",
    "..oSdSsdSo.bbbb.",
    "..oSdSddSo.bbeb.",
    "..osdssdso.bbbb.",
    "...osssso.bbbb..",
    ".bbbooooobbbbb..",
    "BBBBBBBBBBBBBB..",
  ],
  pal: { o: INK, s: "#c0703a", S: "#e6a060", d: "#8a4a24", b: "#d8c8a0", B: "#a89870", e: INK },
};

const CAT_ROWS = [
  "..o..o..................",
  ".oCooCo.................",
  ".oCCCCo......ooooooo....",
  "oCCCCCCooooooCCtCCtCoo..",
  "oCCCCCCCCCCCCtCCtCCCCCo.",
  "oC12C34CCCCCCCtCCtCCCCo.",
  "oCCCpCCCCCCCCCCCCCCCCCCo",
  ".owwwwCCCCtCCtCCtCCCCCCo",
  ".oowwCCCCCCCCCCCCCCCCCCo",
  "oCCCCCCCCCCCCCCCCCCCCCo.",
  "oCtCtCCooooooooooooooo..",
  ".oooooo.................",
];
const CAT_PAL = { o: INK, C: "#e08a3c", t: "#b0602a", w: "#fff4e0", p: "#e88a8a" };

/** Curled up asleep, head on the left. */
export const CAT_ASLEEP: PixelArt = { rows: CAT_ROWS, pal: { ...CAT_PAL, "1": INK, "2": INK, "3": INK, "4": INK } };
/** The same cat with one eye open (two green pixels). */
export const CAT_AWAKE: PixelArt = {
  rows: CAT_ROWS.map((r, y) => (y === 4 ? r.slice(0, 5) + "3" + r.slice(6) : r)),
  pal: { ...CAT_PAL, "1": INK, "2": INK, "3": "#9ad050", "4": INK },
};

export const TOADSTOOL: PixelArt = {
  rows: [
    ".....oooooo.....",
    "...ooRRRRwwoo...",
    "..oRRwwRRRRRRo..",
    ".oRRRwwRRRRwwRo.",
    ".oRRRRRRRRRwwRo.",
    "oRRwwRRRRRRRRRRo",
    "oRRwwRRRwwRRRRRo",
    "oDDDDDDDDDDDDDDo",
    ".oooommmmmmoooo.",
    ".....mMMMmm.....",
    ".....mMMMmm.....",
    "....omMMMmmo....",
    "....mMMMMmmm....",
    "...gGgggGggGg...",
  ],
  pal: { o: "#5a1e14", R: "#d9443d", D: "#9c2c28", w: "#fff8e7", m: "#d8ccae", M: "#f6eedc", g: "#4e9140", G: "#72b85a" },
};

const BIRD_PAL = { o: INK, B: "#8a5a34", b: "#a8764a", R: "#e0703a", y: "#f0b030", e: "#111111", k: "#5a3a20" };

/** A small brown bird with an orange breast, perched. */
export const BIRD: PixelArt = {
  rows: [
    "....ooo.......",
    "...oBBBo......",
    "..oBeBBBo.....",
    "yyoBBBBBBoo...",
    "..oRRBbbBBBoo.",
    "..oRRRBbbBBBBo",
    "...oRRBBBBBoo.",
    "....oooooooo..",
    ".....k..k.....",
    ".....k..k.....",
  ],
  pal: BIRD_PAL,
};

/** The bird mid-hop, wings up. */
export const BIRD_HOP: PixelArt = {
  rows: [
    "......ob......",
    ".....obbo.....",
    "....ooobboo...",
    "...oBBBobBo...",
    "..oBeBBBoo....",
    "yyoBBBBBBoo...",
    "..oRRBBBBBBoo.",
    "..oRRRBBBBBBBo",
    "...oRRBBBBBoo.",
    "....oooooooo..",
    ".....k...k....",
  ],
  pal: BIRD_PAL,
};

/** One rect per run of same-coloured pixels in a row: few elements for SVG. */
export function runs(art: PixelArt): { x: number; y: number; w: number; fill: string }[] {
  const out: { x: number; y: number; w: number; fill: string }[] = [];
  art.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const fill = art.pal[row[x]];
      let w = 1;
      while (x + w < row.length && row[x + w] === row[x]) w++;
      if (fill) out.push({ x, y, w, fill });
      x += w;
    }
  });
  return out;
}
