// Draws plant sprites off the main thread (#459): textures.ts sends a job,
// and gets the pixels back to copy into the walk's sprite sheets.

import "./devWorker";
import { drawPlants, type SpritePlant } from "./plantCanvas";

export interface SpriteJob {
  id: number;
  plants: SpritePlant[];
  cols: number;
  w: number;
  h: number;
}

export interface SpriteDone {
  id: number;
  width: number;
  height: number;
  data: Uint8Array;
}

self.onmessage = (e: MessageEvent<SpriteJob>) => {
  const { id, plants, cols, w, h } = e.data;
  const img = drawPlants(plants, cols, w, h);
  const data = new Uint8Array(img.data.buffer);
  const done: SpriteDone = { id, width: img.width, height: img.height, data };
  self.postMessage(done, { transfer: [data.buffer] });
};
