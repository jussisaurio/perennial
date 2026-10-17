// Pixel art for two seeds, one pot (#387), in visitorArt.ts's style: the clay
// pot, a seed in its visitor's colour, and the creatures that hatch. A
// creature is its base visitor's art with its trait drawn on: each base has
// anchor points (the top of its head, its face, its back) and the way it
// faces, and each trait is a small overlay that sits on one of them (the
// frog's green repaints the base instead). Drawn into the walk's textures
// (textures.ts potAtlas, carryAtlas) and, for a seed you hold, into the page.

import { BIRD, BUTTERFLY, CAT_AWAKE, DOG, FROG, LEAPING_FISH, SNAIL, type PixelArt } from "./visitorArt";
import { traitOf, type Creature, type PotKind, type Trait } from "./pot";

const INK = "#3a2416";

/** A cell of the shared atlases: things stand on its bottom row. */
const CELL = 32;

/** A seed, in its visitor's own colour. */
const SEED_COLOR: Record<PotKind, [string, string]> = {
  cat: ["#e08a3c", "#b0602a"],
  bird: ["#d8b070", "#a8804a"],
  dog: ["#9a6636", "#6e4424"],
  fish: ["#f0c030", "#c89020"],
  butterfly: ["#e070a0", "#b04878"],
  frog: ["#6ab84c", "#3e7e2c"],
  snail: ["#b09080", "#806050"],
};

export function seedArt(kind: PotKind): PixelArt {
  const [S, s] = SEED_COLOR[kind];
  return { rows: ["..oo..", ".oSSo.", "oSwSso", "oSSsso", ".oSso.", "..oo.."], pal: { o: INK, S, s, w: "#fff8e7" } };
}

const POT_PAL = { o: "#5a2a14", P: "#c8643c", p: "#e08a5a", D: "#5a3a20", d: "#3a2410" };
const POT_BODY = [".oPPPPPPPPPPPPo.", ".oPpPPPPPPPPPPo.", ".oPpPPPPPPPPPPo.", "..oPpPPPPPPPPo..", "..oPPPPPPPPPPo..", "...oooooooooo..."];

/** The clay pot, its soil level with the rim. */
export const POT: PixelArt = { rows: ["oooooooooooooooo", "oDDDDDDDDDDDDDDo", "oooooooooooooooo", ...POT_BODY], pal: POT_PAL };
/** The pot once something hatched: its soil broken open. */
export const POT_HATCHED: PixelArt = { rows: ["..d..d....d..d..", "oDdDDdDDDDdDDdDo", "oooooooooooooooo", ...POT_BODY], pal: POT_PAL };
/** The pot's rim, in pixels above its bottom row: seeds lie, and a creature sits, on its soil. */
export const POT_TOP = 8;

/** Where a trait goes on a base: on top of its head, at its face (its mouth, or a beak's tip), or on its back. */
type Anchor = "head" | "face" | "back";

/** A base: its art, which way its head points (overlays turn with it; "front" faces you), and its anchors in its own pixels. */
interface Base {
  art: PixelArt;
  facing: "left" | "right" | "front";
  at: Record<Anchor, [number, number]>;
}

const BASES: Record<PotKind, Base> = {
  // Curled up, head on the left, its back a long curve.
  cat: { art: CAT_AWAKE, facing: "left", at: { head: [5, 1], face: [1, 7], back: [14, 3] } },
  dog: { art: DOG, facing: "right", at: { head: [11, 0], face: [17, 5], back: [6, 9] } },
  bird: { art: BIRD, facing: "left", at: { head: [5, 0], face: [0, 3], back: [9, 3] } },
  // From the side, head to the right: the fish that leaps from the pond.
  fish: { art: LEAPING_FISH, facing: "right", at: { head: [13, 3], face: [15, 4], back: [5, 2] } },
  butterfly: { art: BUTTERFLY, facing: "front", at: { head: [6, 2], face: [6, 3], back: [6, 6] } },
  frog: { art: FROG, facing: "front", at: { head: [7, 2], face: [7, 4], back: [7, 6] } },
  snail: { art: SNAIL, facing: "right", at: { head: [13, 3], face: [15, 6], back: [6, 2] } },
};

/**
 * An overlay: drawn for a base that faces left (turned for one that faces
 * right), and its own art for a base that faces you. `origin`: its pixel that
 * sits on the anchor. `behind`: drawn under the base (wings come out from
 * behind a body).
 */
interface Overlay {
  on: Anchor;
  behind: boolean;
  side: { rows: string[]; origin: [number, number] };
  front: { rows: string[]; origin: [number, number] };
  pal: Record<string, string>;
}

