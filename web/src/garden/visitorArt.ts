// Pixel art for the garden visitors, as character maps: each letter is a
// colour from the palette, "." is clear. Drawn into canvas textures for the
// walk (textures.ts) and as SVG rects in the 2D strip (Garden.tsx), so both
// show the same animals.

import type { GardenWord } from "../deck/schema";

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
/** The snail gone into its shell (#377): only the edge of its foot shows. */
export const SNAIL_SHELL: PixelArt = {
  rows: SNAIL.rows.map((r, y) => (y < 9 ? r.slice(0, 10) + "......" : y === 9 ? "..bbooooob......" : "..BBBBBBBB......")),
  pal: SNAIL.pal,
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

/** The cat's right ear flicked flat (#377): asleep, and awake with one eye open. */
const earFlat = (rows: readonly string[]) => rows.map((r, y) => (y === 0 ? "..o..." + r.slice(6) : y === 1 ? ".oCo.oo" + r.slice(7) : r));
export const CAT_EAR: PixelArt = { rows: earFlat(CAT_ASLEEP.rows), pal: CAT_ASLEEP.pal };
export const CAT_EAR_AWAKE: PixelArt = { rows: earFlat(CAT_AWAKE.rows), pal: CAT_AWAKE.pal };
/** The cat sitting up, facing you, staring (#377): its eyes look at the middle. */
export const CAT_STARE: PixelArt = {
  rows: [
    "o.......o..",
    "oo.....oo..",
    "oCo...oCo..",
    "oCCoooCCo..",
    "oCCCCCCCo..",
    "oC3eCe3Co..",
    "oCCCpCCCo..",
    ".owwwwwo...",
    "..oCCCo....",
    ".oCCCCCo...",
    "oCCtCtCCo..",
    "oCCCtCCCo..",
    "oCCCCCCCoo.",
    "oCwCCCwCoCo",
    "oCwCCCwCoCo",
    ".ooooooooo.",
  ],
  pal: { ...CAT_PAL, "3": "#9ad050", e: INK },
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

const DOG_PAL = { o: INK, B: "#c08a52", b: "#9a6636", E: "#6e4424", w: "#f4e6cc", n: INK, e: INK, R: "#d0503a" };
const DOG_ROWS = [
  "........oooooo....",
  ".......oBBBBBBo...",
  "......oEEBBBBBBo..",
  ".....oEEEBBBBeBo..",
  ".....oEEEBBBBBBooo",
  ".....oEEEBBBBBwwno",
  ".....oEEoBBBBwwwwo",
  "......ooBBBBwwwoo.",
  ".......oRRRRRRo...",
  "......oBBBBBwwo...",
  ".....oBBBBBBwwo...",
  "....oBBBBBBBwwo...",
  "...oBBBBBBBBwwo...",
  "...oBBbBBBBowwo...",
  "...oBBbBBwwowwo...",
  "...oooooooooooo...",
];

/** A tan dog sitting, facing right (it sits left of its plant, looking at it), its tail up. */
export const DOG: PixelArt = {
  rows: DOG_ROWS.map((r, y) => (y === 10 ? ".oo" + r.slice(3) : y === 11 ? ".oBo" + r.slice(4) : y === 12 ? "..o" + r.slice(3) : r)),
  pal: DOG_PAL,
};
/** The same dog, its tail swept down: two frames make a wag. */
export const DOG_WAG: PixelArt = {
  rows: DOG_ROWS.map((r, y) => (y === 13 ? ".ooo" + r.slice(4) : y === 14 ? "oBBB" + r.slice(4) : y === 15 ? "ooo" + r.slice(3) : r)),
  pal: DOG_PAL,
};

// A small round bowl: pale glass with a soft outline, water, one orange fish.
const BOWL_PAL = { o: "#5a7a90", g: "#e4f1f6", h: "#ffffff", W: "#8cc4dc", w: "#b4dcea", F: "#f08a3a", f: "#c8602a", e: INK, s: "#c8b48a" };
/** A tiny fishbowl with a goldfish: the fish's home in the strip, where there is no pond. */
export const FISHBOWL: PixelArt = {
  rows: [
    "...oooooooo...",
    "....oggggo....",
    "..oogggggggo..",
    ".ohgggggggggo.",
    "ohwwwwwwwwwwwo",
    "ohWWWWWWWWWWWo",
    "oWWWFFFWWfWWWo",
    "oWWFeFFFffWWWo",
    "oWWWFFFWWfWWWo",
    ".oWWWWWWWWWWo.",
    "..oosssssoo...",
    "....oooooo....",
  ],
  pal: BOWL_PAL,
};

/** A goldfish seen from above, head to the right: it swims in the pond in the walk. */
export const KOI: PixelArt = {
  rows: [
    "...........oo...",
    "T.....ooooFFoo..",
    "TT..ooFFFWWFFFo.",
    ".TTTFFFWWWFFFFeo",
    ".TTTFFFFWWFFFFeo",
    "TT..ooFFFFFWFFo.",
    "T.....ooooFFoo..",
    "...........oo...",
  ],
  pal: { o: "#a0502a", F: "#e8803c", W: "#f4e2c8", T: "#e8a060", e: INK },
};

/** The same goldfish from the side, head to the right: the one that jumps out of the pond (#364). */
export const LEAPING_FISH: PixelArt = {
  rows: [
    ".......oo.......",
    "......oFFo......",
    "T..ooooFFoooo...",
    "TToFFFFFFFFFFoo.",
    "TTFFFFFFFFFFFeFo",
    "TToWWWWWWWWWFFo.",
    "T..ooWWWWWWoo...",
    ".......oo.......",
  ],
  pal: KOI.pal,
};

const BUTTERFLY_PAL = { o: INK, a: INK, O: "#f0a040", d: "#c0602a", w: "#fff8e7", b: INK };
/** A butterfly resting, wings open: orange with dark edges and white spots. */
export const BUTTERFLY: PixelArt = {
  rows: [
    "...a.....a...",
    "....a...a....",
    ".ooo..b..ooo.",
    "oOOOoobooOOOo",
    "oOwOOoboOOwOo",
    "oOOOOoboOOOOo",
    ".odOOoboOOdo.",
    "..ooooboooo..",
    "..oOdobodOo..",
    "..oOOoboOOo..",
    "...oo.b.oo...",
  ],
  pal: BUTTERFLY_PAL,
};
/** Wings up and closed, seen edge on: mid-flap, or asleep at night. */
export const BUTTERFLY_CLOSED: PixelArt = {
  rows: [
    "...a.....a...",
    "....a...a....",
    ".....oOo.....",
    ".....oOo.....",
    "....oOOOo....",
    "....oOObo....",
    "....odObo....",
    "....odobo....",
    ".....odo.....",
    "......b......",
  ],
  pal: BUTTERFLY_PAL,
};

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

// ---- Guests at the bowl (#351): they come at night, and wait by what they left ----

/** A sparrow: the bird's shape, all brown, with a pale breast. */
export const SPARROW: PixelArt = { rows: BIRD.rows, pal: { ...BIRD_PAL, B: "#7a5a3a", b: "#a8865a", R: "#d8c8a8" } };

/** A grey mouse, sitting, facing left, its tail out behind. */
export const MOUSE: PixelArt = {
  rows: [
    "..oo..........",
    ".oPGo.........",
    ".oGGGooo......",
    "oGeGGGGGo.....",
    "pGGGGGGGGo....",
    ".oGGGGGGGo....",
    "..oooooooTTTT.",
  ],
  pal: { o: INK, G: "#9a8c84", P: "#e8a8a0", e: INK, p: "#e07a80", T: "#c89a90" },
};

/** A hedgehog curled up asleep, its face on the right. */
export const HEDGEHOG: PixelArt = {
  rows: [
    "...s.s.s.s......",
    "..sSsSsSsSs.....",
    ".sSsSsSsSsSs....",
    "sSsSsSsSsSsSoo..",
    "sSsSsSsSsSsoFFo.",
    "sSsSsSsSsSsoFmFo",
    ".sSsSsSsSsSoFFFn",
    "..oooooooooooooo",
  ],
  pal: { o: INK, S: "#5e4632", s: "#957454", F: "#dcbc94", m: INK, n: INK },
};

/** A red fox sitting, facing left, its white-tipped tail round its feet. */
export const FOX: PixelArt = {
  rows: [
    "..o.....o.......",
    ".oOo...oOo......",
    ".oOOoooOOo......",
    ".oOOOOOOOo......",
    "oOeOOOOeOOo.....",
    "oOOWWWWOOOo.....",
    ".oWWnWWWOo......",
    "..oWWWWOo.......",
    "..oOOOOOOo......",
    ".oOOWWWOOOo.....",
    ".oOOWWWOOOo..oo.",
    ".oOOWWWOOOOooOOo",
    ".oOOOOOOOOOoOOWo",
    "..oOOoOOOOOOOWo.",
    "..oKKoKKoooooo..",
    "..ooo.ooo.......",
  ],
  pal: { o: INK, O: "#e0782c", W: "#f4ecdc", e: INK, n: INK, K: "#3a2416" },
};

// ---- The 2D strip only: the empty garden (#58) and the end of the strip (#61) ----

/** A pink worm asleep on the soil, head on the right, eye closed. */
export const WORM_ASLEEP: PixelArt = {
  rows: [
    "...............oooo.",
    ".ooo..........oPPPPo",
    "oPPPoo......ooPPPPPo",
    "oPpPPPoooooopPPeePPo",
    ".ooPPpPPpPPPPPpPPoo.",
    "...oooooooooooooo...",
  ],
  pal: { o: "#6a3a34", P: "#eaa29a", p: "#c8786e", e: "#2a1410" },
};

/** A small zinc watering can, spout up and to the left. Not a visitor: just there. */
export const WATERING_CAN: PixelArt = {
  rows: [
    "........oooo......",
    ".......o....o.....",
    "RR.....o....o.....",
    "RRs...oooooooooo..",
    "..ss..oGlGGGGGGo..",
    "...ssoGGlGGGGGGGo.",
    "....sGGGlGGGGGGGoo",
    ".....oGGlGGGGGGGo.",
    "......oGGGGGGGGo..",
    "......oDDDDDDDDo..",
    ".......oooooooo...",
  ],
  pal: { o: INK, G: "#7f9fb8", l: "#c4d8e6", D: "#557590", s: "#6a8aa4", R: "#557590" },
};

/** A mole looking up out of its hole, holding one seed. */
export const MOLE: PixelArt = {
  rows: [
    "....oooooo....",
    "...oMMMMMMo...",
    "..oMmMMMMmMo..",
    "..oMeMMMMeMo..",
    "..oMMMppMMMo..",
    "..oMMMppMMMo..",
    "..ooMMMMMMoo..",
    ".ohhoMMMMohho.",
    ".ohhhoSSohhho.",
    "..ooooSSoooo..",
    "..oMMMMMMMMo..",
    "..oMMMMMMMMo..",
    "..oMMMMMMMMo..",
  ],
  pal: { o: INK, M: "#4f4650", m: "#6c6270", e: "#151015", p: "#f0a0a8", h: "#f2bcae", S: "#e0b860" },
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

/** Garden words (#209) whose visitor has art so far. The rest arrive with their art (#209 phase B). The fish comes in its bowl. */
export const GARDEN_VISITOR_ART: Partial<Record<GardenWord, PixelArt>> = { cat: CAT_AWAKE, bird: BIRD, frog: FROG, snail: SNAIL, dog: DOG, fish: FISHBOWL, butterfly: BUTTERFLY };
