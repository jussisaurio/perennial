import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { clipKey, clipPath, slug, VOICE } from "../../web/src/content/clips.ts";
import { backoff, chars, clipsFor, putClip, render, spokenTexts, type Clip, type Deps } from "./lib.ts";

const deck = {
  words: [
    { lemma: "ser", forms: ["ser", "soy", "es"] },
    { lemma: "de", forms: ["de"] },
  ],
  sentences: [{ text: "Soy de México." }, { text: "Es de aquí." }],
};

describe("spokenTexts", () => {
  test("has each word, its shaken forms, each sentence and the garden's nouns, once", () => {
    const t = spokenTexts(deck, "es");
    for (const s of ["ser", "soy", "es", "de", "Soy de México.", "Es de aquí.", "el girasol", "el caracol", "croac…"]) expect(t).toContain(s);
    expect(new Set(t).size).toBe(t.length);
  });

  test("dedupes across composed and decomposed spellings", () => {
    const t = spokenTexts({ words: [{ lemma: "aquí", forms: [] }], sentences: [{ text: "aqui\u0301" }] }, "es");
    expect(t.filter((x) => x === "aquí")).toHaveLength(1);
  });
});

test("a clip's path is the app's path for the same text, whatever its Unicode form", async () => {
  const [c] = await clipsFor(["aquí"], "es");
  expect(c!.path).toBe(await clipPath("aqui\u0301", "es"));
  expect(c!.path).toMatch(/^es\/aqui-[0-9a-f]{16}\.mp3$/);
  expect(c!.tag).toBe("es-ES");
  expect(c!.path).not.toBe(await clipPath("aquí", "de"));
});

describe("clipKey", () => {
  const base = { ...VOICE, lang: "es", text: "hola" };

  test("is sha256 of version|model|voice|speed|lang|text, and the path ends with its first 16 hex digits", async () => {
    const key = createHash("sha256").update("v1|chirp3-hd|Charon|1|es|hola").digest("hex");
    expect(await clipKey(base)).toBe(key);
    expect(await clipPath("hola", "es")).toBe(`es/hola-${key.slice(0, 16)}.mp3`);
  });

  test("changes when any input changes", async () => {
    const changed = [{ version: "v2" }, { model: "other" }, { voice: "Aoede" }, { speed: 0.75 }, { lang: "de" }, { text: "hola." }];
    const keys = await Promise.all(changed.map((c) => clipKey({ ...base, ...c })));
    expect(new Set([await clipKey(base), ...keys]).size).toBe(changed.length + 1);
  });
});

describe("slug", () => {
  test("lowercase ASCII words joined by -", () => {
    expect(slug("¿Por qué, María?")).toBe("por-que-maria");
    expect(slug("El niño")).toBe("el-nino");
    expect(slug("Grüße aus Köln!")).toBe("grusse-aus-koln");
  });

  test("a long sentence is cut at a word, to at most 40 characters", () => {
    expect(slug("Ich habe gestern Abend mit meiner Schwester lange telefoniert.")).toBe("ich-habe-gestern-abend-mit-meiner");
    expect(slug("a".repeat(50))).toBe("a".repeat(40));
  });

  test("x when nothing readable is left", () => {
    expect(slug("¡…!")).toBe("x");
  });
});

test("an upload sets the object's type and lets the CDN and browsers keep it forever", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  await putClip("https://r2.example/presigned", new Uint8Array([1, 2]), async (url, init) => {
    seen.push({ url, init });
    return new Response(null, { status: 200 });
  });
  expect(seen).toHaveLength(1);
  expect(seen[0]!.init.method).toBe("PUT");
  const headers = new Headers(seen[0]!.init.headers);
  expect(headers.get("content-type")).toBe("audio/mpeg");
  expect(headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
});

const audio = Buffer.from("mp3").toString("base64");
const ok = () => Response.json({ audioContent: audio });

function harness(answer: (call: number, body: { input: { text: string } }) => Response | Promise<Response>) {
  const calls: string[] = [];
  /** Requests in flight as each one started, by its text. */
  const inFlight = new Map<string, number>();
  const uploads: string[] = [];
  const sleeps: number[] = [];
  const stored = new Map<string, Uint8Array<ArrayBuffer>>();
  let active = 0;
  const deps: Deps = {
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init.body)) as { input: { text: string } };
      calls.push(body.input.text);
      active++;
      inFlight.set(body.input.text, Math.max(inFlight.get(body.input.text) ?? 0, active));
      await Promise.resolve();
      try {
        return await answer(calls.length, body);
      } finally {
        active--;
      }
    },
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
    local: { read: (p) => stored.get(p) ?? null, write: (p, b) => void stored.set(p, b) },
    upload: async (p) => void uploads.push(p),
    log: () => {},
  };
  return { deps, calls, uploads, sleeps, stored, inFlight };
}

