import { expect, test } from "bun:test";
import type { SpritePlant } from "./plantCanvas";
import type { StripDone, StripJob } from "./stripWorker";

// No DOM here: a worker that answers at once, and images whose load fails for
// the PNGs marked "broken", as Safari's did (#637).
class FakeWorker {
  onmessage: ((e: { data: StripDone }) => void) | null = null;
  postMessage(job: StripJob) {
    const pngs = job.plants.map((p) => new Blob([p.lemma === "broken" ? "broken" : "png"]));
    queueMicrotask(() => this.onmessage!({ data: { id: job.id, pngs } }));
  }
}
const blobs = new Map<string, Blob>();
class FakeImage {
  src = "";
  async decode() {
    if ((await blobs.get(this.src)!.text()) === "broken") throw new DOMException("Loading error.", "EncodingError");
  }
}
// The failure report reads whether the page is in view. It only runs once another
// test file has loaded Sentry, so without this the test passed alone and failed in the full run (#661).
Object.assign(globalThis, { Worker: FakeWorker, Image: FakeImage, document: { visibilityState: "visible" } });
let next = 0;
URL.createObjectURL = (b: Blob) => {
  const url = `blob:${next++}`;
  blobs.set(url, b);
  return url;
};
URL.revokeObjectURL = () => {};

const { drawSprites, spriteKey, stripSprite } = await import("./stripSprites");

test("a sprite that does not load leaves the other plants drawn, and is drawn again when asked (#637)", async () => {
  const good: SpritePlant = { lemma: "casa", stage: "bloom", growth: 1 };
  const broken: SpritePlant = { lemma: "broken", stage: "bloom", growth: 1 };
  await drawSprites([good, broken], 1, 1);
  expect(stripSprite(spriteKey(good, 1, 1))).toBeString();
  expect(stripSprite(spriteKey(broken, 1, 1))).toBeUndefined();
  const asked = next;
  await drawSprites([good, broken], 1, 1);
  expect(next).toBe(asked + 1);
});
