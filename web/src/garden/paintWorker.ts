// Paints the walk's biggest procedural textures off the main thread (#571), a
// pixel at a time: the trees outside the fence and the sky's three looks were
// build steps of 10-40 ms at CPU 10×, and the orchard's atlas one of ~340 ms.
// textures.ts sends a job, and gets the pixels back while the build does its other steps.

import "./devWorker";
import * as THREE from "three";
import type { TimeOfDay } from "./game";
import { cloud, hills, moon, orchard, sky, SKIES, sun, trees } from "./textures";

// As the walk sets it (GardenScene's constructor): the sky's bands blend its colours as written, not in linear light.
THREE.ColorManagement.enabled = false;

/** "far": the trees outside the fence, the clouds and the sky's looks, with tonight's moon. "orchard": the orchard's tree atlas. */
export type PaintJob = { kind: "far"; moonPhase: number } | { kind: "orchard" };

/** A painted texture: unpremultiplied RGBA, top row first. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/** What a "far" job sends back. */
export interface FarPixels {
  trees: Pixels;
  cloud: Pixels;
  looks: Record<TimeOfDay, { sky: Pixels; hills: Pixels; sun: Pixels }>;
}

self.onmessage = (e: MessageEvent<PaintJob>) => {
  const job = e.data;
  const buffers: ArrayBuffer[] = [];
  const pixels = (c: OffscreenCanvas): Pixels => {
    const data = new Uint8Array(c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data.buffer);
    buffers.push(data.buffer);
    return { width: c.width, height: c.height, data };
  };
  if (job.kind === "orchard") {
    self.postMessage(pixels(orchard()), { transfer: buffers });
    return;
  }
  const look = (time: TimeOfDay) => ({
    sky: pixels(sky(SKIES[time], time === "night")),
    hills: pixels(hills(time === "night")),
    sun: pixels(time === "night" ? moon(job.moonPhase) : sun(time)),
  });
  const done: FarPixels = { trees: pixels(trees()), cloud: pixels(cloud()), looks: { day: look("day"), dusk: look("dusk"), night: look("night") } };
  self.postMessage(done, { transfer: buffers });
};
