// The paper the garden is made of (#1164): one grain that every surface and
// cut-out shows, so a flat colour reads as card, not as a fill. Fine fibres that
// catch the light from one side, and slow, soft changes of tone. It is smooth,
// never pixel noise, and far off its mipmaps fade it to the flat colour, so it
// never shimmers. Painted once per walk in a worker (paintWorker.ts).

import * as THREE from "three";
import { rng } from "../lib/seed";

/** Texels on a side of the grain. */
const GRAIN_PX = 512;
/** Metres one repeat of the fibres covers on a surface, and one repeat of the tone: two sizes, so neither repeat shows. */
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

/**
 * The grain, a repeating tile. Red: the fibres and the paper's fine tooth, lit from the upper left, as an
 * emboss (a texel's height less its lower-right neighbour's). Green: the tone, soft patches of a few sizes.
 * Both are 0.5 on average, so the paper keeps its colour.
 */
export function grain(): OffscreenCanvas {
  const N = GRAIN_PX;
  const r = rng(1164);
  const c = new OffscreenCanvas(N, N);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, N, N);
  // Fibres: short, thin, gently curved strands, a little lighter or darker than the sheet.
  ctx.lineCap = "round";
  for (let i = 0; i < 1800; i++) {
    const [x, y, a, len, bend] = [r() * N, r() * N, r() * Math.PI * 2, 4 + r() * 10, (r() - 0.5) * 0.8];
    const [dx, dy] = [Math.cos(a) * len, Math.sin(a) * len];
    ctx.strokeStyle = r() < 0.55 ? `rgba(255,255,255,${0.06 + r() * 0.1})` : `rgba(0,0,0,${0.05 + r() * 0.07})`;
    ctx.lineWidth = 0.5 + r() * 0.6;
    for (const ox of [-N, 0, N])
      for (const oy of [-N, 0, N]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.quadraticCurveTo(x + ox + dx / 2 - dy * bend, y + oy + dy / 2 + dx * bend, x + ox + dx, y + oy + dy);
        ctx.stroke();
      }
  }
  const px = ctx.getImageData(0, 0, N, N);
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
    px.data[i * 4 + 2] = 128;
    px.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(px, 0, 0);
  return c;
}

/** The grain texture every material samples, one uniform for all: GardenScene.build sets it once the worker has painted it, before the first draw. */
export const GRAIN: { value: THREE.Texture | null } = { value: null };

/** How much the grain lightens or darkens: the fibres, and the tone. A spread of the grain is 48/255 (grain). */
const FIBRE_K = 0.2;
const TONE_K = 0.3;

/** GLSL: paper(at) is how light the paper is at `at`, in metres across its sheet: about 1, a little more or less. */
export const PAPER = /* glsl */ `
  uniform sampler2D uGrain;
  float paper(vec2 at) {
    float fibre = texture2D(uGrain, at / ${FIBRE_M.toFixed(2)}).r - 0.5;
    float tone = texture2D(uGrain, at / ${TONE_M.toFixed(2)} + vec2(0.37, 0.71)).g - 0.5;
    return 1.0 + ${FIBRE_K.toFixed(2)} * fibre + ${TONE_K.toFixed(2)} * tone;
  }
`;

/** Puts `chunk` after `include` in `src`, loudly if three's shader no longer has it. */
function after(src: string, include: string, chunk: string): string {
  if (!src.includes(include)) throw new Error(`paper: no ${include} in the shader`);
  return src.replace(include, `${include}\n${chunk}`);
}

/**
 * Gives a built-in material the paper's grain, laid on in world space: on the ground across x and z, on a wall
 * across the two axes it faces. A surface takes the plane of its face, worked out from how its position
 * changes across the screen, as an unlit material has no normals. One function for every material, so
 * they share their programs (three keys them by its source).
 */
function onPaper(s: THREE.WebGLProgramParametersWithUniforms) {
  s.uniforms.uGrain = GRAIN;
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
    `varying vec3 vPaper;\n${PAPER}\n` +
    after(
      s.fragmentShader,
      "#include <map_fragment>",
      `vec3 paperN = abs(cross(dFdx(vPaper), dFdy(vPaper)));
      diffuseColor.rgb *= paper(paperN.y > max(paperN.x, paperN.z) ? vPaper.xz : paperN.x > paperN.z ? vPaper.zy : vPaper.xy);`,
    );
}

/** `m`, made of paper (onPaper). */
export function paperMaterial<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = onPaper;
  return m;
}
