// The clips the app needs (#306), and rendering them with Google Chirp 3 HD.
// Pure apart from what comes in through Deps, so tests run it with a fake fetch.

import type { DeckLang } from "../../web/src/deck/langs.ts";
import { clipPath, voiceName } from "../../web/src/content/clips.ts";
import { language } from "../../web/src/content/languages.ts";
import { petalForms } from "../../web/src/garden/shake.ts";
import { SCENERY } from "../../web/src/garden/scenery.ts";
import { VISITORS } from "../../web/src/garden/visitors.ts";

export interface Clip {
  lang: DeckLang;
  /** The BCP 47 tag Google's voice is named by. */
  tag: string;
  text: string;
  /** Its name in the bucket (clipPath). */
  path: string;
}

/** The parts of a deck that are spoken. */
export interface SpokenDeck {
  words: readonly { lemma: string; forms: readonly string[] }[];
  sentences: readonly { text: string }[];
}

/**
 * Every text the app says in this course, each once (callers of web/src/ui/speech.ts):
 * words (cards, plants, orchard trees, the well's echo), a shaken
 * plant's forms, sentences, and the garden's scenery and visitor nouns. Animals never
 * speak in this voice, so the frog's croak has no clip (nor do words from the learner's
 * own texts): those plays use browser speech.
 */
export function spokenTexts(deck: SpokenDeck, lang: DeckLang): string[] {
  const out = new Set<string>();
  const add = (t: string) => out.add(t.normalize("NFC"));
  for (const w of deck.words) {
    add(w.lemma);
    for (const f of petalForms(w.lemma, w.forms)) add(f);
  }
  for (const s of deck.sentences) add(s.text);
  for (const def of Object.values(SCENERY)) add(def.words[lang]);
  for (const v of VISITORS) add(v.words[lang]);
  return [...out];
}

export async function clipsFor(texts: readonly string[], lang: DeckLang): Promise<Clip[]> {
  const { tag } = language(lang);
  return Promise.all(texts.map(async (text) => ({ lang, tag, text, path: await clipPath(text, lang) })));
}

/** Characters Google bills for. UTF-16 length is never below the code-point count, so the cap errs on the safe side. */
export const chars = (clips: readonly Clip[]) => clips.reduce((n, c) => n + c.text.length, 0);

/** Chirp 3 HD: the first 1M characters each month are free, then $30 per 1M (Google Cloud pricing, 2026-11). */
const FREE_CHARS = 1_000_000;
const USD_PER_MILLION = 30;

export function costLine(n: number): string {
  const over = Math.max(0, n - FREE_CHARS);
  return `${n.toLocaleString("en")} characters of the 1,000,000 free each month: $${((over / 1e6) * USD_PER_MILLION).toFixed(2)} if nothing else used the free tier this month (then $${USD_PER_MILLION} per 1M).`;
}

export interface Deps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
  /** The local out folder: a clip made before but not uploaded is not made again. */
  local: { read: (path: string) => Uint8Array<ArrayBuffer> | null; write: (path: string, bytes: Uint8Array<ArrayBuffer>) => void };
  upload: (path: string, bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
  log: (line: string) => void;
}

export interface RenderOptions {
  apiKey: string;
  /** Stop once this many characters have been sent, retries included. */
  maxChars: number;
  concurrency: number;
  /** Requests started in any 60 s, at most (pace). */
  rpm: number;
  /** Tries per clip on 429, 5xx or a network error, before it is listed as failed. */
  attempts: number;
}

export interface Rendered {
  done: number;
  sent: number;
  failed: { path: string; text: string; reason: string }[];
}

/**
 * R2 object headers. A clip never changes (new text, new name), so the CDN and browsers may keep it forever.
 * Google's MP3 is 32 kbps already (about 4.7 KB a clip): it is stored as it comes, not re-encoded.
 */
const CLIP_HEADERS = { "content-type": "audio/mpeg", "cache-control": "public, max-age=31536000, immutable" } as const;

/** Uploads one clip to a presigned PUT URL, with CLIP_HEADERS: R2 keeps them as the object's own headers. */
export async function putClip(url: string, bytes: Uint8Array<ArrayBuffer>, fetchFn: Deps["fetch"]): Promise<void> {
  const res = await fetchFn(url, { method: "PUT", headers: CLIP_HEADERS, body: bytes });
  if (!res.ok) throw new Error(`R2 PUT ${res.status}`);
}

const SYNTHESIZE = "https://texttospeech.googleapis.com/v1/text:synthesize";

