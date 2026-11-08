// GET /api/boot (#602), started as soon as the app's code loads (main.tsx),
// before React, Effect and the wire contract: the answer is on its way while
// they load. data/boot.ts reads it.

/**
 * On an iPhone a request can wait with no answer and no error, and only a
 * reload helps (#312, #911). So a boot request stops after a time with
 * nothing new coming. Silence, not the whole download: on a slow link a long
 * history takes longer, but bytes keep coming.
 *
 * The first try waits 5 s: the server answers in well under a second, and even
 * a slow phone link brings the first bytes in a second or two, so 5 s of
 * nothing is a lost answer far more often than a slow one. The second try
 * waits 15 s, so a link that really is that slow still loads, only later.
 */
const FIRST_SILENCE_MS = 5_000;
const SECOND_SILENCE_MS = 15_000;

/** The answer, read to its end: a stall in the body counts too. Rejects when nothing came for `silenceMs`. */
async function fetchBoot(silenceMs: number): Promise<Response> {
  const stop = new AbortController();
  let timer = setTimeout(() => stop.abort(), silenceMs);
  const heard = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stop.abort(), silenceMs);
  };
  try {
    const res = await fetch("/api/boot", { signal: stop.signal });
    heard();
    const parts: BlobPart[] = [];
    // `res.body` is null only for an answer with no body (204, say): there is nothing to read.
    if (res.body)
      for (const reader = res.body.getReader(); ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        heard();
      }
    return new Response(new Blob(parts), { status: res.status, statusText: res.statusText, headers: res.headers });
  } finally {
    clearTimeout(timer);
  }
}

let started: Promise<Response> | null = null;

/**
 * The boot answer: the first call starts it. A failed or silent first try is
 * sent once more, as a new request, before the page says it could not load:
 * Safari can lose the answer on a restored tab, and a new request (what a
 * reload does) gets it (#911).
 */
export const startBoot = () => (started ??= fetchBoot(FIRST_SILENCE_MS).catch(() => fetchBoot(SECOND_SILENCE_MS)));
