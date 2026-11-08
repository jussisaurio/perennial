// GET /api/boot (#602), started as soon as the app's code loads (main.tsx),
// before React, Effect and the wire contract: the answer is on its way while
// they load. data/boot.ts reads it.

/**
 * On an iPhone a request can wait with no answer and no error, and only a
 * reload helps (#312, #911: the server sent the boot answer in 156 ms, and the
 * page stayed on the sprout). So the boot stops after this long with nothing
 * new coming, and the page says so. Silence, not the whole download: on a slow
 * link a long history can take longer than this, but bytes keep coming.
 */
const SILENCE_MS = 15_000;

/** The answer, read to its end: a stall in the body counts too. Rejects when nothing came for SILENCE_MS. */
async function fetchBoot(): Promise<Response> {
  const stop = new AbortController();
  let timer = setTimeout(() => stop.abort(), SILENCE_MS);
  const heard = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stop.abort(), SILENCE_MS);
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

/** The one boot request: the first call starts it. */
export const startBoot = () => (started ??= fetchBoot());
