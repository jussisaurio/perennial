// The paper the garden is made of (#1164). A model maker cuts each kind of
// thing from its own stock (STOCK): plants and creatures from smooth coloured
// card, wood from kraft card with its dark fibres, the yard from an even sheet,
// the soil from rough sugar paper, the pond from glossy film. One grain holds
// what they show: fine fibres that catch the light from one side, slow soft
// changes of tone, and flecks. Each stock shows each of them as much as it has
// them. It is smooth, never pixel noise, and far off its mipmaps fade it to
// the flat colour, so it never shimmers. Painted once per walk in a worker
// (paintWorker.ts).

import * as THREE from "three";
import { rng } from "../lib/seed";

/** Texels on a side of the grain. */
const GRAIN_PX = 512;
/** Metres one repeat of the fibres and flecks covers on a surface, and one repeat of the tone: two sizes, so neither repeat shows. */
const FIBRE_M = 1.7;
const TONE_M = 9.3;

/** One box blur pass along rows or columns of a square field whose edges wrap. */
function boxPass(src: Float32Array, size: number, r: number, rows: boolean): Float32Array {
  const out = new Float32Array(size * size);
  const at = (line: number, i: number) => {
    const j = (i + size) % size;
    return rows ? line * size + j : j * size + line;
  };
  for (let line = 0; line < size; line++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[at(line, i)];
    for (let i = 0; i < size; i++) {
      out[at(line, i)] = sum / (2 * r + 1);
      sum += src[at(line, i + r + 1)] - src[at(line, i - r)];
    }
  }
  return out;
}

/** A soft blur of a field that repeats: three box passes each way, close to a Gaussian. */
function blur(f: Float32Array, size: number, r: number): Float32Array {
  for (let i = 0; i < 3; i++) f = boxPass(boxPass(f, size, r, true), size, r, false);
  return f;
}

/** `f` moved and scaled to a mean of 0 and a spread (standard deviation) of 1, so fields mix by plain weights. */
function normalise(f: Float32Array): Float32Array {
  const mean = f.reduce((a, v) => a + v, 0) / f.length;
  const sd = Math.sqrt(f.reduce((a, v) => a + (v - mean) ** 2, 0) / f.length);
  return f.map((v) => (v - mean) / sd);
}

/** Draws `n` short, gently curved strands on `ctx` (a tile `N` px on a side, so each is drawn again across its edges), each styled by `style`. */
function strands(ctx: OffscreenCanvasRenderingContext2D, N: number, n: number, r: () => number, len: [number, number], style: () => void) {
  ctx.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const [x, y, a, l, bend] = [r() * N, r() * N, r() * Math.PI * 2, len[0] + r() * (len[1] - len[0]), (r() - 0.5) * 0.8];
    const [dx, dy] = [Math.cos(a) * l, Math.sin(a) * l];
    style();
    for (const ox of [-N, 0, N])
      for (const oy of [-N, 0, N]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.quadraticCurveTo(x + ox + dx / 2 - dy * bend, y + oy + dy / 2 + dx * bend, x + ox + dx, y + oy + dy);
        ctx.stroke();
      }
  }
}

/**
 * The grain, a repeating tile. Red: the fibres and the paper's fine tooth, lit from the upper left, as an
 * emboss (a texel's height less its lower-right neighbour's). Green: the tone, soft patches of a few sizes.
 * Both are 0.5 on average, so the paper keeps its colour. Blue: flecks, short dark fibres and specks, as in
 * kraft or sugar paper: 0.5 where there is none, lower where there is one.
 */
