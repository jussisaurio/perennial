// The pieces a word's plant is cut from (ui/plant.tsx), as SVG path data. A
// piece is a closed outline of cubic curves; pieces of one colour go into one
// path, so a plant is a few paths, not hundreds. Pure geometry: no React.

/** An outline: a start point, then cubic curves of three points each (x y order), ending where it started. */
export type Outline = number[];

/** An affine map [a, b, c, d, e, f], as SVG's matrix(): (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export type Affine = readonly [number, number, number, number, number, number];

/** Move to (x, y), turn `deg` (clockwise, as SVG), and scale by sx, sy, in that order outward. */
export function place(x: number, y: number, deg = 0, sx = 1, sy = sx): Affine {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos * sx, sin * sx, -sin * sy, cos * sy, x, y];
}

/** `inner` first, then `outer`. */
export function then(outer: Affine, inner: Affine): Affine {
  const [a, b, c, d, e, f] = outer;
  const [A, B, C, D, E, F] = inner;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

/** A number for a path, to two places. */
const n = (v: number) => String(Math.round(v * 100) / 100);

/**
 * Pieces of one colour, as one path. Every outline is added the same way round, so where two overlap
 * the path's fill (nonzero, SVG's default) covers both; one turned the other way would cut a hole.
 */
export class Cut {
  private d = "";
  /** How many pieces it holds. */
  count = 0;

  add(o: Outline, m: Affine = IDENTITY): this {
    const [a, b, c, d, e, f] = m;
    const p: number[] = [];
    for (let i = 0; i < o.length; i += 2) p.push(a * o[i] + c * o[i + 1] + e, b * o[i] + d * o[i + 1] + f);
    // The signed area of the points (a curve's control points stand in for it): negative is the other way round.
    let area = 0;
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length;
      area += p[i] * p[j + 1] - p[j] * p[i + 1];
    }
    const q = area < 0 ? reverse(p) : p;
    let s = `M${n(q[0])} ${n(q[1])}`;
    for (let i = 2; i < q.length; i += 6) s += `C${n(q[i])} ${n(q[i + 1])} ${n(q[i + 2])} ${n(q[i + 3])} ${n(q[i + 4])} ${n(q[i + 5])}`;
    this.d += `${s}Z`;
    this.count++;
    return this;
  }

  get path(): string {
    return this.d;
  }
}

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** The same outline the other way round. */
function reverse(p: number[]): number[] {
  const out = [p[p.length - 2], p[p.length - 1]];
  for (let i = p.length - 4; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}

/** A straight edge as a cubic curve, so a path is curves only. */
export function line(x0: number, y0: number, x1: number, y1: number): number[] {
  return [x0 + (x1 - x0) / 3, y0 + (y1 - y0) / 3, x0 + ((x1 - x0) * 2) / 3, y0 + ((y1 - y0) * 2) / 3, x1, y1];
}

/** A circle (or an ellipse, with ry), as four curves. */
export function disc(cx: number, cy: number, rx: number, ry = rx): Outline {
  const kx = rx * 0.5523;
  const ky = ry * 0.5523;
  return [cx + rx, cy, cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry, cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy, cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry, cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy];
}

/**
 * A symmetric piece from its left side: `left` runs from the base (0, 0) up to a point on the middle line (x 0),
 * as curves; the right side is its mirror image back down. `half`: the left side and the middle line only, the
 * half of a folded piece that faces one way.
 */
export function mirrored(left: number[], half = false): Outline {
  const out = [0, 0, ...left];
  const tipY = left[left.length - 1];
  if (half) return [...out, ...line(0, tipY, 0, 0)];
  // The left side's points backwards, each x mirrored: its curves run back down the right.
  const pts = [0, 0, ...left];
  for (let i = pts.length - 4; i >= 0; i -= 2) out.push(-pts[i], pts[i + 1]);
  return out;
}

/** Bends an outline drawn upright (its base at 0, 0 and `len` tall) so its top swings `bend`·len to the right. */
export function bent(o: Outline, len: number, bend: number): Outline {
  const out = o.slice();
  for (let i = 0; i < out.length; i += 2) {
    const t = Math.max(0, -out[i + 1] / len);
    out[i] += bend * len * t * t;
  }
  return out;
}

/** `hsl(h s% l%)`, rounded: the one way plant colours are written, so a test can find them. */
export const hsl = (h: number, s: number, l: number) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(Math.min(97, Math.max(4, l)))}%)`;

/** A colour in hsl() form made lighter (dl > 0) or darker, and moved in hue and saturation. */
export function tone(colour: string, dl: number, ds = 0, dh = 0): string {
  const m = /^hsl\((-?[\d.]+) ([\d.]+)% ([\d.]+)%\)$/.exec(colour);
  if (!m) throw new Error(`plant colour is not hsl(): ${colour}`);
  return hsl(Number(m[1]) + dh, Math.max(0, Number(m[2]) + ds), Number(m[3]) + dl);
}

/** The lightness of a colour in hsl() form. */
export function lightness(colour: string): number {
  const m = /([\d.]+)%\)$/.exec(colour);
  if (!m) throw new Error(`plant colour is not hsl(): ${colour}`);
  return Number(m[1]);
}
