// The garden strip's plants as one <image> each (#486): ~25 SVG elements per
// plant cost ~45 µs each of style and layout at CPU 10×, so a screen of plants
// was a ~44 ms task. A worker (stripWorker.ts) draws each plant as a PNG, and
// the image is decoded off the main thread before the strip shows it.

import type { SpritePlant } from "./plantCanvas";
import type { StripDone, StripJob } from "./stripWorker";
import { inSlices } from "../lib/yield";

/** A plant's look at a scale and pixel density: plants that look the same share a sprite. */
export const spriteKey = (p: SpritePlant, scale: number, dpr: number) => `${p.lemma} ${p.stage} ${p.growth} ${scale} ${dpr}`;

// Object URLs stay for the page's life: a plant that grows leaves its old sprite, a few KB, until a reload.
const ready = new Map<string, string>();
const drawing = new Map<string, Promise<void>>();
let worker: Worker | null = null;
let nextJob = 0;
const waiting = new Map<number, { resolve: (pngs: Blob[]) => void; reject: (e: unknown) => void }>();

/** The sprite's URL, once it is drawn and decoded. */
export const stripSprite = (key: string) => ready.get(key);

function drawn(plants: SpritePlant[], scale: number, dpr: number): Promise<Blob[]> {
  if (!worker) {
    worker = new Worker(new URL("./stripWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<StripDone>) => {
      waiting.get(e.data.id)!.resolve(e.data.pngs);
      waiting.delete(e.data.id);
    };
    // A worker that fails draws nothing more: every plant still waiting fails loudly, not silently blank.
    worker.onerror = (e) => {
      for (const w of waiting.values()) w.reject(new Error(`strip sprite worker: ${e.message}`));
      waiting.clear();
    };
  }
  const id = nextJob++;
  const job: StripJob = { id, plants: plants.map((p) => ({ lemma: p.lemma, growth: p.growth, stage: p.stage })), scale, dpr };
  worker.postMessage(job);
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}

/** Starts loading each PNG as an image, one step per image; each URL resolves once its image is decoded. */
function* decodeSteps(pngs: Blob[]): Generator<void, Promise<string>[]> {
  const urls: Promise<string>[] = [];
  for (const png of pngs) {
    const url = URL.createObjectURL(png);
    const img = new Image();
    img.src = url;
    // Decoded before the strip shows it, off the main thread, so its first paint does not decode it.
    urls.push(img.decode().then(() => url));
    yield;
  }
  return urls;
}

/** Draws the sprites not drawn yet, in one job; resolves when all of them are ready. */
export function drawSprites(plants: SpritePlant[], scale: number, dpr: number): Promise<void> {
  const todo = plants.filter((p) => !drawing.has(spriteKey(p, scale, dpr)));
  if (todo.length) {
    // Started in slices: starting a screen of plant images at once was a ~40 ms task at CPU 10× (#569).
    const decoded = drawn(todo, scale, dpr).then((pngs) => inSlices(decodeSteps(pngs)));
    todo.forEach((p, i) => {
      const key = spriteKey(p, scale, dpr);
      drawing.set(
        key,
        decoded.then(async (urls) => {
          ready.set(key, await urls[i]);
        }),
      );
    });
  }
  return Promise.all(plants.map((p) => drawing.get(spriteKey(p, scale, dpr)))).then(() => undefined);
}
