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

const FROG_PAL = { o: INK, G: "#5aa83c", g: "#3e7e2c", L: "#cfe39a", W: "#fff8e7", E: INK, m: "#24461a", P: "#fffbe0" };
const FROG_ROWS = [
  "..ooo....ooo..",
  ".oWEWo..oWEWo.",
  ".oGGGGooGGGGo.",
  "oGGgGGGGGGgGGo",
  "oGGGGGGGGGGGGo",
  "oGmmmmmmmmmmGo",
  "oGGLLLLLLLLGGo",
  "oGgLLLLLLLLgGo",
  "oGGGoLLLLoGGGo",
  "oGGgoooooogGGo",
  ".oooo....oooo.",
];

/** A green frog sitting on a lily pad, looking at you. */
export const FROG: PixelArt = { rows: FROG_ROWS, pal: FROG_PAL };
/** The frog croaking: its throat puffs up pale. */
export const FROG_CROAK: PixelArt = {
  rows: FROG_ROWS.map((r, y) => (y === 6 || y === 7 || y === 8 ? "oPPPPPPPPPPPPo" : y === 9 ? "oGGgPPPPPPgGGo" : r)),
  pal: FROG_PAL,
};
/** Eyes closed: it talks in its sleep. */
export const FROG_ASLEEP: PixelArt = { rows: FROG_ROWS.map((r, y) => (y === 1 ? ".oGmGo..oGmGo." : r)), pal: FROG_PAL };

// The gnome: a red hat, a white beard, a blue coat. Column 15 holds its
// lantern (two pixels, "L"), hanging from the hand at column 14.
const GNOME_HAT = [".......oo.......", "......oRRo......", "......oRRo......", ".....oRRRRo.....", ".....oRRRRo.....", "....oRRRRRRo....", "....oRrRRRRo....", "...oRRRRRRRRo...", "...oDDDDDDDDo..."];
const GNOME_LEGS = [".oBBBBBBBBBBBBoL", ".oKKKKKKKKKKKKoL", ".oBBBBBBBBBBBBo.", "..oBBBBooBBBBo..", "..oNNNo..oNNNo..", "..ooooo..ooooo.."];
const GNOME_PAL = { o: INK, R: "#d63c32", r: "#ee6a50", D: "#9a2a24", S: "#f0c8a0", e: INK, p: "#e0907a", W: "#f6f1e8", H: "#d8cfbf", B: "#3e6eb8", K: "#5a3a20", N: "#6a4428" };
const gnome = (face: string[]): string[] => [...GNOME_HAT, ...face, ...GNOME_LEGS];
const GNOME_FRONT_ROWS = gnome([
  "...oSSSSSSSSo...",
  "...oSeSSSSeSo...",
  "...oWSSppSSWo...",
  "..oWWWWppWWWWo..",
  "..oWWWWWWWWWWo..",
  "..oBWWWWWWWWBo..",
  ".oBBBWWWWWWBBBo.",
  ".SBBBBWWWWBBBBS.",
]);
const GNOME_SIDE_ROWS = gnome([
  "...oSSSSSHHHo...",
  "...oSeSSSHHHo...",
  "..ppSSSSSHHHo...",
  "..oWWWWWBBBBo...",
  "..oWWWWWBBBBo...",
  "..oWWWWBBBBBo...",
  "..oWWWBBBBBBBo..",
  "..oSBBBBBBBBBBS.",
]);
/** The gnome facing you or looking away, with its lantern unlit (by day) or lit. */
export function gnomeArt(pose: "front" | "side", lit: boolean): PixelArt {
  const rows = { front: GNOME_FRONT_ROWS, side: GNOME_SIDE_ROWS }[pose];
  return { rows, pal: { ...GNOME_PAL, L: lit ? "#ffe680" : "#4a4048" } };
}

// A softer outline than the other visitors: the neck is thin, and black lines would hide it.
const HERON_PAL = { o: "#555e68", W: "#eef1f3", G: "#9aa4ad", g: "#6b7680", k: "#1a1d22", y: "#e0b040", e: "#1a1d22" };
const HERON_BODY = [
  "......ooo.......",
  ".....oWWWo......",
  "....oWeWWkkk....",
  "yyyyoWWWWo.kk...",
  ".....oWWWo......",
  "......oWWo......",
  "......oWWo......",
  ".......oWWo.....",
  ".......oWWo.....",
  "......oWWo......",
  "......oWWo......",
  ".....oWWGo......",
  ".....oWGGGoo....",
  "....oWGGGGGGoo..",
  "....oWGGgGGGGGo.",
  "....oWGGggGGGGGo",
  ".....oGGggggGGGo",
  ".....oGGGggggGo.",
  "......oGGGGGGgo.",
  ".......ooGGGgo..",
  "........o.oo....",
];
/** A tall grey heron standing still, looking left at the water. */
export const HERON: PixelArt = {
  rows: [...HERON_BODY, "........y.y.....", "........y.y.....", "........y.y.....", "........y.y.....", "........y.y.....", "........y.y.....", ".......yy.yy...."],
  pal: HERON_PAL,
};
/** Mid-step: one leg lifted and bent. */
export const HERON_STEP: PixelArt = {
  rows: [...HERON_BODY, "........y.y.....", "........y..y....", "........y...y...", "........y..y....", "........y.......", "........y.......", ".......yy......."],
  pal: HERON_PAL,
};

// Pale wings with darker edges, so it still shows against a lantern's glow.
const MOTH_PAL = { a: "#4a3c2e", o: "#4a3c2e", d: "#8a7656", M: "#f6eed6", m: "#a8946e" };
/** A pale moth, wings open. */
export const MOTH_OPEN: PixelArt = {
  rows: ["...a...a...", "....a.a....", ".dMMMoMMMd.", "dMMmMoMmMMd", "dMMMMoMMMMd", ".dMMMoMMMd.", "..dmd.dmd.."],
  pal: MOTH_PAL,
};
/** Wings up. */
export const MOTH_CLOSED: PixelArt = {
  rows: ["...a...a...", "....a.a....", "....MoM....", "....MoM....", "...dMoMd...", "....dod....", ".....o....."],
  pal: MOTH_PAL,
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
