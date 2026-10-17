// Pixel art for the loose things you carry and throw (#358, garden/carry.ts),
// in visitorArt.ts's style: a pebble, a stick, the cairn's flat stone, and the
// rings a splash makes. Drawn into the walk's texture (textures.ts carryAtlas)
// and, for what you hold, into the page (GardenWalk.tsx).

import type { Loose } from "./carry";
import type { PixelArt } from "./visitorArt";

const STONE = { o: "#4a4440", S: "#9a948a", s: "#7a746a", w: "#c8c2b6" };

export const LOOSE_ART: Record<Loose, PixelArt> = {
  // Round, blue-grey and outlined, with a shine: not one of the path's grey specks.
  pebble: { rows: ["..oooo..", ".oSwwSo.", "oSSwSSSo", "oSSSSSso", ".osssso.", "..oooo.."], pal: { o: "#33383e", S: "#a4aeb8", s: "#78828c", w: "#e8eef2" } },
  stick: {
    rows: ["............o.", "...........oTo", "..........oTo.", "..o.....ooTo..", ".oTo..ooTTo...", "..oTooTTo.....", "..ooTTo.......", ".oTTo.........", "oTo...........", ".o............"],
    pal: { o: "#4a3020", T: "#8a6a44" },
  },
};

/** The cairn's flat stone, wide and low. */
export const FLAT_STONE: PixelArt = { rows: ["...oooooooo...", ".ooSwSSSSSSoo.", "oSSSSSSSSSSsso", "osssssssssssso", ".oooooooooooo."], pal: STONE };

/** Rings on the water, seen from above: a thin light circle, `r` pixels round, in a square of `size`. */
export function ring(r: number, size: number): PixelArt {
  const c = (size - 1) / 2;
  const rows = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (Math.abs(Math.hypot(x - c, y - c) - r) < 0.6 ? "w" : ".")).join(""));
  return { rows, pal: { w: "#dff0f4" } };
}
