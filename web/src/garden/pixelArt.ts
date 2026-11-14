// Pixel art as character maps: each letter is a colour from the palette, "."
// is clear. The pebble, the well, the toys, the fruit and the leaf pile are
// still drawn this way; the visitors are paper now (visitorArt.ts, #1091).

export interface PixelArt {
  rows: string[];
  pal: Record<string, string>;
}

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