const OVERLAYS: Record<Exclude<Trait, "green">, Overlay> = {
  // The bird's: a brown wing up and back.
  wings: {
    on: "back",
    behind: true,
    side: { rows: ["......oo", "....ooWo", "...oWWwo", "..oWWwo.", ".oWWwo..", "oWwwo..."], origin: [1, 5] },
    front: { rows: ["oo..................oo", "oWoo..............ooWo", "owWWo............oWWwo", ".owWWo..........oWWwo.", "..owWWoo......ooWWwo..", "...owwWWo....oWWwwo..."], origin: [11, 5] },
    pal: { o: INK, W: "#d8b48a", w: "#a8764a" },
  },
  // The goldfish's: two orange fins along the back.
  fins: {
    on: "back",
    behind: true,
    side: { rows: ["...oo......", "..oFFo..oo.", ".oFFFFooFFo", "oFFfFFoFfFo"], origin: [3, 3] },
    front: { rows: ["oo...............oo", "oFo.............oFo", "oFFo...........oFFo", ".oFfo.........oFfo."], origin: [9, 3] },
    pal: { o: "#a0502a", F: "#e8803c", f: "#f4e2c8" },
  },
  // The snail's: a small striped shell, sitting on the back.
  shell: {
    on: "back",
    behind: false,
    side: { rows: ["..oooo..", ".osSSso.", "osSddSso", "oSdSsdSo", "osdssdso", ".oooooo."], origin: [4, 5] },
    front: { rows: ["..oooo..", ".osSSso.", "osSddSso", "oSdSsdSo", "osdssdso", ".oooooo."], origin: [4, 5] },
    pal: { o: INK, s: "#c0703a", S: "#e6a060", d: "#8a4a24" },
  },
  // The butterfly's: two thin feelers with knobs, leaning forward.
  antennae: {
    on: "head",
    behind: true,
    side: { rows: ["o..o", ".o.o", ".o.o", "..oo"], origin: [3, 3] },
    front: { rows: ["o...o", ".o.o.", ".o.o.", "..o.."], origin: [2, 3] },
    pal: { o: INK },
  },
  // The cat's: whiskers out in front of the face.
  whiskers: {
    on: "face",
    behind: false,
    side: { rows: ["ww....", "..wwww", "ww...."], origin: [5, 1] },
    front: { rows: ["www...........www", "...www.....www...", "www...........www"], origin: [8, 1] },
    pal: { w: "#2a1a10" },
  },
  // The dog's: long ears that flop down behind the head.
  ears: {
    on: "head",
    behind: false,
    side: { rows: ["oooo.", "oEEEo", ".oEEo", ".oEEo", "..oEo", "...o."], origin: [1, 0] },
    front: { rows: ["oooo..........oooo", "oEEEo........oEEEo", "oEEo..........oEEo", "oEEo..........oEEo", "oEo............oEo", ".o..............o."], origin: [9, 0] },
    pal: { o: INK, E: "#6e4424" },
  },
};

/** The frog's greens, light to dark, for a base repainted green. */
const GREENS = ["#cfe39a", "#8cc864", "#5aa83c", "#3e7e2c"];

/** A colour's brightness, 0 to 1. */
function light(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
}

/** The base's palette in greens by brightness; its outline and eyes (the darkest colours) stay. */
function greened(pal: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(pal).map(([k, c]) => [k, light(c) < 0.2 ? c : GREENS[Math.min(3, Math.floor((1 - light(c)) * 4))]]));
}

/** One CELL×CELL grid of colours (null: clear). */
type Grid = (string | null)[][];

function stamp(g: Grid, rows: readonly string[], pal: Record<string, string>, x0: number, y0: number, flip: boolean, ox: number) {
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const c = pal[ch];
      // Turned round its origin's column for a base that faces right.
      const gx = flip ? x0 - (x - ox) : x0 + (x - ox);
      const gy = y0 + y;
      if (c && gx >= 0 && gx < CELL && gy >= 0 && gy < CELL) g[gy][gx] = c;
    }),
  );
}

/** A creature: its base, standing on the cell's bottom row and centred, with its trait drawn on; a full CELL×CELL art. */
export function creatureArt(c: Creature): PixelArt {
  const base = BASES[c.base];
  const trait = traitOf(c);
  const g: Grid = Array.from({ length: CELL }, () => Array<string | null>(CELL).fill(null));
  const bx = Math.floor((CELL - base.art.rows[0].length) / 2);
  const by = CELL - base.art.rows.length;
  const over = trait && trait !== "green" ? OVERLAYS[trait] : null;
  const drawOver = () => {
    if (!over) return;
    const [ax, ay] = base.at[over.on];
    const o = base.facing === "front" ? over.front : over.side;
    stamp(g, o.rows, over.pal, bx + ax, by + ay - o.origin[1], base.facing === "right", o.origin[0]);
  };
  if (over?.behind) drawOver();
  stamp(g, base.art.rows, trait === "green" ? greened(base.art.pal) : base.art.pal, bx, by, false, 0);
  if (!over?.behind) drawOver();
  // Back to a character map: one letter per colour.
  const keys = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const pal: Record<string, string> = {};
  const key = new Map<string, string>();
  const rows = g.map((row) =>
    row
      .map((col) => {
        if (!col) return ".";
        if (!key.has(col)) {
          const k = keys[key.size];
          key.set(col, k);
          pal[k] = col;
        }
        return key.get(col)!;
      })
      .join(""),
  );
  return { rows, pal };
}