/**
 * Google allows 200 Chirp 3 HD requests a minute per project (Chirp3RequestsPerMinutePerProject,
 * https://cloud.google.com/text-to-speech/quotas). Going faster only earns 429s.
 */
export const GOOGLE_RPM = 200;
const MINUTE = 60_000;

/** Waits until a request may start: at most `rpm` starts in any rolling 60 s. Callers queue in order. */
export function pace(rpm: number, now: () => number, sleep: (ms: number) => Promise<void>): () => Promise<void> {
  const starts: number[] = [];
  let line = Promise.resolve();
  return () =>
    (line = line.then(async () => {
      for (;;) {
        const t = now();
        while (starts.length && starts[0]! <= t - MINUTE) starts.shift();
        if (starts.length < rpm) {
          starts.push(t);
          return;
        }
        await sleep(starts[0]! + MINUTE - t);
      }
    }));
}

/** Successes in a row that win back one parallel request, after a 429 or 5xx halved them. */
const RAISE_AFTER = 20;

/** 1 s, 2 s, 4 s… up to 30 s, times 0.5–1.5 so parallel retries do not come back together. */
export const backoff = (attempt: number, random: () => number) => Math.min(30_000, 1000 * 2 ** (attempt - 1)) * (0.5 + random());

/** A request that may work later (throttled, a server error, the network) or never (any other answer). */
class Retry extends Error {}

export async function render(clips: readonly Clip[], o: RenderOptions, d: Deps): Promise<Rendered> {
  let limit = o.concurrency;
  let streak = 0;
  let sent = 0;
  let done = 0;
  let capped = false;
  const failed: Rendered["failed"] = [];
  const slot = pace(o.rpm, d.now, d.sleep);

  const synthesize = async (c: Clip): Promise<Uint8Array<ArrayBuffer>> => {
    const res = await d
      .fetch(SYNTHESIZE, {
        method: "POST",
        // In a header, not the URL: URLs end up in logs.
        headers: { "content-type": "application/json", "x-goog-api-key": o.apiKey },
        body: JSON.stringify({ input: { text: c.text }, voice: { languageCode: c.tag, name: voiceName(c.tag) }, audioConfig: { audioEncoding: "MP3" } }),
      })
      .catch((e: unknown) => {
        throw new Retry(`network: ${String(e)}`);
      });
    if (res.status === 429 || res.status >= 500) throw new Retry(`HTTP ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { audioContent?: string };
    if (!body.audioContent) throw new Error("no audioContent in the answer");
    return Uint8Array.from(Buffer.from(body.audioContent, "base64"));
  };

  // One step with retries. A throttle or server error halves the parallel requests.
  const tries = async <T>(step: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await step();
      } catch (e) {
        if (!(e instanceof Retry) || attempt === o.attempts) throw e;
        limit = Math.max(1, Math.floor(limit / 2));
        streak = 0;
        await d.sleep(backoff(attempt, d.random));
      }
    }
  };

  const make = async (c: Clip) => {
    const bytes = await tries(async () => {
      await slot();
      // Checked before each request: the cap holds with retries too.
      if (sent + c.text.length > o.maxChars) {
        capped = true;
        throw new Error("not sent: --max-chars reached");
      }
      sent += c.text.length;
      return synthesize(c);
    });
    d.local.write(c.path, bytes);
    return bytes;
  };

  const one = async (c: Clip) => {
    try {
      // `??`: null means not made yet.
      const bytes = d.local.read(c.path) ?? (await make(c));
      await tries(() =>
        d.upload(c.path, bytes).catch((e: unknown) => {
          throw new Retry(`upload: ${String(e)}`);
        }),
      );
      done++;
      if (++streak >= RAISE_AFTER && limit < o.concurrency) {
        limit++;
        streak = 0;
      }
    } catch (e) {
      failed.push({ path: c.path, text: c.text, reason: e instanceof Error ? e.message : String(e) });
    }
  };

  const queue = [...clips];
  const running = new Set<Promise<void>>();
  while (queue.length || running.size) {
    while (!capped && queue.length && running.size < limit) {
      const p: Promise<void> = one(queue.shift()!).finally(() => running.delete(p));
      running.add(p);
    }
    if (!running.size) break;
    await Promise.race(running);
    if ((done + failed.length) % 500 === 0) d.log(`${done} done, ${failed.length} failed, ${sent.toLocaleString("en")} characters sent`);
  }
  for (const c of queue) failed.push({ path: c.path, text: c.text, reason: "not started: --max-chars reached" });
  return { done, sent, failed };
}
