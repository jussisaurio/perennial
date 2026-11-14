// Small procedural textures, drawn on canvases as paper cut-outs (docs/art-direction.md,
// #1051, #1091): flat colour, crisp edges, filtered smooth (paperTexture, cutoutTexture).

import * as THREE from "three";
import { rng } from "../lib/seed";
import type { PlacedPlant } from "./world";
export { VIEW_H } from "./plantCanvas";
import * as Art from "./visitorArt";
import { PEBBLE } from "./carryArt";
import { CELL_H_PX, CELL_W, FRUIT_KINDS, LOOKS, TREE_SHAPES, TRELLIS, type Fruit } from "./orchardArt";
import { ORCHARD_WORDS } from "../deck/schema";
import { AUTUMN } from "./walkInto";
import type { SpriteDone, SpriteJob } from "./spriteWorker";
import type { FarPixels, PaintJob, Pixels } from "./paintWorker";
import type { TimeOfDay } from "./game";
import { FULL_MOON, MOON_PHASES } from "./moon";

/**
 * A canvas, offscreen so a worker can paint it too (paintWorker.ts). Read its pixels (getImageData) only in a worker:
 * on the main thread a read waits for the GPU, ~120 ms over the walk's bed signs at CPU 10× when they were read (#447).
 */
function canvas(w: number, h: number): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/**
 * A surface drawn as flat paper (#1091): its shapes have clean, smooth edges up close, and its
 * mipmaps blend them into the flat colour far off, so it never shimmers. Drawn at a size
 * where a texel is under a screen pixel at arm's length, so smooth filtering does not blur.
 */
export function paperTexture(c: OffscreenCanvas, repeat = false): THREE.CanvasTexture<OffscreenCanvas> {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * A paper cut-out for the instanced sprites (sceneSprites.ts) and the far house, as paperTexture but uploaded
 * premultiplied: a canvas keeps no colour in its clear pixels, so a straight-alpha edge blends toward black and gets a
 * dark rim, worse far off in the mipmaps. Premultiplied, it blends toward clear, and the sprite shader divides the
 * alpha out again (the far house's material blends it premultiplied instead).
 */
export function cutoutTexture(c: OffscreenCanvas): THREE.CanvasTexture<OffscreenCanvas> {
  const t = paperTexture(c);
  t.premultiplyAlpha = true;
  return t;
}

/** Metres of ground one tile of the grass and path textures covers. The hill's grass (sceneStile.ts) lines up with the flat ground's by it. */
export const GROUND_TILE = 2;
/** Texels on a side of a ground tile. */
const GROUND_PX = 256;

/** Calls `draw` at (x, y) and at its copies one tile over each way, so a shape over the edge of a repeating texture goes on at the other side. */
function wrapped(size: number, x: number, y: number, draw: (x: number, y: number) => void) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) draw(x + dx, y + dy);
}

/** Spots for small things on a repeating tile, none closer than `gap` to another (across the edges too): a calm, even scatter, not clumps. */
function scatter(r: () => number, size: number, n: number, gap: number): [number, number][] {
  const out: [number, number][] = [];
  // Tries a fixed number of times: on a full tile, fewer than n is fine.
  for (let i = 0; i < n * 30 && out.length < n; i++) {
    const [x, y] = [r() * size, r() * size];
    const near = out.some(([ox, oy]) => {
      const dx = Math.abs(x - ox);
      const dy = Math.abs(y - oy);
      return Math.hypot(Math.min(dx, size - dx), Math.min(dy, size - dy)) < gap;
    });
    if (!near) out.push([x, y]);
  }
  return out;
}

/**
 * A tuft of grass seen from above, as it lies on the ground: five flat pointed blades out from (x, y), up to `len`
 * texels long. From above it reads the same from every side, so it never looks upside down to the camera.
 */
function tuft(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, len: number, turn: number) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = turn + (i / 5) * Math.PI * 2;
    // Blades of a few lengths, so the tuft is not a regular star.
    const l = len * [1, 0.7, 0.9, 0.6, 0.8][i];
    const [cx, cy] = [Math.cos(a), Math.sin(a)];
    const w = 2.4;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + cx * l * 0.45 - cy * w, y + cy * l * 0.45 + cx * w, x + cx * l, y + cy * l);
    ctx.quadraticCurveTo(x + cx * l * 0.45 + cy * w, y + cy * l * 0.45 - cx * w, x, y);
  }
  ctx.fill();
}

/**
 * A texture a worker painted (paintWorker.ts): the sky, hills, clouds, sun, far trees and the orchard. Filtered smooth
 * (#1051), so their edges are clean curves, not steps. `aroundRing`: it repeats in x only, as the hills do around the world.
 */
function paintedTexture({ width, height, data }: Pixels, aroundRing = false): THREE.DataTexture {
  const t = new THREE.DataTexture(data, width, height);
  // The worker's rows are top first, as a canvas's are: flipped on upload, as a CanvasTexture is.
  t.flipY = true;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  if (aroundRing) t.wrapS = THREE.RepeatWrapping;
  return t;
}

/**
 * A painted cut-out that stands as sprites (the trees outside the fence, the orchard): as paintedTexture, but with
 * mipmaps, so far off it does not shimmer. Its empty pixels carry their nearest colour (bleedEdges), so the mipmaps
 * blend an edge toward its own colour, not toward a dark rim. Not premultiplied on upload, as cutoutTexture is: for
 * raw pixels the browser does that on the main thread, 20–30 ms for the orchard at CPU 10×.
 */
function paintedCutout(p: Pixels): THREE.DataTexture {
  const t = paintedTexture(p);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

/** The trees outside the fence, the clouds, and the sky's looks for each time of day, with tonight's moon. */
export interface FarTextures {
  trees: THREE.Texture;
  cloud: THREE.Texture;
  looks: Record<TimeOfDay, { sky: THREE.Texture; hills: THREE.Texture; sun: THREE.Texture }>;
}

/**
 * Runs one paint job in a worker (paintWorker.ts), a worker per job, so jobs
 * paint side by side: pixel by pixel they took build steps of 10-340 ms at CPU 10× on the main thread (#571).
 */
function paint<T>(job: PaintJob): Promise<T> {
  const worker = new Worker(new URL("./paintWorker.ts", import.meta.url), { type: "module" });
  worker.postMessage(job);
  return new Promise<T>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<T>) => resolve(e.data);
    // Loudly: a walk without its sky would be a black dome.
    worker.onerror = (e) => reject(new Error(`paint worker (${job.kind}): ${e.message}`));
  }).finally(() => worker.terminate());
}

/** FarTextures, painted in a worker. */
export async function paintFar(moonPhase: number): Promise<FarTextures> {
  const { trees, cloud, looks } = await paint<FarPixels>({ kind: "far", moonPhase });
  const look = (l: FarPixels["looks"][TimeOfDay]) => ({ sky: paintedTexture(l.sky), hills: paintedTexture(l.hills, true), sun: paintedTexture(l.sun) });
  return { trees: paintedCutout(trees), cloud: paintedTexture(cloud), looks: { day: look(looks.day), dusk: look(looks.dusk), night: look(looks.night) } };
}

/** The orchard's atlas (orchard()), painted in a worker. */
export const paintOrchard = async (): Promise<THREE.Texture> => paintedCutout(await paint<Pixels>({ kind: "orchard" }));

const px = (ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, color: string, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

/** Grass (#1091): one flat green, with a scatter of soft tufts a shade darker or lighter. One tile is GROUND_TILE metres. */
export function grass(): OffscreenCanvas {
  const [c, ctx] = canvas(GROUND_PX, GROUND_PX);
  px(ctx, 0, 0, "#6f9e5f", GROUND_PX, GROUND_PX);
  const r = rng(7);
  for (const [x, y] of scatter(r, GROUND_PX, 18, 42)) {
    ctx.fillStyle = r() < 0.7 ? "#62905a" : "#7dab6a";
    const [len, turn] = [9 + r() * 4, r() * Math.PI];
    wrapped(GROUND_PX, x, y, (x, y) => tuft(ctx, x, y, len, turn));
  }
  return c;
}

/** The yard's packed earth (#1091): one flat sand colour with a few small pebbles, each a pale flat stone on its own soft shadow. One tile is GROUND_TILE metres. */
export function path(): OffscreenCanvas {
  const [c, ctx] = canvas(GROUND_PX, GROUND_PX);
  px(ctx, 0, 0, "#d9ccb2", GROUND_PX, GROUND_PX);
  const r = rng(8);
  for (const [x, y] of scatter(r, GROUND_PX, 10, 52)) {
    const [rx, ry, turn] = [3 + r() * 3, 2 + r() * 1.6, (r() - 0.5) * 0.8];
    const pebble = (x: number, y: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, turn, 0, Math.PI * 2);
      ctx.fill();
    };
    wrapped(GROUND_PX, x, y, (x, y) => {
      pebble(x + 0.6, y + 1.4, "#c4b394");
      pebble(x, y, "#e8dfcc");
    });
  }
  return c;
}

/**
 * The old path past the stile (#714), seen from above, from its far end (the
 * top of a plane laid flat) to the stile: bare earth with a clean edge that
 * winds a little, narrower far out, where it breaks up into stepping patches
 * in the grass. Transparent where grass shows.
 */
