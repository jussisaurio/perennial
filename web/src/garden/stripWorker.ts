// Draws the garden strip's plants off the main thread (#486): stripSprites.ts
// sends a job, and gets one PNG per plant back for an <image>.

import "./devWorker";
import { plantPng, type SpritePlant } from "./plantCanvas";

export interface StripJob {
  id: number;
  plants: SpritePlant[];
  scale: number;
  dpr: number;
}

export interface StripDone {
  id: number;
  pngs: Blob[];
}

self.onmessage = async (e: MessageEvent<StripJob>) => {
  const { id, plants, scale, dpr } = e.data;
  const pngs = await Promise.all(plants.map((p) => plantPng(p, scale, dpr)));
  const done: StripDone = { id, pngs };
  self.postMessage(done);
};
