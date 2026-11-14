// Which pixels differ between two screenshots of one screen (#1004): `bun run compare`
// lists the screens a change touched with this, and the pairwise judge back-test
// (e2e/pairwise.ts) uses it to drop pairs that look the same.

import { readFileSync, writeFileSync } from "node:fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export type Box = { x: number; y: number; w: number; h: number };

/** `changed` pixels of `total`, and the box around them; null when nothing changed. */
export type Diff = { changed: number; total: number; box: Box | null };

/**
 * Compare two PNGs of the same size. With `out`, and if any pixel changed, write
 * pixelmatch's picture of the difference there: changed pixels in red over a faded copy of `a`.
 */
export function pixelDiff(a: string, b: string, out?: string): Diff {
  const [pa, pb] = [PNG.sync.read(readFileSync(a)), PNG.sync.read(readFileSync(b))];
  // The shots are viewport shots, so a size change means the viewport changed: a broken run, not a UI change.
  if (pa.width !== pb.width || pa.height !== pb.height) throw new Error(`${a} is ${pa.width}x${pa.height} but ${b} is ${pb.width}x${pb.height}`);
  const { width, height } = pa;
  const diff = new PNG({ width, height });
  // Anti-aliasing is not counted, so the same text a pixel off in its edge smoothing is "same".
  const changed = pixelmatch(pa.data, pb.data, diff.data, width, height, { threshold: 0.1 });
  if (out !== undefined && changed > 0) writeFileSync(out, PNG.sync.write(diff));
  return { changed, total: width * height, box: changed === 0 ? null : redBox(diff) };
}

/**
 * Write `box` of the PNG at `src`, with a margin, enlarged to `out`, so a judge can read small
 * text: the back-test judges could not read a sign drawn 10 px high in the 3D world (#1004).
 * Returns how many times bigger, or 0 (and writes nothing) when the part is already big enough
 * that the whole picture shows it well.
 */
export function enlarge(src: string, box: Box, out: string): number {
  const png = PNG.sync.read(readFileSync(src));
  const pad = 24;
  const x0 = Math.max(0, box.x - pad);
  const y0 = Math.max(0, box.y - pad);
  const w = Math.min(png.width, box.x + box.w + pad) - x0;
  const h = Math.min(png.height, box.y + box.h + pad) - y0;
  // At most 4 times, and no bigger than 1600x1200: an image model scales larger pictures down again.
  const scale = Math.min(4, Math.floor(1600 / w), Math.floor(1200 / h));
  if (scale < 2) return 0;
  const big = new PNG({ width: w * scale, height: h * scale });
  for (let y = 0; y < big.height; y++)
    for (let x = 0; x < big.width; x++) {
      const from = ((y0 + Math.floor(y / scale)) * png.width + x0 + Math.floor(x / scale)) * 4;
      png.data.copy(big.data, (y * big.width + x) * 4, from, from + 4);
    }
  writeFileSync(out, PNG.sync.write(big));
  return scale;
}

/** The box around pixelmatch's red (changed) pixels. */
function redBox(diff: PNG): Box {
  let [x0, y0, x1, y1] = [diff.width, diff.height, -1, -1];
  for (let y = 0; y < diff.height; y++)
    for (let x = 0; x < diff.width; x++) {
      const i = (y * diff.width + x) * 4;
      if (diff.data[i] !== 255 || diff.data[i + 1] !== 0 || diff.data[i + 2] !== 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
