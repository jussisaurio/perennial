// Paints the walk's biggest procedural textures off the main thread (#571):
// the trees outside the fence and the sky's three looks, a pixel at a time,
// were build steps of 10-40 ms at CPU 10×. textures.ts sends tonight's moon,
// and gets the pixels back while the build does its other steps.

import "./devWorker";
import * as THREE from "three";
import type { TimeOfDay } from "./scene";
import { cloud, hills, moon, sky, SKIES, sun, trees } from "./textures";

// As the walk sets it (GardenScene's constructor): the sky's bands blend its colours as written, not in linear light.
THREE.ColorManagement.enabled = false;

export interface PaintJob {
  moonPhase: number;
}

/** A painted texture: unpremultiplied RGBA, top row first. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PaintDone {
  trees: Pixels;
  cloud: Pixels;
  looks: Record<TimeOfDay, { sky: Pixels; hills: Pixels; sun: Pixels }>;
}

self.onmessage = (e: MessageEvent<PaintJob>) => {
  const buffers: ArrayBuffer[] = [];
  const pixels = (c: OffscreenCanvas): Pixels => {
    const data = new Uint8Array(c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data.buffer);
    buffers.push(data.buffer);
    return { width: c.width, height: c.height, data };
  };
  const look = (time: TimeOfDay) => ({
    sky: pixels(sky(SKIES[time], time === "night")),
    hills: pixels(hills(time === "night")),
    sun: pixels(time === "night" ? moon(e.data.moonPhase) : sun(time)),
  });
  const done: PaintDone = { trees: pixels(trees()), cloud: pixels(cloud()), looks: { day: look("day"), dusk: look("dusk"), night: look("night") } };
  self.postMessage(done, { transfer: buffers });
};