export function grain(): OffscreenCanvas {
  const N = GRAIN_PX;
  const r = rng(1164);
  const c = new OffscreenCanvas(N, N);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, N, N);
  // Fibres: short, thin strands, a little lighter or darker than the sheet.
  strands(ctx, N, 1800, r, [4, 14], () => {
    ctx.strokeStyle = r() < 0.55 ? `rgba(255,255,255,${0.06 + r() * 0.1})` : `rgba(0,0,0,${0.05 + r() * 0.07})`;
    ctx.lineWidth = 0.5 + r() * 0.6;
  });
  const px = ctx.getImageData(0, 0, N, N);
  // Flecks, on black: white where a fleck is, as strong as it is dark on the paper.
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, N, N);
  strands(ctx, N, 260, r, [3, 9], () => {
    ctx.strokeStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`;
    ctx.lineWidth = 0.7 + r() * 0.6;
  });
  for (let i = 0; i < 220; i++) {
    const [x, y, rad] = [r() * N, r() * N, 0.6 + r() * 0.9];
    ctx.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  const fleck = ctx.getImageData(0, 0, N, N).data;
  const fibre = normalise(Float32Array.from({ length: N * N }, (_, i) => px.data[i * 4]));
  const white = () => Float32Array.from({ length: N * N }, () => r() - 0.5);
  const tooth = normalise(blur(white(), N, 1));
  const height = fibre.map((v, i) => 0.6 * v + tooth[i]);
  const lowerRight = (i: number) => (((Math.floor(i / N) + 1) % N) * N + ((i % N) + 1) % N);
  const lit = normalise(height.map((v, i) => v - height[lowerRight(i)] + 0.4 * fibre[i]));
  const [big, mid, small] = [blur(white(), N, 22), blur(white(), N, 8), blur(white(), N, 3)].map(normalise);
  const tone = normalise(big.map((v, i) => v + 0.5 * mid[i] + 0.25 * small[i]));
  // Two spreads either side of the middle fit in a byte.
  const byte = (v: number) => Math.max(0, Math.min(255, Math.round(128 + 48 * v)));
  for (let i = 0; i < N * N; i++) {
    px.data[i * 4] = byte(lit[i]);
    px.data[i * 4 + 1] = byte(tone[i]);
    px.data[i * 4 + 2] = 128 - Math.round(fleck[i * 4] / 2);
    px.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(px, 0, 0);
  return c;
}

/** The grain texture every material samples, one uniform for all: GardenScene.build sets it once the worker has painted it, before the first draw. */
export const GRAIN: { value: THREE.Texture | null } = { value: null };

/**
 * A stock of paper: how much its fibres, its tone and its flecks show (a spread of the grain is 48/255; flecks
 * darken it, or lighten it for a stock whose flecks are paler than it), and how glossy it is: a glossy one shines
 * toward the light's colour where you look along it.
 */
type Stock = readonly [fibre: number, tone: number, fleck: number, gloss: number];

/** The stocks the garden is cut from (docs/art-direction.md, "Surfaces: paper stocks"). */
const STOCK = {
  /** Smooth coloured card: plants, creatures, leaves, pickets, signs, stone blocks. */
  card: [0.06, 0.05, 0, 0],
  /** An even, calm sheet: the yard and the paths, so they never look blotchy. */
  sheet: [0.08, 0.06, 0, 0],
  /** A softer sheet, its tone uneven: the grass. */
  handmade: [0.1, 0.24, 0, 0],
  /** Rough sugar paper, with pale specks in it: the soil. */
  sugar: [0.18, 0.2, -0.6, 0],
  /** Kraft card, with its short dark fibres: everything made of wood. */
  kraft: [0.07, 0.12, 0.6, 0],
  /** Glossy film: the pond. */
  film: [0, 0.06, 0, 0.6],
  /** A little glossy: the sundial's bronze. */
  foil: [0.04, 0.04, 0, 0.35],
} satisfies Record<string, Stock>;

/** Which stock a material is cut from. */
export type StockName = keyof typeof STOCK;

/** `s` as GLSL. */
const vec4 = (s: Stock) => `vec4(${s.map((v) => v.toFixed(2)).join(", ")})`;

/** GLSL: paper(at, stock) is how light `stock` is at `at`, in metres across its sheet: about 1, a little more or less. CARD is STOCK.card. */
export const PAPER = /* glsl */ `
  uniform sampler2D uGrain;
  const vec4 CARD = ${vec4(STOCK.card)};
  float paper(vec2 at, vec4 stock) {
    vec3 fine = texture2D(uGrain, at / ${FIBRE_M.toFixed(2)}).rgb - 0.5;
    float tone = texture2D(uGrain, at / ${TONE_M.toFixed(2)} + vec2(0.37, 0.71)).g - 0.5;
    return 1.0 + stock.x * fine.r + stock.y * tone + stock.z * fine.b;
  }
`;

/** Puts `chunk` after `include` in `src`, loudly if three's shader no longer has it. */
export function after(src: string, include: string, chunk: string): string {
  if (!src.includes(include)) throw new Error(`paper: no ${include} in the shader`);
  return src.replace(include, `${include}\n${chunk}`);
}

/**
 * Gives a built-in material its stock's paper (`stock`: a uniform of the material's own), laid on in world space:
 * on the ground across x and z, on a wall across the two axes it faces. A surface takes the plane of its face,
 * worked out from how its position changes across the screen, as an unlit material has no normals. One shader
 * for every material, so they share their programs (three keys them by onBeforeCompile's source).
 */
function onPaper(s: THREE.WebGLProgramParametersWithUniforms, stock: { value: THREE.Vector4 }) {
  s.uniforms.uGrain = GRAIN;
  s.uniforms.uStock = stock;
  s.vertexShader =
    "varying vec3 vPaper;\n" +
    after(
      s.vertexShader,
      "#include <project_vertex>",
      `vec4 paperAt = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
      paperAt = instanceMatrix * paperAt;
      #endif
      vPaper = (modelMatrix * paperAt).xyz;`,
    );
  s.fragmentShader =
    `varying vec3 vPaper;\nuniform vec4 uStock;\n${PAPER}\n` +
    after(
      s.fragmentShader,
      "#include <map_fragment>",
      `vec3 paperFace = cross(dFdx(vPaper), dFdy(vPaper));
      vec3 paperN = abs(paperFace);
      diffuseColor.rgb *= paper(paperN.y > max(paperN.x, paperN.z) ? vPaper.xz : paperN.x > paperN.z ? vPaper.zy : vPaper.xy, uStock);
      // A glossy stock shines where you look along it, toward the light's colour (diffuse: the time of day's tint).
      float paperGlance = 1.0 - abs(dot(normalize(paperFace), normalize(cameraPosition - vPaper)));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuse, uStock.w * pow(paperGlance, 3.0));`,
    );
}

/** `m`, made of paper of the stock `stock` (onPaper). */
export function paperMaterial<M extends THREE.Material>(m: M, stock: StockName): M {
  const uniform = { value: new THREE.Vector4(...STOCK[stock]) };
  m.onBeforeCompile = (s) => onPaper(s, uniform);
  return m;
}
