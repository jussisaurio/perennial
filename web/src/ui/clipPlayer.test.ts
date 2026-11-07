import { afterEach, expect, mock, test } from "bun:test";

// Clips are on when the build has an audio host (read at import).
process.env.VITE_AUDIO_BASE_URL = "https://audio.example";
const reports: unknown[][] = [];
mock.module("../observability", () => ({ reportClipFailed: (...a: unknown[]) => reports.push(a) }));
const { loadClip } = await import("./clipPlayer");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  reports.length = 0;
});

test("a clip whose download breaks off is a network failure: reported with the browser's error, and asked again next time", async () => {
  let asked = 0;
  const broke = new TypeError("network error");
  globalThis.fetch = (async () => {
    asked++;
    return new Response(new ReadableStream({ start: (c) => c.error(broke) }), { status: 200 });
  }) as unknown as typeof fetch;
  expect(await loadClip("hola", "es-ES")).toBeNull();
  expect(reports).toEqual([["network", "es", broke]]);
  expect(await loadClip("hola", "es-ES")).toBeNull();
  expect(asked).toBe(2);
});

test("a text with no clip is kept as missing: the browser says it, and it is not asked again", async () => {
  let asked = 0;
  globalThis.fetch = (async () => (asked++, new Response("", { status: 404 }))) as unknown as typeof fetch;
  expect(await loadClip("adiós", "es-ES")).toBeNull();
  expect(await loadClip("adiós", "es-ES")).toBeNull();
  expect(asked).toBe(1);
  expect(reports).toEqual([["HTTP 404", "es"]]);
});