export function track(): OffscreenCanvas {
  const [W, H] = [96, 512];
  const [c, ctx] = canvas(W, H);
  const r = rng(714);
  // Where the path's middle is, and how wide it is, `k` of the way out (0 at the stile, 1 at the far end).
  const mid = (k: number) => W / 2 + Math.sin(k * 5.2) * 14;
  const half = (k: number) => 18 - k * 10;
  // The whole band out to where it breaks up, as one shape: down its left side, back up its right.
  const BREAK = 0.62;
  const rows = 64;
  const side = (s: number) => Array.from({ length: rows + 1 }, (_, i) => (i / rows) * BREAK).map((k) => [mid(k) + s * half(k), (1 - k) * H] as const);
  ctx.fillStyle = "#cdbd9f";
  ctx.beginPath();
  const left = side(-1);
  const right = side(1).reverse();
  ctx.moveTo(...left[0]);
  for (const p of [...left, ...right]) ctx.lineTo(...p);
  // The band's far end, rounded.
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(mid(BREAK), (1 - BREAK) * H, half(BREAK), half(BREAK) * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Past it, patches of bare earth, smaller and further apart toward the end.
  for (let k = BREAK + 0.05; k < 0.97; k += 0.035 + (k - BREAK) * 0.12) {
    const w = half(k) * (0.75 + r() * 0.2);
    ctx.beginPath();
    ctx.ellipse(mid(k) + (r() - 0.5) * half(k), (1 - k) * H, w, w * 0.55, (r() - 0.5) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Texels on a side of a tile of the beds' soil: one tile is a metre (scenePlants.ts). */
const SOIL_PX = 256;

/**
 * The beds' soil (#1091): one flat deep brown with a calm scatter of small clods, each a lumpy shape a shade lighter
 * on its own darker shadow, as the path's pebbles are. One tile is a metre.
 */
export function soil(): OffscreenCanvas {
  const [c, ctx] = canvas(SOIL_PX, SOIL_PX);
  px(ctx, 0, 0, "#5f4733", SOIL_PX, SOIL_PX);
  const r = rng(3);
  for (const [x, y] of scatter(r, SOIL_PX, 16, 46)) {
    // A clod: a ring of seven points at uneven distances, joined by curves through their midpoints.
    const rad = 4 + r() * 4;
    const ring = Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2 + r() * 0.5;
      const d = rad * (0.75 + r() * 0.4);
      return [Math.cos(a) * d, Math.sin(a) * d * 0.75] as const;
    });
    const clod = (x: number, y: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ring.forEach(([ax, ay], i) => {
        const [bx, by] = ring[(i + 1) % ring.length];
        const [mx, my] = [x + (ax + bx) / 2, y + (ay + by) / 2];
        if (i === 0) ctx.moveTo(mx, my);
        else ctx.quadraticCurveTo(x + ax, y + ay, mx, my);
      });
      const [ax, ay] = ring[0];
      const [bx, by] = ring[1];
      ctx.quadraticCurveTo(x + ax, y + ay, x + (ax + bx) / 2, y + (ay + by) / 2);
      ctx.fill();
    };
    wrapped(SOIL_PX, x, y, (x, y) => {
      clod(x + 1, y + 2, "#4e3a29");
      clod(x, y, "#6e5640");
    });
  }
  return c;
}

/**
 * Wood (#1091): two flat planks along the grain (u), a crisp dark gap between them and at the edges, a light edge where
 * each plank's top catches the light, and a few fine grain lines. It repeats along u. A narrow piece shows only the
 * middle of the lower plank (sceneSprites.ts woodBox), so the grain lines there are what a post or a leg shows.
 */
export function wood(): OffscreenCanvas {
  const [W, H] = [512, 256];
  const [c, ctx] = canvas(W, H);
  px(ctx, 0, 0, "#b38e5f", W, H);
  const r = rng(4);
  // Two long, gently wavy grain lines a shade darker on each plank; one that runs off the right goes on from the left.
  ctx.strokeStyle = "#a4805a";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (const top of [0, H / 2])
    for (let i = 0; i < 2; i++) {
      const y = top + 24 + i * 44 + r() * 20;
      const [x0, len, phase] = [r() * W, W * (0.4 + r() * 0.4), r() * 6];
      for (const dx of [0, -W]) {
        ctx.beginPath();
        for (let x = 0; x <= len; x += 8) ctx.lineTo(x0 + dx + x, y + Math.sin(x / 90 + phase) * 3);
        ctx.stroke();
      }
    }
  for (const top of [0, H / 2]) px(ctx, 0, top + 4, "#c4a072", W, 4);
  px(ctx, 0, H / 2 - 3, "#7d6143", W, 6);
  px(ctx, 0, 0, "#7d6143", W, 4);
  px(ctx, 0, H - 4, "#7d6143", W, 4);
  return c;
}

/** Texels on a side of a tile of leaves (hedge, bramble). */
const LEAVES_PX = 256;

/**
 * Leaves as flat paper (#1091): one colour, and a calm scatter of leaf cut-outs a shade lighter or darker, `n` of
 * each colour, each a pointed oval `size` texels long at its own turn. A repeating tile of LEAVES_PX texels.
 */
function leaves(seed: number, base: string, cutouts: [string, number][], size: number): [OffscreenCanvas, OffscreenCanvasRenderingContext2D, () => number] {
  const [c, ctx] = canvas(LEAVES_PX, LEAVES_PX);
  px(ctx, 0, 0, base, LEAVES_PX, LEAVES_PX);
  const r = rng(seed);
  const all = cutouts.flatMap(([color, n]) => Array.from({ length: n }, () => color));
  const spots = scatter(r, LEAVES_PX, all.length, size * 1.1);
  spots.forEach(([x, y], i) => {
    ctx.fillStyle = all[i];
    const [l, w, a] = [size * (0.8 + r() * 0.4), size * 0.22, r() * Math.PI];
    const [cx, cy] = [Math.cos(a) * (l / 2), Math.sin(a) * (l / 2)];
    wrapped(LEAVES_PX, x, y, (x, y) => {
      ctx.beginPath();
      ctx.moveTo(x - cx, y - cy);
      ctx.quadraticCurveTo(x - Math.sin(a) * w * 2, y + Math.cos(a) * w * 2, x + cx, y + cy);
      ctx.quadraticCurveTo(x + Math.sin(a) * w * 2, y - Math.cos(a) * w * 2, x - cx, y - cy);
      ctx.fill();
    });
  });
  return [c, ctx, r];
}

/**
 * A bramble thicket's leaves (#749, #1091): greyer and wilder than the clipped hedge, its leaves bigger and more
 * apart in tone, a few showing their pale undersides, with a few blackberries. Its faces you see are mostly turned
 * from the sun, so it is no darker than the hedge itself: dark green, never black. Its thorny canes are their own meshes (sceneStile.ts).
 */
export function bramble(): OffscreenCanvas {
  const [c, ctx, r] = leaves(749, "#4a6a45", [["#3b5638", 12], ["#5d8052", 10], ["#7a9a68", 4]], 34);
  const dot = (x: number, y: number, rad: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  // A blackberry is a little knot of round drupelets, one of them catching the light: a lone dark dot reads as a hole.
  for (let i = 0; i < 4; i++) {
    const [x, y] = [r() * LEAVES_PX, r() * LEAVES_PX];
    wrapped(LEAVES_PX, x, y, (x, y) => {
      for (const [dx, dy] of [[0, -4], [-3.5, 0], [3.5, 0], [0, 4]]) dot(x + dx, y + dy, 3.6, "#2a1d33");
      dot(x - 1.5, y - 4.5, 1.4, "#6a5a8a");
    });
  }
  return c;
}

/** A bramble cane (#749): one flat dark red-purple. */
export function cane(): OffscreenCanvas {
  const [c, ctx] = canvas(4, 4);
  px(ctx, 0, 0, "#5e3442", 4, 4);
  return c;
}

/**
 * A metre of picket fence (#1091): four pickets with pointed tops in front of two rails, cut out (transparent between
 * them). Each picket's right side is a shade darker, turned from the light. The pickets fill a little over half of the
 * width, so far off, where the mipmaps average them, the fence stays a solid pale band and does not fade out (alphaTest 0.5).
 */
export function picket(): OffscreenCanvas {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  // The rails behind, their undersides in shade.
  for (const y of [88, 192]) {
    px(ctx, 0, y, "#e7dfd0", S, 24);
    px(ctx, 0, y + 24, "#c8bda9", S, 6);
  }
  for (let i = 0; i < 4; i++) {
    const x = i * 64 + 14;
    const [w, shoulder, tip] = [36, 50, 30];
    ctx.fillStyle = "#f3eee4";
    ctx.beginPath();
    ctx.moveTo(x, S);
    ctx.lineTo(x, shoulder);
    ctx.lineTo(x + w / 2, tip);
    ctx.lineTo(x + w, shoulder);
    ctx.lineTo(x + w, S);
    ctx.fill();
    ctx.fillStyle = "#ddd4c4";
    ctx.beginPath();
    ctx.moveTo(x + w - 7, S);
    ctx.lineTo(x + w - 7, shoulder - 7 * ((shoulder - tip) / (w / 2)));
    ctx.lineTo(x + w, shoulder);
    ctx.lineTo(x + w, S);
    ctx.fill();
  }
  return c;
}

/** Thick hedge leaves (#315, #1091): dense and dark, with no gaps to see through, a few leaves catching the light. */
export function hedge(): OffscreenCanvas {
  return leaves(11, "#3e653a", [["#345834", 10], ["#4a7444", 10], ["#5c8752", 3]], 30)[0];
}

/**
 * The old wooden door in the hedge (#315, #1091): upright planks with crisp seams, two iron bands with rivets, a ring
 * and a keyhole. 4 texels to each of the first drawing's: KEYHOLE (sceneDoor.ts) is placed by that drawing's texels.
 * The keyhole is drawn dark: a warm light shows through it (sceneDoor.ts).
 */
export function door(): OffscreenCanvas {
  const [W, H] = [128, 256];
  const [c, ctx] = canvas(W, H);
  px(ctx, 0, 0, "#8a6a4a", W, H);
  // Upright planks: a fine grain line down each, and a dark seam between them.
  const r = rng(13);
  ctx.strokeStyle = "#7f6144";
  ctx.lineWidth = 1.5;
  for (const x of [0, 32, 64, 96]) {
    const gx = x + 10 + r() * 12;
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.bezierCurveTo(gx + 3, H * 0.3, gx - 3, H * 0.6, gx + 1, H);
    ctx.stroke();
    px(ctx, x, 0, "#5c4632", 3, H);
  }
  px(ctx, W - 3, 0, "#5c4632", 3, H);
  // Iron bands with rivets.
  for (const y of [40, 200]) {
    px(ctx, 0, y, "#3b3a3a", W, 12);
    px(ctx, 0, y, "#5b5a58", W, 3);
    ctx.fillStyle = "#8d8a85";
    for (const x of [14, 46, 78, 110]) {
      ctx.beginPath();
      ctx.arc(x, y + 7, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // A ring handle, and the keyhole below it, on the latch side.
  ctx.strokeStyle = "#3b3a3a";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(104, 118, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#3b3a3a";
  ctx.beginPath();
  ctx.arc(104, 143, 6, 0, Math.PI * 2);
  ctx.moveTo(100, 145);
  ctx.lineTo(97, 160);
  ctx.lineTo(111, 160);
  ctx.lineTo(108, 145);
  ctx.fill();
  return c;
}

/** A small old key lying on the ground (#315): a brass ring, a shaft and a bit. 8 texels to each of the first 14×5 drawing's. */
export function key(): OffscreenCanvas {
  const [c, ctx] = canvas(14 * 8, 5 * 8);
  ctx.scale(8, 8);
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#c9962e";
  ctx.beginPath();
  ctx.moveTo(4.4, 2.5);
  ctx.lineTo(12.5, 2.5);
  ctx.moveTo(10.5, 2.5);
  ctx.lineTo(10.5, 4.4);
  ctx.moveTo(12.5, 2.5);
  ctx.lineTo(12.5, 4.4);
  ctx.stroke();
  ctx.strokeStyle = "#e0b24a";
  ctx.beginPath();
  ctx.arc(2.5, 2.5, 1.9, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

export interface Sky {
  top: string;
  mid: string;
  horizon: string;
  fog: string;
  tint: [number, number, number];
}

export const SKIES: Record<"day" | "dusk" | "night", Sky> = {
  day: { top: "#86a9cc", mid: "#b2c8df", horizon: "#e8eae8", fog: "#dde3e2", tint: [1, 1, 1] },
  dusk: { top: "#6c6a92", mid: "#c3909a", horizon: "#f0c6a2", fog: "#e6c0a8", tint: [1, 0.88, 0.8] },
  night: { top: "#0f1318", mid: "#1a212b", horizon: "#2b3542", fog: "#1c232d", tint: [0.44, 0.5, 0.62] },
};

/** The sky's gradient for the inside of the sky dome: a smooth blend, a row per texel. */
export function sky(s: Sky, stars: boolean): OffscreenCanvas {
  const [c, ctx] = canvas(64, 64);
  const top = new THREE.Color(s.top);
  const mid = new THREE.Color(s.mid);
  const hor = new THREE.Color(s.horizon);
  for (let y = 0; y < 64; y++) {
    const t = y / 63;
    const col = t < 0.5 ? top.clone().lerp(mid, t * 2) : mid.clone().lerp(hor, (t - 0.5) * 2);
    // v=0 is the bottom of the texture in three.js; top rows are the zenith.
    px(ctx, 0, y, `#${col.getHexString()}`, 64, 1);
  }
  if (stars) {
    const r = rng(11);
    for (let i = 0; i < 70; i++) px(ctx, Math.floor(r() * 64), Math.floor(r() * 34), r() < 0.2 ? "#fff3cf" : "#d7e3ef");
  }
  return c;
}

/** Rows in the far hills' profile (hillProfile), top to bottom. */
export const HILL_ROWS = 64;
/** The far hills' texture is drawn this many texels to each row and column of the profile, so a ridge is a smooth line (#1091). */
const HILL_FINE = 4;
/** The two ridges of the far hills, back to front: the row of the middle of each, and its seed. */
const RIDGES = [
  { base: 30, seed: 1 },
  { base: 42, seed: 2 },
] as const;

/** One layer of the far hills: the ridge's row (0 = top) at column x of the profile's 256, x from 0 to 256. */
function hillLine(base: number, seed: number): (x: number) => number {
  const r = rng(seed);
  const ph = r() * 10;
  return (x) => {
    // Periodic in x so the ring repeats without a seam.
    const a = (x / 256) * Math.PI * 2;
    return base - 9 * Math.sin(a * 2 + ph) - 5 * Math.sin(a * 5 + ph * 2) - 2 * Math.sin(a * 11 + ph);
  };
}

/** The top of the hills (the higher of the two ridges) in each of 256 columns, as a row. Day and night share the shape. */
export function hillProfile(): number[] {
  const [a, b] = RIDGES.map((r) => hillLine(r.base, r.seed));
  return Array.from({ length: 256 }, (_, x) => Math.min(a(x), b(x)));
}

/** Two layers of rolling hills, flat colour with a crisp ridge, for a ring around the world. */
export function hills(night: boolean): OffscreenCanvas {
  const [W, H] = [256 * HILL_FINE, HILL_ROWS * HILL_FINE];
  const [c, ctx] = canvas(W, H);
  // Colour and shade for each ridge, in RIDGES order.
  const colors: [string, string][] = night
    ? [
        ["#28313c", "#252d37"],
        ["#1d242d", "#1a2029"],
      ]
    : [
        ["#b0cb99", "#a8c392"],
        ["#77a363", "#6f9a5c"],
      ];
  // Everything under a ridge `down` rows lower, one point a texel.
  const under = (line: (x: number) => number, down: number) => {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x++) ctx.lineTo(x, (line(x / HILL_FINE) + down) * HILL_FINE);
    ctx.lineTo(W, H);
    ctx.fill();
  };
  RIDGES.forEach(({ base, seed }, i) => {
    const [color, shade] = colors[i];
    const line = hillLine(base, seed);
    ctx.fillStyle = color;
    under(line, 0);
    // A shade a little below the ridge, so the near hill reads as a fold in paper.
    ctx.fillStyle = shade;
    under(line, 3);
  });
  return c;
}

/**
 * A crown of round leaf masses as paper (#1091), `blobs` as [x, y, radius]. The highest mass is at the back and the
 * lowest in front. Each is a disc in the dark shade with a disc of the middle shade over its upper left and a small
 * light one higher still, kept inside its own disc: a crisp cut-out lit from the top left, its lower right in shade.
 */
function crown(ctx: OffscreenCanvasRenderingContext2D, blobs: readonly (readonly [number, number, number])[], [light, mid, dark]: readonly string[]) {
  for (const [x, y, rad] of [...blobs].sort((a, b) => a[1] - b[1])) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.clip();
    oval(ctx, dark, x, y, rad);
    oval(ctx, mid, x - rad * 0.14, y - rad * 0.16, rad * 0.94);
    oval(ctx, light, x - rad * 0.4, y - rad * 0.44, rad * 0.48);
    ctx.restore();
  }
}

/** A trunk from `top` down to `bottom`, `w` wide, its right side a shade darker, turned from the light. */
function trunk(ctx: OffscreenCanvasRenderingContext2D, cx: number, top: number, bottom: number, w: number, [lit, shade]: readonly [string, string]) {
  px(ctx, cx - w / 2, top, lit, w, bottom - top);
  px(ctx, cx + w * 0.1, top, shade, w * 0.4, bottom - top);
}

/** Texels to each of the first far trees drawing's: trees() draws in its texels, so TREE_KINDS (scenery.ts) still fits. */
const TREE_FINE = 4;

/** Trees and bushes for outside the fence, as paper (#1115): one atlas, 4 cells of 64×128 in the first drawing's texels. */
export function trees(): OffscreenCanvas {
  const [c, ctx] = canvas(256 * TREE_FINE, 128 * TREE_FINE);
  ctx.scale(TREE_FINE, TREE_FINE);
  const bark = ["#7f644a", "#634d39"] as const;
  // 0: round oak
  trunk(ctx, 32, 70, 128, 6, bark);
  crown(ctx, [[22, 58, 14], [42, 56, 15], [32, 40, 17]], ["#93b775", "#6e9a5c", "#4f7845"]);
  // 1: pine, five tiers, each upper one over the one below it: a cone with its left face lit and its right in shade.
  trunk(ctx, 96, 100, 128, 4, bark);
  for (let i = 4; i >= 0; i--) {
    const y = 18 + i * 17;
    const w = 7 + i * 5;
    const [apex, base] = [[96, y], y + 20] as const;
    polygon(ctx, "#47715a", [apex, [96 - w, base], [96 + w, base]]);
    polygon(ctx, "#5a866a", [apex, [96 - w, base], [96 - w / 3, base]]);
    polygon(ctx, "#36564a", [apex, [96 + w / 2, base], [96 + w, base]]);
  }
  // 2: blossom tree
  trunk(ctx, 160, 74, 128, 6, bark);
  crown(ctx, [[148, 58, 14], [172, 58, 13], [160, 42, 16]], ["#f3d3dc", "#e2a8ba", "#c9849a"]);
  // 3: bush with berries
  crown(ctx, [[214, 112, 14], [236, 114, 12]], ["#86ad6c", "#66904f", "#4b723f"]);
  const r = rng(24);
  for (let i = 0; i < 9; i++) oval(ctx, "#dc5636", 205 + r() * 38, 105 + r() * 14, 1.1);
  return c;
}

/**
 * Texels to each of the first orchard drawing's: orchard() draws in its texels, as orchardArt.ts gives the shapes.
 * Fewer than the far trees': the atlas has 33 cells, and copying it to the GPU is one main-thread step.
 */
const ORCHARD_FINE = 2;

/**
 * The orchard's trees (#315, orchardArt.ts) as paper (#1091): every kind in every look, a column per kind (in
 * ORCHARD_WORDS order), a row per look (LOOKS). Flowers and fruit are small round cut-outs on the crown.
 */
export function orchard(): OffscreenCanvas {
  const [c, ctx] = canvas(CELL_W * ORCHARD_WORDS.length * ORCHARD_FINE, CELL_H_PX * LOOKS.length * ORCHARD_FINE);
  ctx.scale(ORCHARD_FINE, ORCHARD_FINE);
  ORCHARD_WORDS.forEach((kind, col) =>
    LOOKS.forEach((look, row) => {
      const s = TREE_SHAPES[kind];
      ctx.save();
      ctx.translate(col * CELL_W, row * CELL_H_PX);
      const mid = CELL_W / 2;
      // The same seed in every look, so blossom and fruit sit on the very same tree.
      const r = rng(70 + col);
      if (s.trellis) {
        for (const sx of [-1, 1]) trunk(ctx, mid + sx * TRELLIS.half + 0.5, TRELLIS.top, CELL_H_PX, 3, ["#8a6440", "#6e4e30"]);
        px(ctx, mid - TRELLIS.half, TRELLIS.top + 2, "#a37a52", TRELLIS.half * 2, 2);
        px(ctx, mid - TRELLIS.half, TRELLIS.top + 22, "#a37a52", TRELLIS.half * 2, 2);
      }
      trunk(ctx, mid, s.trunk.top, CELL_H_PX, s.trunk.w, ["#7a5233", "#5c3b22"]);
      const blobs = s.blobs.map(([dx, cy, rad]) => [mid + dx, cy, rad] as const);
      crown(ctx, blobs, s.leaf);
      // A spot well inside the crown: a mass picked by its area, then a point at least 3 texels in from its edge.
      const area = blobs.reduce((sum, [, , rad]) => sum + rad * rad, 0);
      const spot = (): [number, number] => {
        let pick = r() * area;
        // The last mass if rounding leaves `pick` a hair over the total.
        const [x, y, rad] = blobs.find(([, , rad]) => (pick -= rad * rad) < 0) ?? blobs[blobs.length - 1];
        const [a, d] = [r() * Math.PI * 2, Math.sqrt(r()) * (rad - 3)];
        return [x + Math.cos(a) * d, y + Math.sin(a) * d];
      };
      if (look === "blossom")
        for (let i = 0; i < 40; i++) {
          const [x, y] = spot();
          oval(ctx, s.blossom[i % s.blossom.length], x, y, i % 3 ? 1.3 : 1.8);
        }
      if (look === "fruit")
        for (let i = 0; i < s.fruit.count; i++) {
          const [x, y] = spot();
          fruit(ctx, s.fruit, x, y);
        }
      ctx.restore();
    }),
  );
  return c;
}

/** One of a tree's fruit (or the plain tree's nest) at (x, y), in the orchard's units: on its tree, and fallen (fruitAtlas). */
function fruit(ctx: OffscreenCanvasRenderingContext2D, f: Fruit, x: number, y: number) {
  const [light, dark] = f.color;
  if (f.shape === "round" || f.shape === "small") {
    const rad = f.shape === "round" ? 1.7 : 1.1;
    oval(ctx, dark, x, y, rad);
    oval(ctx, light, x - rad * 0.2, y - rad * 0.2, rad * 0.7);
  } else if (f.shape === "pair") {
    ctx.strokeStyle = "#4e7a2a";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x - 1, y + 1);
    ctx.lineTo(x + 0.5, y - 2);
    ctx.lineTo(x + 2.5, y + 1.5);
    ctx.stroke();
    oval(ctx, dark, x - 1, y + 1.5, 1.2);
    oval(ctx, light, x + 2.5, y + 2, 1.2);
  } else if (f.shape === "drop") {
    oval(ctx, light, x, y + 1.6, 1.6);
    oval(ctx, light, x, y, 1);
    oval(ctx, dark, x + 0.6, y + 2.2, 0.8);
  } else if (f.shape === "bunch") {
    // Grapes, three in a row, then two, then one.
    for (const [gx, gy] of [[-2, 0], [0, 0], [2, 0], [-1, 1.8], [1, 1.8], [0, 3.6]]) oval(ctx, (gx + gy) % 2 ? dark : light, x + gx, y + gy, 1.1);
  } else {
    // The plain tree's nest, with one pale egg in it.
    oval(ctx, "#f4efe2", x - 1, y - 0.6, 1.2, 1);
    oval(ctx, dark, x, y, 5.5, 2.2, "bottom");
    px(ctx, x - 5.5, y - 0.6, light, 11, 1.2);
  }
}

/** How far each fruit() shape reaches below its (x, y): a fallen one lies on its lowest point. */
const FRUIT_FOOT: Record<Fruit["shape"], number> = { round: 1.7, small: 1.1, pair: 3.2, drop: 3.2, bunch: 4.7, nest: 2.2 };

/** Texels to each of the first cloud drawing's: the puffs below are in its texels. */
const CLOUD_FINE = 4;

/** A cloud of four round puffs on a flat base (#1091): lit on top, a shade darker underneath. */
export function cloud(): OffscreenCanvas {
  const [c, ctx] = canvas(64 * CLOUD_FINE, 32 * CLOUD_FINE);
  ctx.scale(CLOUD_FINE, CLOUD_FINE);
  // [x, y, radius]
  const puffs = [
    [18, 20, 10],
    [32, 14, 13],
    [46, 20, 10],
    [28, 22, 9],
  ];
  const all = (color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [x, y, rad] of puffs) {
      ctx.moveTo(x + rad, y);
      ctx.arc(x, y, rad, 0, Math.PI * 2);
    }
    ctx.fill();
  };
  // The base is cut flat.
  ctx.beginPath();
  ctx.rect(0, 0, 64, 30);
  ctx.clip();
  all("#fbf8f1");
  // The underside, below a level line.
  ctx.beginPath();
  ctx.rect(0, 24, 64, 6);
  ctx.clip();
  all("#e6e3dc");
  return c;
}

/** Units on a side of each of the walk's butterfly frames: the butterfly, 13 wide, in the middle. */
const FLY_CELL = 16;

/** A butterfly in `hue` (visitorArt.ts butterflyIn) in two frames side by side, 8 texels to a unit: wings open, then closed. */
export function butterfly(hue: number): OffscreenCanvas {
  const [c, ctx] = canvas(2 * FLY_CELL * 8, FLY_CELL * 8);
  Art.butterflyIn(hue).forEach((art, i) => cutout(ctx, art, (i * FLY_CELL + (FLY_CELL - art.w) / 2) * 8, ((FLY_CELL - art.h) / 2) * 8, 8));
  return c;
}

/** Texels per unit of the boards' first drawing: the signs, notices and the doormat are drawn this much finer, so their text is smooth. */
const BOARD_FINE = 4;
const BOARD_EDGE = "#8a6a49";

/** A blank wooden board, w×h units: a thin darker edge, a lit top edge and a seam across the middle. Set up for centred text in dark ink. */
function board(w: number, h: number): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const [c, ctx] = canvas(w * BOARD_FINE, h * BOARD_FINE);
  ctx.scale(BOARD_FINE, BOARD_FINE);
  plank(ctx, 0, 0, w, h);
  return [c, ctx];
}

/** board()'s wood at (x, y), and the ink set for its text. */
function plank(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  px(ctx, x, y, BOARD_EDGE, w, h);
  px(ctx, x + 1.25, y + 1.25, "#c4a273", w - 2.5, h - 2.5);
  px(ctx, x + 1.25, y + 1.25, "#d6b98c", w - 2.5, 1.5);
  px(ctx, x + 1.25, y + h / 2, "#b08f62", w - 2.5, 0.75);
  ctx.fillStyle = "#3b2a1c";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
}

/** Board text is in the app's display face (index.css --display), as if the app had painted the signs. */
const boardFont = (size: number) => `${size}px Gloock, Georgia, serif`;
/** The app's text face (index.css --ui), bold: a hand's fix in marker, and a doormat's word. */
const plainFont = (size: number, slant = "") => `${slant} 700 ${size}px "Onest Variable", sans-serif`;

/**
 * Loads the boards' faces. A canvas draws text in a face that is not loaded yet in a fallback and never draws it
 * again, so the walk waits for this before it draws a board.
 */
export const loadBoardFonts = () => Promise.all([document.fonts.load(boardFont(16)), document.fonts.load(plainFont(16))]);

/** The bed signs' atlas: SIGN.cols signs a row, each SIGN.w×SIGN.h texels. Rows keep the atlas within an old GPU's 4096 texels up to 100 signs. */
export const SIGN = { w: 128 * BOARD_FINE, h: 40 * BOARD_FINE, cols: 4 } as const;

/**
 * Every bed's wooden sign with its label, on one canvas: sign `i` at column i % SIGN.cols, row ⌊i / SIGN.cols⌋.
 * A canvas per sign cost ~130 ms over the walk's beds at CPU 10×, mostly the first draw on each new canvas (#571).
 */
export function signs(labels: string[]): OffscreenCanvas {
  const rows = Math.ceil(labels.length / SIGN.cols);
  const [c, ctx] = canvas(SIGN.w * SIGN.cols, SIGN.h * rows);
  // The empty cells after the last sign in the board's edge colour: far off, a mipmap mixes a cell with its neighbour.
  px(ctx, 0, 0, BOARD_EDGE, c.width, c.height);
  ctx.scale(BOARD_FINE, BOARD_FINE);
  const [w, h] = [SIGN.w / BOARD_FINE, SIGN.h / BOARD_FINE];
  labels.forEach((label, i) => {
    const x = (i % SIGN.cols) * w;
    const y = Math.floor(i / SIGN.cols) * h;
    plank(ctx, x, y, w, h);
    let size = 20;
    do ctx.font = boardFont(size);
    while (ctx.measureText(label).width > w - 20 && --size > 7);
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  });
  return c;
}

/** A taller notice board for a short sentence: up to two lines, as large as fits. */
export function notice(text: string): OffscreenCanvas {
  const W = 160;
  const H = 64;
  const [c, ctx] = board(W, H);
  const font = (size: number) => (ctx.font = boardFont(size));
  const fits = (lines: string[]) => lines.every((l) => ctx.measureText(l).width <= W - 14);
  // Every way to break the words into one or two lines; keep the one with the biggest text.
  const words = text.split(" ");
  const options = [[text], ...words.slice(1).map((_, i) => [words.slice(0, i + 1).join(" "), words.slice(i + 1).join(" ")])];
  let best = { size: 0, lines: [text] };
  for (const lines of options)
    for (let size = lines.length === 1 ? 22 : 18; size > 7; size--) {
      font(size);
      if (fits(lines)) {
        // At the same size, two balanced lines read better than one long and one short.
        const longest = (ls: string[]) => Math.max(...ls.map((l) => l.length));
        if (size > best.size || (size === best.size && lines.length === best.lines.length && longest(lines) < longest(best.lines))) best = { size, lines };
        break;
      }
    }
  font(best.size || 8);
  const step = best.size + 4;
  best.lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + 1 + (i - (best.lines.length - 1) / 2) * step));
  return c;
}

/** The pond (#1091): one calm blue, with a few long, thin ripples a shade paler. The pond drifts it (sceneSky.ts). */
export function water(): OffscreenCanvas {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  px(ctx, 0, 0, "#779ec6", S, S);
  const r = rng(5);
  ctx.strokeStyle = "#93b5d8";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  for (const [x, y] of scatter(r, S, 7, 56)) {
    const l = 24 + r() * 30;
    wrapped(S, x, y, (x, y) => {
      ctx.beginPath();
      ctx.moveTo(x - l / 2, y);
      ctx.quadraticCurveTo(x, y - 4, x + l / 2, y);
      ctx.stroke();
    });
  }
  return c;
}

/** A lily pad seen from above: a round leaf with a notch cut to its middle, its rim a shade darker, a few veins and a small pink flower. 8 texels to each of the first 16×16 drawing's. */
export function lilypad(): OffscreenCanvas {
  const [c, ctx] = canvas(16 * 8, 16 * 8);
  ctx.scale(8, 8);
  // The notch opens to the right, as wide as the first drawing's.
  const notch = Math.atan(0.5);
  const leaf = (r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.arc(8, 8, r, notch, Math.PI * 2 - notch);
    ctx.closePath();
    ctx.fill();
  };
  leaf(7, "#4c7f47");
  leaf(5.6, "#6f9a5c");
  ctx.strokeStyle = "#5f8c52";
  ctx.lineWidth = 0.3;
  ctx.lineCap = "round";
  for (const a of [1.3, 2.3, 3.2, 4.1, 5.1]) {
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.lineTo(8 + Math.cos(a) * 4.8, 8 + Math.sin(a) * 4.8);
    ctx.stroke();
  }
  oval(ctx, "#e9a3bb", 6, 6, 1.2);
  oval(ctx, "#f8dbe4", 5.8, 5.8, 0.5);
  return c;
}

/** An arrow that bobs over the selected plant: folded paper, its right half a shade darker, with a dark edge. 8 texels to each of the first 16×16 drawing's. */
export function marker(): OffscreenCanvas {
  const [c, ctx] = canvas(16 * 8, 16 * 8);
  ctx.scale(8, 8);
  const arrow = new Path2D("M5.5 3.5 L10.5 3.5 L10.5 6.5 L13.5 6.5 L8 11.8 L2.5 6.5 L5.5 6.5 Z");
  ctx.fillStyle = "#ffd84a";
  ctx.fill(arrow);
  ctx.save();
  ctx.clip(arrow);
  px(ctx, 8, 0, "#f2be2e", 8, 16);
  ctx.restore();
  ctx.strokeStyle = "#5a2a12";
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.stroke(arrow);
  return c;
}

/** The key's late glint (#334): a warm four-point star with a dark edge, so it shows on pale sand and on grass. 8 texels to each of the first 11×11 drawing's. */
export function sparkle(): OffscreenCanvas {
  const [c, ctx] = canvas(11 * 8, 11 * 8);
  ctx.scale(8, 8);
  // Four points `r` from the middle, their sides curved in.
  const star = (r: number, color: string) => {
    const [m, k] = [5.5, r * 0.18];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(m, m - r);
    ctx.quadraticCurveTo(m + k, m - k, m + r, m);
    ctx.quadraticCurveTo(m + k, m + k, m, m + r);
    ctx.quadraticCurveTo(m - k, m + k, m - r, m);
    ctx.quadraticCurveTo(m - k, m - k, m, m - r);
    ctx.fill();
  };
  star(5.3, "#4a2410");
  star(4.2, "#f2a531");
  star(2.3, "#fffbe0");
  return c;
}

/** Where a tap sends you (#336): a small pale ring on the ground. 16 texels to each of the first 10×10 drawing's. */
export function spot(): OffscreenCanvas {
  const [c, ctx] = canvas(10 * 16, 10 * 16);
  ctx.scale(16, 16);
  ctx.strokeStyle = "#fff6d8";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(5, 5, 4.5, 2.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

// ---- Deadpan scenery (#364) -------------------------------------------------

/**
 * The notice "No fishing. No fish." put right by hand (#364): the printed
 * text, with `strike` crossed out in red marker and `write` written in after it.
 */
export function fixedNotice(text: string, strike: string, write: string): OffscreenCanvas {
  const W = 160;
  const H = 64;
  const [c, ctx] = board(W, H);
  const first = text.slice(0, text.lastIndexOf(strike)).trim();
  const hand = (size: number) => plainFont(size, "italic");
  // Two lines: the first as printed; on the second, the struck words, then the fix. As large as fits.
  let size = 18;
  const width = (s: number) => {
    ctx.font = boardFont(s);
    const a = ctx.measureText(first).width;
    const b = ctx.measureText(`${strike} `).width;
    ctx.font = hand(s);
    return { first: a, second: b + ctx.measureText(write).width, strike: b };
  };
  while (size > 8 && Math.max(width(size).first, width(size).second) > W - 14) size--;
  const w = width(size);
  const step = size + 4;
  const y1 = H / 2 + 1 - step / 2;
  const y2 = H / 2 + 1 + step / 2;
  const x0 = Math.round((W - w.second) / 2);
  ctx.font = boardFont(size);
  ctx.fillText(first, W / 2, y1);
  ctx.textAlign = "left";
  ctx.fillText(strike, x0, y2);
  const red = "#b3261e";
  const struck = ctx.measureText(strike).width;
  px(ctx, x0 - 2, y2 - 1, red, struck + 4, 1.5);
  ctx.font = hand(size);
  ctx.fillStyle = red;
  ctx.fillText(write, x0 + w.strike, y2 - 1);
  return c;
}

/**
 * The sundial's face (#364, #1091), seen from above, noon at the top: a flat bronze disc in a darker rim, with crisp
 * hour marks from 6 in the morning (left) to 6 in the evening (right), longer every three hours. It fills the square,
 * corners in the rim's colour: a round mesh cuts the disc out (sceneJokes.ts), so its edge needs no alpha.
 */
export function sundialFace(): OffscreenCanvas {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const m = S / 2;
  px(ctx, 0, 0, "#6e5226", S, S);
  oval(ctx, "#b48c4a", m, m, 116);
  ctx.strokeStyle = "#9a7a3e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(m, m, 60, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#4a3418";
  for (let h = 6; h <= 18; h++) {
    const a = ((h - 12) * Math.PI) / 12;
    const long = h % 3 === 0;
    ctx.lineWidth = long ? 6 : 4;
    ctx.beginPath();
    for (const r of [long ? 72 : 88, 104]) ctx.lineTo(m + Math.sin(a) * r, m - Math.cos(a) * r);
    ctx.stroke();
  }
  oval(ctx, "#8a6a32", m, m, 9);
  return c;
}

/** Two small letters cut into the sundial's stone (#869), "E.J", in 8×5 units of 1 cm (16 texels each), the rest clear. */
export function carvedLetters(): OffscreenCanvas {
  const [c, ctx] = canvas(8 * 16, 5 * 16);
  ctx.scale(16, 16);
  const ink = "#625c55";
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.85;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D("M2.4 0.5 L0.5 0.5 L0.5 4.5 L2.4 4.5 M0.5 2.5 L1.8 2.5 M5.1 0.5 L7.5 0.5 M6.5 0.5 L6.5 3.3 Q6.5 4.5 5.5 4.5 Q4.6 4.5 4.5 3.6"));
  oval(ctx, ink, 3.4, 4.4, 0.45);
  return c;
}

/** Two cup rings stained into the bench's seat (#869), side by side, the second not quite closed: 12×6 units of 2 cm (16 texels each), the rest clear. */
export function cupRings(): OffscreenCanvas {
  const [c, ctx] = canvas(12 * 16, 6 * 16);
  ctx.scale(16, 16);
  ctx.strokeStyle = "#7c4f2a";
  ctx.lineWidth = 0.8;
  for (const [x, from, to] of [
    [3, 0, Math.PI * 2],
    [8.5, 0.7, Math.PI * 2 - 0.2],
  ]) {
    ctx.beginPath();
    ctx.arc(x, 3, 2, from, to);
    ctx.stroke();
  }
  return c;
}

/** Weathered stone (#1091), for the sundial and the lookout's flat stone: one flat grey and a few crisp cracks a shade darker. No light chips: stretched up a pillar, they read as smudges. */
export function stone(): OffscreenCanvas {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  px(ctx, 0, 0, "#a9a29a", S, S);
  const r = rng(23);
  ctx.strokeStyle = "#8d867e";
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // A crack: three short bends, each turned a little from the last.
  for (const [x, y] of scatter(r, S, 3, 40)) {
    const a = r() * Math.PI * 2;
    const bends = [0, 1, 2].map(() => [a + (r() - 0.5) * 1.2, 7 + r() * 9]);
    wrapped(S, x, y, (x, y) => {
      let [cx, cy] = [x, y];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (const [b, l] of bends) {
        [cx, cy] = [cx + Math.cos(b) * l, cy + Math.sin(b) * l];
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    });
  }
  return c;
}

/**
 * The mouse door (#364): a tiny arched wooden door in a stone frame, with a
 * brass knob. Once it opens (#882), its frame round a dark doorway ("way"),
 * and the wooden door alone ("leaf"), swung open. 8 texels to each of the first 12×16 drawing's.
 */
export function mouseDoor(part: "shut" | "way" | "leaf"): OffscreenCanvas {
  const [c, ctx] = canvas(12 * 8, 16 * 8);
  ctx.scale(8, 8);
  // The arch, `inset` in from the stone's outside, down to `bottom`.
  const arch = (inset: number, bottom: number) => {
    ctx.beginPath();
    ctx.moveTo(inset, bottom);
    ctx.arc(6, 6, 6 - inset, Math.PI, Math.PI * 2);
    ctx.lineTo(12 - inset, bottom);
    ctx.closePath();
  };
  if (part !== "leaf") {
    ctx.fillStyle = "#8d8a85";
    arch(0, 16);
    ctx.fill();
  }
  if (part === "way") {
    ctx.fillStyle = "#1c130c";
    arch(1, 15);
    ctx.fill();
    return c;
  }
  // The door: a dark edge round its planks, a seam between them and two battens across.
  const dark = "#5a3820";
  ctx.fillStyle = dark;
  arch(1, 15);
  ctx.fill();
  ctx.save();
  arch(1.7, 14.3);
  ctx.clip();
  px(ctx, 0, 0, "#9c6a3d", 12, 16);
  px(ctx, 6.2, 0, dark, 0.6, 16);
  px(ctx, 0, 6.2, dark, 12, 0.6);
  px(ctx, 0, 12.2, dark, 12, 0.6);
  ctx.restore();
  oval(ctx, "#e0b24a", 9.5, 9.5, 0.6);
  return c;
}

/**
 * A gardener's note on its nail (#654): a scrap of paper with pencil lines, a folded corner and the nail at the top.
 * One not read yet (#673) is a little whiter, on a bright brass pin; once read, it is the old paper on a grey nail.
 */
export function notePaper(unread: boolean): OffscreenCanvas {
  // 8 texels to each of the first 12×14 drawing's (#1091): the same shape on the same planes, drawn as paper.
  const [W, H] = [96, 112];
  const [c, ctx] = canvas(W, H);
  px(ctx, 0, 8, unread ? "#e4dabf" : "#d8cdb0", W, H - 8);
  px(ctx, 3, 11, unread ? "#fcf7e6" : "#f1e8d0", W - 6, H - 14);
  ctx.strokeStyle = "#9a917e";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const [y, len] of [
    [44, 64],
    [58, 58],
    [72, 66],
    [86, 38],
  ]) {
    ctx.beginPath();
    ctx.moveTo(16, y);
    ctx.lineTo(16 + len, y);
    ctx.stroke();
  }
  // The folded bottom corner: its flap turned over onto the paper, so the corner itself is gone.
  const f = 16;
  ctx.clearRect(W - f, H - f, f, f);
  polygon(ctx, "#c7bb9c", [
    [W - f, H],
    [W, H - f],
    [W - f, H - f],
  ]);
  // The nail through the top, a bright brass pin while unread.
  oval(ctx, unread ? "#b8892e" : "#5c5a57", W / 2, 9, 7);
  if (unread) oval(ctx, "#f0d27a", W / 2 - 2.5, 6.5, 2.5);
  return c;
}

/** The gardener's diary on the hill (#858), seen from above: a worn leather cover with a strap. Its sides are the same: at its size the page edges would not show. 8 texels to each of the first 10×12 drawing's. */
export function diary(): OffscreenCanvas {
  const [c, ctx] = canvas(10 * 8, 12 * 8);
  ctx.scale(8, 8);
  px(ctx, 0, 0, "#3e2a1f", 10, 12);
  px(ctx, 0.8, 0.8, "#6b4a33", 8.4, 10.4);
  oval(ctx, "#7d5a3f", 3.4, 3.4, 1.7, 1.5);
  px(ctx, 0, 7, "#2c1d15", 10, 1);
  return c;
}

/** The diary's ribbon (#858), red, its right half in shade: it stands out on the grey stone and the brown cover. */
export function ribbon(): OffscreenCanvas {
  const [c, ctx] = canvas(2 * 8, 8 * 8);
  ctx.scale(8, 8);
  px(ctx, 0, 0, "#b8352e", 2, 8);
  px(ctx, 1, 0, "#8e2722", 1, 8);
  return c;
}

/** The mouse door's mat (#364), seen from above: coir with a dark edge and `word` on it (none for a course without one). */
export function doormat(word: string | null): OffscreenCanvas {
  const [c, ctx] = canvas(48 * BOARD_FINE, 14 * BOARD_FINE);
  ctx.scale(BOARD_FINE, BOARD_FINE);
  px(ctx, 0, 0, "#7a5528", 48, 14);
  px(ctx, 1, 1, "#c09048", 46, 12);
  if (word) {
    let size = 10;
    ctx.font = plainFont(size);
    while (size > 5 && ctx.measureText(word).width > 42) ctx.font = plainFont(--size);
    ctx.fillStyle = "#3b2414";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(word, 24, 7.5);
  }
  return c;
}

/** The fish that jumps (#364), from the side, head to the right. */
export function leapingFish(): OffscreenCanvas {
  const art = Art.LEAPING_FISH;
  const [c, ctx] = canvas(art.w * VISITOR_PX, art.h * VISITOR_PX);
  cutout(ctx, art, 0, 0, VISITOR_PX);
  return c;
}

/** Where the fish went in (#364): a pale ring on the water, seen from above. 8 texels to each of the first 16×16 drawing's. */
export function ripple(): OffscreenCanvas {
  const [c, ctx] = canvas(16 * 8, 16 * 8);
  ctx.scale(8, 8);
  ctx.strokeStyle = "#d8f0ff";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(8, 8, 6.4, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

// ---- Word plants --------------------------------------------------------
//
// Three levels of detail. Every plant has a small sprite in a "low" sheet of up
// to 2048 plants. The plants near you also get a full-size sprite in a pool
// of slots, streamed in batches as you walk, and the few right in front of you
// a near sprite. A worker draws them (spriteWorker.ts), a run of plants at a
// time, so the page never waits (#459).

export const ATLAS = 2048;
export const LOW_W = 32;
export const LOW_H = 64;
export const LOW_COLS = ATLAS / LOW_W;
export const LOW_PER_SHEET = LOW_COLS * (ATLAS / LOW_H);
/** Small sprites drawn at once: a run of plants side by side in one row of a sheet. Divides LOW_COLS. */
export const LOW_RUN = 16;
/** Big enough that a near plant's edges stay clean on a phone, filtered smooth (#1091). */
export const HI_W = 192;
export const HI_H = 384;
/** The pool of full-size sprites has rows of 21 slots, up to 10 rows. 210 slots: in a garden of 800, the plants within about 13 m of you. */
export const HI_COLS = 21;
const HI_ROWS = 10;
/** The pool's width in pixels. */
export const POOL_W = HI_COLS * HI_W;

/**
 * Full-size slots for a garden of `plants`: whole rows, enough for every plant, up to 210. A full pool
 * is about 80 MB on the GPU, so a small garden gets a small one (#1107).
 */
export function hiSlots(plants: number): number {
  return HI_COLS * Math.min(HI_ROWS, Math.ceil(plants / HI_COLS));
}

const BATCH_COLS = 8;
/** 16: copying a batch's sprites with their mipmaps takes the page 6–8 ms at CPU 10× (#1091); 24 took 9–13 ms. */
export const BATCH = BATCH_COLS * 2;

/** Mipmap levels for cells of w × h: halved while both sides are even, so no level mixes two cells. */
function levelsFor(w: number, h: number) {
  let n = 1;
  for (; w % 2 === 0 && h % 2 === 0; n++) {
    w /= 2;
    h /= 2;
  }
  return n;
}
export const LOW_LEVELS = levelsFor(LOW_W, LOW_H);
export const HI_LEVELS = levelsFor(HI_W, HI_H);

let worker: Worker | null = null;
let nextJob = 0;
const waiting = new Map<number, { resolve: (t: THREE.DataTexture[]) => void; reject: (e: unknown) => void }>();

/**
 * Plants drawn by the worker, in a grid of `cols` cells of w × h: premultiplied
 * RGBA, one texture per mipmap level, to copy into a sheet with three's
 * copyTextureToTexture. One worker for the page; it draws one job at a time, in order.
 */
function drawn(plants: PlacedPlant[], cols: number, w: number, h: number, levels: number): Promise<THREE.DataTexture[]> {
  if (!worker) {
    worker = new Worker(new URL("./spriteWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<SpriteDone>) => {
      const { id, levels } = e.data;
      waiting.get(id)!.resolve(levels.map((l) => new THREE.DataTexture(l.data, l.width, l.height)));
      waiting.delete(id);
    };
    // A worker that fails draws nothing more: every plant still waiting fails loudly, not silently blank.
    worker.onerror = (e) => {
      for (const w of waiting.values()) w.reject(new Error(`sprite worker: ${e.message}`));
      waiting.clear();
    };
  }
  const id = nextJob++;
  const job: SpriteJob = { id, plants: plants.map((p) => ({ lemma: p.lemma, growth: p.growth, stage: p.stage })), cols, w, h, levels };
  worker.postMessage(job);
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}

/** The height of each sheet of small sprites: one per 2048 plants, only as many rows as its plants fill (#1107). */
export function lowSheetHeights(plants: number): number[] {
  const heights: number[] = [];
  for (let start = 0; start < plants; start += LOW_PER_SHEET) {
    const rows = Math.ceil(Math.min(LOW_PER_SHEET, plants - start) / LOW_COLS);
    heights.push(rows * LOW_H);
  }
  return heights;
}

/** Where plant `i`'s small sprite sits: its sheet, and its cell's corner in pixels. */
export const lowCell = (i: number) => {
  const k = i % LOW_PER_SHEET;
  return { sheet: Math.floor(i / LOW_PER_SHEET), x: (k % LOW_COLS) * LOW_W, y: Math.floor(k / LOW_COLS) * LOW_H };
};

/** Small sprites for up to LOW_RUN plants, side by side. */
export const lowRun = (plants: PlacedPlant[]) => drawn(plants, LOW_RUN, LOW_W, LOW_H, LOW_LEVELS);

/** Full-size sprites for up to BATCH plants, in a grid of BATCH_COLS. */
export const highBatch = (plants: PlacedPlant[]) => drawn(plants, BATCH_COLS, HI_W, HI_H, HI_LEVELS);

export const batchCell = (i: number) => ({ x: (i % BATCH_COLS) * HI_W, y: Math.floor(i / BATCH_COLS) * HI_H });

/**
 * A near sprite has 3 times the full-size sprite's pixels each way (#1154). At arm's length on a phone, one full-size
 * pixel covered 4 to 5 screen pixels, and the smooth filter blurred every edge over that many.
 */
export const NEAR_W = 3 * HI_W;
export const NEAR_H = 3 * HI_H;
/** 8 near slots in rows of 4: about 21 MB on the GPU. No mipmaps: a near sprite is never drawn much smaller than it is. */
export const NEAR_COLS = 4;
export const NEAR_SLOTS = 8;

/** One plant's near sprite. Each is 2.6 MB, so the page copies one at a time. */
export const nearSprite = (plant: PlacedPlant) => drawn([plant], 1, NEAR_W, NEAR_H, 1);

// ---- Decorations ----------------------------------------------------------

/** Ground decorations, one atlas of 4 cells of 32×64: tuft, wildflowers, mushrooms, stone. */
/** Fills the polygon through `pts` with `color`. */
function polygon(ctx: OffscreenCanvasRenderingContext2D, color: string, pts: readonly (readonly [number, number])[]) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.fill();
}

/** Fills a circle, or an ellipse when `ry` is given; `half`: only its top or bottom half. */
function oval(ctx: OffscreenCanvasRenderingContext2D, color: string, x: number, y: number, rx: number, ry = rx, half?: "top" | "bottom") {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (half === "top") ctx.ellipse(x, y, rx, ry, 0, Math.PI, Math.PI * 2);
  else if (half === "bottom") ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI);
  else ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The wild bits outside the fence (#1091), as paper cut-outs in four cells of 128×256, each standing on the bottom
 * edge: a grass tuft, wildflowers, two mushrooms and a stone. Each is as wide and as tall as in the first 32×64
 * drawing (4 texels to its 1), so the tap boxes (scenery.ts DECOR_KINDS) still fit.
 */
export function decor(): OffscreenCanvas {
  const [C, H] = [128, 256];
  const [c, ctx] = canvas(C * 4, H);
  const r = rng(41);
  // 0: a grass tuft, blades fanned out from the middle, the back ones darker.
  for (const i of [0, 8, 2, 6, 4, 1, 7, 3, 5]) {
    const x = 46 + i * 4.5;
    const h = 32 + r() * 40;
    const tip = x + (i - 4) * 3;
    ctx.fillStyle = i % 2 === 0 ? "#4f7d45" : "#6f9e5f";
    ctx.beginPath();
    ctx.moveTo(x - 4, H);
    ctx.quadraticCurveTo(x - 3 + (tip - x) * 0.3, H - h * 0.55, tip, H - h);
    ctx.quadraticCurveTo(x + 3 + (tip - x) * 0.3, H - h * 0.55, x + 4, H);
    ctx.fill();
  }
  // 1: wildflowers, each a thin stem and a round five-petal head.
  ["#f6efdc", "#f0b23e", "#b99ad6", "#d97a9c", "#8fb2d9"].forEach((petal, i) => {
    const x = C + 16 + i * 20 + r() * 12;
    const h = 36 + r() * 56;
    px(ctx, x - 1.5, H - h, "#4f7d45", 3, h);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + i;
      oval(ctx, petal, x + Math.cos(a) * 4.5, H - h + Math.sin(a) * 4.5, 4);
    }
    oval(ctx, "#d98a2b", x, H - h, 3);
  });
  // 2: two mushrooms, plain brown: a pale stem, a dome cap, its dark gills under the rim.
  for (const [x, w, h] of [
    [C * 2 + 40, 40, 24],
    [C * 2 + 80, 28, 16],
  ]) {
    px(ctx, x - 6, H - h, "#ece2cf", 12, h);
    px(ctx, x + 2, H - h, "#d6c9b0", 4, h);
    oval(ctx, "#a8714a", x, H - h, w / 2, w / 2, "top");
    oval(ctx, "#8a5a3c", x, H - h, w / 2, 4, "bottom");
  }
  // 3: a low round stone: in shade on the right, its top catching the light.
  const sx = C * 3 + 66;
  oval(ctx, "#8a847c", sx, H, 36, 30, "top");
  oval(ctx, "#a9a29a", sx - 6, H, 30, 28, "top");
  oval(ctx, "#c9c3b8", sx - 8, H - 15, 20, 13, "top");
  return c;
}

/**
 * A garden lantern on a wooden post (#1091), unlit (left) and lit (right), 128×384 each: a post with a lit and a
 * shaded side, an iron roof and frame of warm dark grey (not black), and two panes, pale when unlit and warm when lit.
 * 8 texels to each of the first 16×48 drawing's, so its parts are where they were: the halo (sceneLanterns.ts) sits on the glass.
 */
export function lantern(): OffscreenCanvas {
  const [W, H] = [128, 384];
  const [c, ctx] = canvas(W * 2, H);
  const [iron, ironLit] = ["#4f433c", "#6a5a50"];
  for (const [ox, lit] of [
    [0, false],
    [W, true],
  ] as const) {
    const at = (pts: [number, number][]) => pts.map(([x, y]) => [ox + x, y] as const);
    // The post, lit from the left.
    px(ctx, ox + 57, 112, "#8a6a4a", 7, H - 112);
    px(ctx, ox + 64, 112, "#6e5139", 7, H - 112);
    // The roof: a low pyramid seen on its corner, so one side lit and one in shade, and a knob on top.
    polygon(ctx, ironLit, at([[28, 44], [64, 44], [64, 18], [48, 18]]));
    polygon(ctx, iron, at([[64, 44], [100, 44], [80, 18], [64, 18]]));
    oval(ctx, iron, ox + 64, 14, 7);
    // The frame, its glass, and the bar between the two panes.
    px(ctx, ox + 34, 44, iron, 60, 62);
    px(ctx, ox + 42, 50, lit ? "#f2c45e" : "#cdc6b2", 44, 50);
    if (lit) oval(ctx, "#fff1c6", ox + 64, 76, 15, 19);
    else polygon(ctx, "#ddd7c6", at([[42, 70], [62, 50], [72, 50], [42, 80]]));
    px(ctx, ox + 61, 50, iron, 6, 50);
    // The base plate, and the bracket that holds it on the post.
    px(ctx, ox + 30, 104, ironLit, 68, 6);
    px(ctx, ox + 30, 110, iron, 68, 5);
    polygon(ctx, iron, at([[46, 115], [82, 115], [72, 126], [56, 126]]));
  }
  return c;
}

/** A "z" for the sleeping bloom (#62), pale with a dark edge so it shows on the night sky. 8 texels to each of the first 8×8 drawing's. */
export function snoreZ(): OffscreenCanvas {
  const [c, ctx] = canvas(8 * 8, 8 * 8);
  ctx.scale(8, 8);
  const z = new Path2D("M1.9 1.9 L6.1 1.9 L1.9 6.1 L6.1 6.1");
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#2a2f4a";
  ctx.lineWidth = 3;
  ctx.stroke(z);
  ctx.strokeStyle = "#eef2ff";
  ctx.lineWidth = 1.3;
  ctx.stroke(z);
  return c;
}

/**
 * A soft round glow for additive light pools and halos. Smooth and filtered:
 * a lantern's halo fills much of the view up close,
 * and there hard rings and dithered holes showed as big see-through blocks
 * (#858). The small framebuffer, scaled up with hard pixels, still pixelates it.
 */
export function glowTexture(): THREE.CanvasTexture<OffscreenCanvas> {
  const n = 64;
  const [c, ctx] = canvas(n, n);
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = Math.max(0, 1 - Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2));
      img.data.set([255, 200, 110, Math.round(255 * 0.55 * v * v * (3 - 2 * v))], (y * n + x) * 4);
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/**
 * The far house across the valley (#683, lookout.ts FAR_HOUSE), 16×9 units of
 * 8 texels: a roof with a chimney, a door and one window, and beside it a
 * lantern on a post, like the lookout's (#858, lookout.ts FAR_LANTERN). By day
 * it is hazy, hardly darker than the hill; at night a dark shape, the
 * lantern's glass dark too: the far light is drawn over it.
 */
export function farHouse(night: boolean): OffscreenCanvas {
  const k = night ? { roof: "#11161d", wall: "#1a212b", dark: "#0d1116", chimney: "#141a22", post: "#0d1116" } : { roof: "#89a185", wall: "#a9bf9c", dark: "#94ac8f", chimney: "#8ea68a", post: "#8ea68a" };
  const [c, ctx] = canvas(16 * 8, 9 * 8);
  ctx.scale(8, 8);
  px(ctx, 8, 0, k.chimney, 1.2, 3);
  polygon(ctx, k.roof, [
    [0, 5],
    [6, 0.6],
    [12, 5],
  ]);
  px(ctx, 1, 5, k.wall, 10, 4);
  px(ctx, 3, 6, k.dark, 1, 3);
  px(ctx, 7, 6, k.dark, 1, 2);
  // The lantern: its cap, its glass (where FAR_LANTERN is) and its post.
  polygon(ctx, k.roof, [
    [13.7, 4],
    [14.5, 3],
    [15.3, 4],
  ]);
  px(ctx, 14, 4, k.wall, 1, 1);
  px(ctx, 14.15, 5, k.post, 0.7, 4);
  return c;
}

/** The far lantern's light (#683, #858), for additive blending: a bright core in a soft-coloured ring. 8 texels to each of the first 8×8 drawing's. */
export function farLight(): OffscreenCanvas {
  const [c, ctx] = canvas(8 * 8, 8 * 8);
  ctx.scale(8, 8);
  oval(ctx, "rgba(255, 184, 74, 0.35)", 4, 4, 2);
  oval(ctx, "#fff1c2", 4, 4, 1);
  return c;
}

/** Texels to each of the first 32×32 sun and moon drawings' units: about one to a screen pixel, as big as they show. */
const SKY_DISC_FINE = 2;

/** The sun (#1091): a flat disc in a ring a shade deeper, in a 32×32 drawing. */
export function sun(kind: "day" | "dusk"): OffscreenCanvas {
  const [c, ctx] = canvas(32 * SKY_DISC_FINE, 32 * SKY_DISC_FINE);
  ctx.scale(SKY_DISC_FINE, SKY_DISC_FINE);
  const [core, rim] = kind === "dusk" ? ["#ffd28a", "#ff9b5e"] : ["#fffbe6", "#ffe58a"];
  oval(ctx, rim, 16, 16, 11);
  oval(ctx, core, 16, 16, 9);
  return c;
}

/**
 * Tonight's moon (#361), as big as the sun: `phase` 0 (new) to MOON_PHASES - 1
 * (moon.ts), lit from the right while it waxes and from the left as it wanes.
 * The dark part is a faint disc, so even a new moon is there to tap.
 */
export function moon(phase: number): OffscreenCanvas {
  const [c, ctx] = canvas(32 * SKY_DISC_FINE, 32 * SKY_DISC_FINE);
  ctx.scale(SKY_DISC_FINE, SKY_DISC_FINE);
  oval(ctx, "#3a4250", 16, 16, 11);
  oval(ctx, "#2a313c", 16, 16, 9);
  if (phase === 0) return c;
  if (phase !== FULL_MOON) {
    // The lit part: the bright limb, then back along the line where light meets dark, a half ellipse as wide as
    // `k` of the disc's half width, bowed toward the limb for a crescent (k > 0) and away from it past half.
    const k = Math.cos((2 * Math.PI * phase) / MOON_PHASES);
    const waning = phase > FULL_MOON;
    ctx.beginPath();
    ctx.arc(16, 16, 11, -Math.PI / 2, Math.PI / 2, waning);
    ctx.ellipse(16, 16, Math.abs(k) * 11, 11, 0, Math.PI / 2, -Math.PI / 2, k > 0 !== waning);
    ctx.clip();
  }
  oval(ctx, "#d9d2b8", 16, 16, 11);
  oval(ctx, "#fff6d8", 16, 16, 9);
  for (const [x, y, rx, ry] of [
    [11, 15, 1.1, 1],
    [14.5, 22, 1.5, 1.1],
    [19, 10.6, 1, 0.7],
  ])
    oval(ctx, "#cfc8ac", x, y, rx, ry);
  return c;
}

/** A leaf or petal from its base to its tip, `w` wide in the middle and pointed at both ends. */
function pointed(ctx: OffscreenCanvasRenderingContext2D, color: string, bx: number, by: number, tx: number, ty: number, w: number) {
  const [mx, my] = [(bx + tx) / 2, (by + ty) / 2];
  const len = Math.hypot(tx - bx, ty - by);
  // Each side's control point is a full width out: a quadratic curve reaches half of it.
  const [nx, ny] = [((by - ty) / len) * w, ((tx - bx) / len) * w];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(mx + nx, my + ny, tx, ty);
  ctx.quadraticCurveTo(mx - nx, my - ny, bx, by);
  ctx.fill();
}

/** Texels to each of the first sunflower drawing's units. */
const SUNFLOWER_FINE = 8;

/**
 * The sunflower (#1091), two frames of 32×64 units side by side: its face (left, a small calm smile) and the back
 * of its head (right). No text.
 */
export function sunflower(): OffscreenCanvas {
  const [c, ctx] = canvas(64 * SUNFLOWER_FINE, 64 * SUNFLOWER_FINE);
  ctx.scale(SUNFLOWER_FINE, SUNFLOWER_FINE);
  for (const [ox, face] of [
    [0, true],
    [32, false],
  ] as const) {
    ctx.save();
    ctx.translate(ox, 0);
    const r = rng(51); // the same petals on both sides
    // Stem, its right side a shade lighter, and two leaves with a darker middle line.
    px(ctx, 15, 20, "#3f7d36", 2, 44);
    px(ctx, 16, 20, "#4e9140", 1, 44);
    ctx.strokeStyle = "#4e9140";
    ctx.lineWidth = 0.35;
    for (const [bx, by, tx, ty] of [
      [15.2, 47, 7.5, 42.5],
      [16.8, 39, 24.5, 34.5],
    ]) {
      pointed(ctx, "#5fa44a", bx, by, tx, ty, 3.2);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + (tx - bx) * 0.75, by + (ty - by) * 0.75);
      ctx.stroke();
    }
    // Petals around the head: ten behind in the deepest shade, and ten in front between them, each lit from the
    // top left by which way it points.
    const [cx, cy] = [16, 13];
    const [lit, mid, deep] = face ? ["#ffe066", "#f8c537", "#e0a020"] : ["#e8c040", "#d0a028", "#b08018"];
    const petal = (a: number, len: number, w: number, color: string) => pointed(ctx, color, cx + Math.cos(a) * 5.5, cy + Math.sin(a) * 5.5, cx + Math.cos(a) * len, cy + Math.sin(a) * len, w);
    for (let i = 0; i < 10; i++) petal(((i + 0.5) * Math.PI) / 5, 11.6 + r() * 0.6, 4, deep);
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5;
      const light = -Math.cos(a) - Math.sin(a);
      petal(a, 12.2 + r() * 0.6, 4.2, light > 0.3 ? lit : light > -0.4 ? mid : deep);
    }
    if (face) {
      oval(ctx, "#5a3216", cx, cy, 7.5);
      oval(ctx, "#6e4020", cx, cy, 6.3);
      // A ring of seeds round the face.
      for (let i = 0; i < 18; i++) oval(ctx, "#8a5428", cx + Math.cos((i * Math.PI) / 9) * 5.3, cy + Math.sin((i * Math.PI) / 9) * 5.3, 0.4);
      // Closed, content eyes, rosy cheeks and a small calm smile.
      ctx.strokeStyle = "#2b1608";
      ctx.lineWidth = 0.7;
      ctx.lineCap = "round";
      for (const x of [13, 19]) {
        ctx.beginPath();
        ctx.arc(x, 11.9, 1.3, Math.PI, Math.PI * 2);
        ctx.stroke();
      }
      oval(ctx, "#d0603a", 11.4, 13.9, 0.8, 0.6);
      oval(ctx, "#d0603a", 20.6, 13.9, 0.8, 0.6);
      ctx.beginPath();
      ctx.arc(cx, 13.6, 2.8, Math.PI * 0.22, Math.PI * 0.78);
      ctx.stroke();
    } else {
      // The green back of the head, with bracts in a star, and the stem joined to its middle.
      oval(ctx, "#36692e", cx, cy, 7.5);
      oval(ctx, "#5a9a48", cx, cy, 6.3);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        pointed(ctx, "#3f7d36", cx + Math.cos(a) * 2.5, cy + Math.sin(a) * 2.5, cx + Math.cos(a) * 7, cy + Math.sin(a) * 7, 1.8);
      }
      px(ctx, 15, 13, "#3f7d36", 2, 8);
    }
    ctx.restore();
  }
  return c;
}

// ---- Visitors ---------------------------------------------------------------

/** Texels to a unit of the visitors' art: about one to a screen pixel when one is close in the walk. */
const VISITOR_PX = 8;
/** Cells in a row of the visitors' atlas: 8 cells of 32 units keep it 2048 texels wide, which every GPU takes. */
export const VISITOR_COLS = 8;

/** Draws a paper cut-out with its top left at (x, y), `scale` texels to a unit. */
function cutout(ctx: OffscreenCanvasRenderingContext2D, art: Art.Cutout, x: number, y: number, scale: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const p of art.pieces) {
    const path = new Path2D(p.d);
    if (p.fill) {
      ctx.fillStyle = p.fill;
      ctx.fill(path);
    }
    if (p.line) {
      ctx.strokeStyle = p.line.color;
      ctx.lineWidth = p.line.width;
      ctx.stroke(path);
    }
  }
  ctx.restore();
}

/**
 * The garden visitors' frames in one atlas (drawn once): one cell of 32×32 units each, in this order, VISITOR_COLS
 * to a row, standing on the bottom of the cell (kinds/index.ts lists them).
 */
export function visitors(arts: readonly Art.Cutout[]): OffscreenCanvas {
  const cell = 32 * VISITOR_PX;
  const [c, ctx] = canvas(VISITOR_COLS * cell, Math.ceil(arts.length / VISITOR_COLS) * cell);
  arts.forEach((art, i) => {
    const ox = (i % VISITOR_COLS) * cell + Math.floor((32 - art.w) / 2) * VISITOR_PX;
    const oy = Math.floor(i / VISITOR_COLS) * cell + (32 - art.h) * VISITOR_PX;
    cutout(ctx, art, ox, oy, VISITOR_PX);
  });
  return c;
}

// ---- Walk into things (#359) ------------------------------------------------

/** Cells of the fallen fruit atlas (32×32 each, standing on the bottom row), in FRUIT_KINDS order. */
export const FRUIT_CELLS = FRUIT_KINDS.length;
/** Texels to each of the fruit atlas's units. */
const FRUIT_FINE = 6;
/** A fallen fruit is its tree's fruit (fruit()) drawn this many times as big: on the tree it is seen from afar. */
const FALLEN = 2;

/** Every kind of fruit that can fall from an orchard tree, in one small atlas (drawn once): the same drawing as on its tree. */
export function fruitAtlas(): OffscreenCanvas {
  const [c, ctx] = canvas(32 * FRUIT_CELLS * FRUIT_FINE, 32 * FRUIT_FINE);
  ctx.scale(FRUIT_FINE, FRUIT_FINE);
  FRUIT_KINDS.forEach((kind, i) => {
    const f = TREE_SHAPES[kind].fruit;
    ctx.save();
    ctx.translate(i * 32 + 16, 32 - FRUIT_FOOT[f.shape] * FALLEN);
    ctx.scale(FALLEN, FALLEN);
    fruit(ctx, f, 0, 0);
    ctx.restore();
  });
  return c;
}

/** Units on a side of the leaf pile's cell: the pile stands on its bottom edge. */
const PILE_CELL = 16;
/** Texels to each of the leaf pile's units. */
const PILE_FINE = 8;

/** A neat, low pile of autumn leaves (#1091): a lumpy mound in the deepest leaf colour, under small leaves that reach its edge. */
export function leafPile(): OffscreenCanvas {
  const [c, ctx] = canvas(PILE_CELL * PILE_FINE, PILE_CELL * PILE_FINE);
  ctx.scale(PILE_FINE, PILE_FINE);
  const [cx, rx, ry] = [PILE_CELL / 2, PILE_CELL / 2 - 1.2, 5];
  // The mound's top edge at x, and a point under it: a leaf there stays on the pile.
  const top = (x: number) => PILE_CELL - ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2));
  oval(ctx, AUTUMN[3], cx, PILE_CELL, rx, ry, "top");
  const r = rng(61);
  const leaves = Array.from({ length: 34 }, (_, i) => {
    const x = cx + (r() * 2 - 1) * rx * 0.94;
    return { x, y: top(x) + 0.6 + r() * (PILE_CELL - top(x) - 1.4), a: r() * Math.PI, color: AUTUMN[i % 3] };
  }).sort((a, b) => a.y - b.y);
  ctx.strokeStyle = AUTUMN[3];
  ctx.lineWidth = 0.16;
  for (const { x, y, a, color } of leaves) {
    const [dx, dy] = [Math.cos(a) * 1.5, Math.sin(a) * 1.5];
    pointed(ctx, color, x - dx, y - dy, x + dx, y + dy, 1.7);
    ctx.beginPath();
    ctx.moveTo(x - dx * 0.8, y - dy * 0.8);
    ctx.lineTo(x + dx * 0.6, y + dy * 0.6);
    ctx.stroke();
  }
  return c;
}

