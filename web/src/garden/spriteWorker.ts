// Draws plant sprites off the main thread (#459): textures.ts sends a job,
// and gets the pixels back to copy into the walk's sprite sheets.

import "./devWorker";
import { drawPlants, halve, type SpritePlant } from "./plantCanvas";

export interface SpriteJob {
  id: number;
  plants: SpritePlant[];
  cols: number;
  w: number;
  h: number;
  /** Mipmap levels to make, the full size first. */
  levels: number;
}

export interface SpriteLevel {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface SpriteDone {
  id: number;
  levels: SpriteLevel[];
}

self.onmessage = (e: MessageEvent<SpriteJob>) => {
  const { id, plants, cols, w, h } = e.data;
  const img = drawPlants(plants, cols, w, h);
  // The mipmaps are made here, not by the GPU: it can only remake a whole texture's, all 60 MB of the pool for each batch (#1091).
  const levels: SpriteLevel[] = [{ width: img.width, height: img.height, data: new Uint8Array(img.data.buffer) }];
  for (let l = 1; l < e.data.levels; l++) {
    const up = levels[l - 1];
    levels.push({ width: up.width / 2, height: up.height / 2, data: halve(up.data, up.width, up.height) });
  }
  const done: SpriteDone = { id, levels };
  self.postMessage(done, { transfer: levels.map((l) => l.data.buffer) });
};