const clips = (texts: string[]): Clip[] => texts.map((text) => ({ lang: "es", tag: "es-ES", text, path: `es/${text}.mp3` }));
const opts = { apiKey: "k", maxChars: 1_000, concurrency: 4, attempts: 4 };

describe("render", () => {
  test("makes and uploads every clip", async () => {
    const h = harness(ok);
    const r = await render(clips(["uno", "dos", "tres"]), opts, h.deps);
    expect(r).toEqual({ done: 3, sent: 10, failed: [] });
    expect(h.uploads.sort()).toEqual(["es/dos.mp3", "es/tres.mp3", "es/uno.mp3"]);
  });

  test("a clip in the out folder is uploaded, not made again", async () => {
    const h = harness(ok);
    h.stored.set("es/uno.mp3", new Uint8Array([1]));
    const r = await render(clips(["uno", "dos"]), opts, h.deps);
    expect(h.calls).toEqual(["dos"]);
    expect(r.done).toBe(2);
  });

  test("stops at --max-chars and lists what was not sent", async () => {
    const h = harness(ok);
    const r = await render(clips(["aaaa", "bbbb", "cccc", "dddd"]), { ...opts, maxChars: 9, concurrency: 1 }, h.deps);
    expect(r.sent).toBe(8);
    expect(h.calls).toEqual(["aaaa", "bbbb"]);
    expect(r.failed.map((f) => f.text)).toEqual(["cccc", "dddd"]);
  });

  test("retries count toward the cap", async () => {
    const h = harness(() => new Response("", { status: 503 }));
    const r = await render(clips(["aaaa"]), { ...opts, maxChars: 10 }, h.deps);
    expect(h.calls).toHaveLength(2);
    expect(r.sent).toBe(8);
    expect(r.failed[0]!.reason).toContain("--max-chars");
  });

  test("backs off on 429 and 5xx, lowers the parallel requests, then succeeds", async () => {
    const h = harness((n) => (n <= 4 ? new Response("", { status: n % 2 ? 429 : 500 }) : ok()));
    const r = await render(clips(["a", "b", "c", "d", "e", "f", "g", "h"]), { ...opts, concurrency: 4 }, h.deps);
    expect(r.failed).toEqual([]);
    expect(r.done).toBe(8);
    expect(h.sleeps).toEqual([1000, 1000, 1000, 1000]);
    // The first four went together; their four throttles halved 4 parallel requests to 1, so the rest went one at a time.
    expect(["a", "b", "c", "d"].map((t) => h.inFlight.get(t))).toContain(4);
    expect(["e", "f", "g", "h"].map((t) => h.inFlight.get(t))).toEqual([1, 1, 1, 1]);
  });

  test("lists a clip that keeps failing, after its last try, and goes on", async () => {
    const h = harness((_n, body) => (body.input.text === "bad" ? new Response("", { status: 500 }) : ok()));
    const r = await render(clips(["bad", "good"]), opts, h.deps);
    expect(h.calls.filter((t) => t === "bad")).toHaveLength(4);
    expect(r.done).toBe(1);
    expect(r.failed).toEqual([{ path: "es/bad.mp3", text: "bad", reason: "HTTP 500" }]);
  });

  test("a 400 is not retried", async () => {
    const h = harness(() => new Response("bad voice", { status: 400 }));
    const r = await render(clips(["x"]), opts, h.deps);
    expect(h.calls).toHaveLength(1);
    expect(r.failed[0]!.reason).toBe("HTTP 400: bad voice");
  });

  test("backoff doubles, with jitter, up to 30 s", () => {
    expect(backoff(1, () => 0.5)).toBe(1000);
    expect(backoff(3, () => 0)).toBe(2000);
    expect(backoff(10, () => 1)).toBe(45_000);
  });
});

test("chars counts every clip's text", () => {
  expect(chars(clips(["ab", "cde"]))).toBe(5);
});