// ---- Carry and put down (#358) -------------------------------------------

/** Rings on the water, from small to wide, as they spread. */
export const RINGS = 3;
/** Cells of the carry atlas (32×32 each, things standing on the bottom row; the rings fill theirs), in this order. */
export const CARRY_CELL = { pebble: 0, ring: (i: number) => 1 + i, well: 1 + RINGS };
export const CARRY_CELLS = 2 + RINGS;
/** Texels to each of the carry atlas's units: the well's cell is drawn 2.8 times as big as the pebble's. */
const CARRY_FINE = 10;

/** The pebble, the rings and the orchard's well (#335 S6), in one small atlas (drawn once), in CARRY_CELL order. */
export function carryAtlas(): OffscreenCanvas {
  const [c, ctx] = canvas(32 * CARRY_CELLS * CARRY_FINE, 32 * CARRY_FINE);
  ctx.scale(CARRY_FINE, CARRY_FINE);
  cutout(ctx, PEBBLE, CARRY_CELL.pebble * 32 + (32 - PEBBLE.w) / 2, 32 - PEBBLE.h, 1);
  // The rings: thin light circles on the water, seen from above.
  ctx.strokeStyle = "#dff0f4";
  ctx.lineWidth = 1.1;
  for (let i = 0; i < RINGS; i++) {
    ctx.beginPath();
    ctx.arc(CARRY_CELL.ring(i) * 32 + 16, 16, 5 + i * 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(CARRY_CELL.well * 32, 0);
  well(ctx);
  ctx.restore();
  return c;
}

/** The orchard's wishing well (#335 S6) in a 32×32 cell: a wall of stones, dark inside, under a small roof with a bucket on its rope. */
function well(ctx: OffscreenCanvasRenderingContext2D) {
  // The roof's gable, its middle in shade under the ridge, on its beam and two posts.
  polygon(ctx, "#a8603e", [
    [3.4, 10.2],
    [16, 3.6],
    [28.6, 10.2],
  ]);
  polygon(ctx, "#8a4a32", [
    [10.6, 10.2],
    [16, 6.6],
    [21.4, 10.2],
  ]);
  px(ctx, 3.4, 9.4, "#8a4a32", 25.2, 0.8);
  for (const x of [5.6, 26.4]) trunk(ctx, x, 10.2, 19, 1.6, ["#8a6440", "#6e4e30"]);
  px(ctx, 4.4, 10.2, "#6e4e30", 23.2, 0.9);
  // The rope and the bucket.
  px(ctx, 17.8, 11.1, "#c8a870", 0.45, 3.4);
  polygon(ctx, "#7a5233", [
    [16.5, 14.3],
    [19.5, 14.3],
    [19.1, 17.3],
    [16.9, 17.3],
  ]);
  px(ctx, 16.6, 15.2, "#5c3b22", 2.8, 0.45);
  // The wall: a drum of stones in courses, lit on top and in shade below, set in dark mortar; on top, its lit rim round
  // the dark mouth.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(2.4, 19.4, 27.2, 12.6, [0, 0, 2, 2]);
  ctx.fillStyle = "#4a4440";
  ctx.fill();
  ctx.clip();
  const r = rng(62);
  for (let row = 0; row < 4; row++) {
    const y = 20.8 + row * 2.8;
    for (let x = row % 2 ? -0.4 : 2.4; x < 29.6; ) {
      const w = 4.4 + r() * 2.2;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, 2.45, 0.5);
      ctx.clip();
      px(ctx, x, y, "#9a948a", w, 2.45);
      px(ctx, x, y, "#c8c2b6", w, 0.5);
      px(ctx, x, y + 1.85, "#7a746a", w, 0.6);
      ctx.restore();
      x += w + 0.35;
    }
  }
  ctx.restore();
  oval(ctx, "#4a4440", 16, 19.6, 13.6, 1.9);
  oval(ctx, "#c8c2b6", 16, 19.4, 13.2, 1.6);
  oval(ctx, "#1c2024", 16, 19.4, 11, 1);
}

// ---- Lawn and pond toys (#360) ----------------------------------------------

/** Cells of the toy atlas (16×24 each, standing on the bottom row): a dandelion clock, then the same clock blown. */
export const TOY_CELL = { clock: 0, blown: 1 } as const;
export const TOY_CELLS = 2;
const TOY_W = 16;
const TOY_H = 24;
/** Texels to each of the toy atlas's units. */
const TOY_FINE = 8;

/** The dandelion clock and the blown one, side by side (#1091): a round puff of seeds, or the bare seed bed, on a stem. */
export function toyAtlas(): OffscreenCanvas {
  const [c, ctx] = canvas(TOY_W * TOY_CELLS * TOY_FINE, TOY_H * TOY_FINE);
  ctx.scale(TOY_FINE, TOY_FINE);
  for (const cell of [TOY_CELL.clock, TOY_CELL.blown]) {
    ctx.save();
    ctx.translate(cell * TOY_W, 0);
    // The head's middle: toys.ts HEAD_TOP above the ground. A blown head is only its seed bed, a little lower.
    const [hx, hy] = [8, 8.6];
    const bed = 11.6;
    ctx.strokeStyle = "#5a8a3a";
    ctx.lineWidth = 0.7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(hx, cell === TOY_CELL.clock ? hy : bed);
    ctx.quadraticCurveTo(hx + 0.7, 17, hx + 0.3, TOY_H);
    ctx.stroke();
    // Two toothed leaves splayed low at its foot, each with a light middle line.
    ctx.strokeStyle = "#6aac44";
    ctx.lineWidth = 0.25;
    const foot = TOY_H - 1;
    for (const [tx, ty] of [
      [1.4, 20.2],
      [14.8, 20.6],
    ]) {
      toothed(ctx, "#3e7a2c", hx + 0.3, foot, tx, ty, 2.5);
      ctx.beginPath();
      ctx.moveTo(hx + 0.3, foot);
      ctx.lineTo(hx + 0.3 + (tx - hx - 0.3) * 0.85, foot + (ty - foot) * 0.85);
      ctx.stroke();
    }
    if (cell === TOY_CELL.clock) {
      // The puff: a ball of seeds, its edge a soft fringe of fine tufts, a shade greyer outside; each seed a fine
      // spoke to the middle, where a speck of the seed bed shows.
      for (const [color, rad, bump] of [
        ["#d8d4ca", 5, 0.5],
        ["#fbfaf4", 4.75, 0.4],
      ] as const) {
        oval(ctx, color, hx, hy, rad);
        for (let i = 0; i < 40; i++) oval(ctx, color, hx + Math.cos((i * Math.PI) / 20) * rad, hy + Math.sin((i * Math.PI) / 20) * rad, bump);
      }
      ctx.strokeStyle = "#e6e2d8";
      ctx.lineWidth = 0.12;
      for (let i = 0; i < 24; i++) {
        const a = ((i + 0.5) * Math.PI) / 12;
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(a) * 0.5, hy + Math.sin(a) * 0.5);
        ctx.lineTo(hx + Math.cos(a) * 4.5, hy + Math.sin(a) * 4.5);
        ctx.stroke();
      }
      oval(ctx, "#c8b878", hx, hy, 0.6);
    } else {
      // The bare seed bed, a low dome over its bent-back sepals, with one last seed on it.
      for (const sx of [-1, 1]) pointed(ctx, "#5a8a3a", hx, bed, hx + sx * 2, bed + 2, 0.8);
      const [ex, ey] = [hx + Math.cos(-1.1) * 4.4, bed + Math.sin(-1.1) * 4.4];
      ctx.strokeStyle = "#d8d4ca";
      ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.moveTo(hx, bed - 0.6);
      ctx.lineTo(ex, ey);
      // Its tuft: a few fine hairs fanned out at the tip.
      for (const da of [-0.8, -0.27, 0.27, 0.8]) {
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + Math.cos(-1.1 + da) * 1.1, ey + Math.sin(-1.1 + da) * 1.1);
      }
      ctx.stroke();
      oval(ctx, "#c8b878", hx, bed, 2.4, 1.7, "top");
      oval(ctx, "#a08a50", hx, bed, 1.3, 0.9, "top");
    }
    ctx.restore();
  }
  return c;
}

/** A dandelion leaf from its base to its tip, `w` wide: both edges cut in lobes whose points face back to the base, the lower ones smaller. */
function toothed(ctx: OffscreenCanvasRenderingContext2D, color: string, bx: number, by: number, tx: number, ty: number, w: number) {
  const len = Math.hypot(tx - bx, ty - by);
  const [ux, uy] = [(tx - bx) / len, (ty - by) / len];
  // [along, across] in leaf lengths and widths, from the base to the tip: a notch, then a lobe's point, and so on.
  const edge = [
    [0.06, 0.16],
    [0.2, 0.2],
    [0.23, 0.55],
    [0.44, 0.22],
    [0.47, 0.55],
    [0.68, 0.22],
    [0.71, 0.45],
    [0.9, 0.14],
  ];
  const at = (t: number, s: number): [number, number] => [bx + ux * len * t - uy * w * s, by + uy * len * t + ux * w * s];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  for (const [t, s] of edge) ctx.lineTo(...at(t, s));
  ctx.lineTo(tx, ty);
  for (const [t, s] of edge.toReversed()) ctx.lineTo(...at(t + 0.03, -s * 0.75));
  ctx.closePath();
  ctx.fill();
}
