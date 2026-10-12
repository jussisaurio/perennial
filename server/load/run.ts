// Load test with CPU and heap profiles. Starts its own server against the
// local stack (`docker compose up -d`, migrated) and simulates learners the way
// the app behaves: an anonymous sign-in, a course, then reviews written in
// small batches while a live shape poll per learner waits for them to sync back.
//
//   bun load/run.ts [--users 50] [--seconds 30]
//
// Writes to load/out/: report.md (latencies, throughput, memory), the server's
// CPU profile (.cpuprofile for Chrome DevTools, plus a markdown summary) and a
// heap summary taken on exit (markdown).

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (name: string, d: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const USERS = arg("users", 50);
const SECONDS = arg("seconds", 30);
const PORT = 18900 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const OUT = join(import.meta.dir, "out");
// Real deck words: the server refuses reviews of words that don't exist.
const DECK_IDS = (JSON.parse(await Bun.file(join(import.meta.dir, "../../decks/es/deck.json")).text()) as { words: { id: string }[] }).words.map((w) => w.id);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ---- the server under test, profiled ----------------------------------------

const server = Bun.spawn(
  // Relative dirs: Bun joins an absolute --heap-prof-dir onto the cwd.
  ["bun", "--cpu-prof", "--cpu-prof-md", "--cpu-prof-dir=load/out", "--heap-prof-md", "--heap-prof-dir=load/out", "index.ts"],
  {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, PORT: String(PORT), APP_URL: BASE, PERENNIAL_DEV: "1", LOG_LEVEL: "error" },
    stdout: "ignore", // request logs
    stderr: "inherit",
  },
);
for (let i = 0; ; i++) {
  if (i > 100) throw new Error("server did not start");
  if (await fetch(`${BASE}/health`).then((r) => r.ok, () => false)) break;
  await Bun.sleep(100);
}

// ---- measurements -------------------------------------------------------------

const timings = new Map<string, number[]>();
const errors = new Map<string, number>();
const echo: number[] = [];
function record(name: string, ms: number, ok: boolean) {
  if (!timings.has(name)) timings.set(name, []);
  timings.get(name)!.push(ms);
  if (!ok) errors.set(name, (errors.get(name) ?? 0) + 1);
}
const memory: { t: number; rssMb: number }[] = [];
const started = performance.now();
const sampler = setInterval(async () => {
  const ps = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(server.pid)]);
  memory.push({ t: Math.round((performance.now() - started) / 1000), rssMb: Math.round(Number(ps.stdout.toString().trim()) / 1024) });
}, 1000);

async function call(name: string, path: string, cookie: string | undefined, body?: unknown, signal?: AbortSignal) {
  const t = performance.now();
  try {
    const res = await fetch(BASE + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    record(name, performance.now() - t, res.ok);
    return { res, text };
  } catch (e) {
    if (signal?.aborted) return null;
    record(name, performance.now() - t, false);
    return null;
  }
}

// ---- one simulated learner ------------------------------------------------------

const deadline = Date.now() + SECONDS * 1000;
const stop = new AbortController();

async function learner(n: number) {
  await Bun.sleep(Math.random() * 2000); // arrivals spread over 2 s
  const signedIn = await call("sign-in (anonymous)", "/api/auth/sign-in/anonymous", undefined, {});
  if (!signedIn) return;
  const cookie = signedIn.res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  await call("write: course", "/api/write", cookie, { mutations: [{ type: "course.upsert", row: { lang: "es", minutes: 10 } }] });

  // The live poll, as the client keeps one per table (here: reviews only).
  const sent = new Map<string, number>();
  const poll = (async () => {
    let offset = "-1";
    let handle = "";
    while (!stop.signal.aborted) {
      const live = offset === "-1" ? "" : "&live=true";
      const r = await call(offset === "-1" ? "shape: initial" : "shape: live poll", `/api/shape?table=review&offset=${offset}${handle ? `&handle=${handle}` : ""}${live}`, cookie, undefined, stop.signal);
      if (!r) break;
      if (r.res.status === 409) {
        offset = "-1";
        handle = "";
        continue;
      }
      offset = r.res.headers.get("electric-offset") ?? offset;
      handle = r.res.headers.get("electric-handle") ?? handle;
      for (const m of JSON.parse(r.text || "[]") as { value?: { id: string } }[]) {
        const at = m.value && sent.get(m.value.id);
        if (at) {
          echo.push(performance.now() - at);
          sent.delete(m.value!.id);
        }
      }
    }
  })();

  // A session: a review every 2-5 s, sent in batches of 1-3 (the offline queue merges).
  let word = 0;
  while (Date.now() < deadline) {
    await Bun.sleep(2000 + Math.random() * 3000);
    const batch = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({
      type: "review.insert",
      row: { id: crypto.randomUUID(), lang: "es", word_id: DECK_IDS[(n * 37 + word++) % DECK_IDS.length], skill: "read", grade: 3, reviewed_at: new Date().toISOString(), duration_ms: 4000 },
    }));
    const t = performance.now();
    for (const m of batch) sent.set(m.row.id, t);
    await call("write: reviews", "/api/write", cookie, { mutations: batch });
    if (Math.random() < 0.1) await call("me", "/api/me", cookie);
  }
  await poll;
}

const runners = Array.from({ length: USERS }, (_, i) => learner(i));
await Bun.sleep(SECONDS * 1000);
stop.abort();
await Promise.allSettled(runners);
clearInterval(sampler);

// Profiles are written when the server exits.
server.kill("SIGINT");
await server.exited;

// ---- report ---------------------------------------------------------------------

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]) : 0;
};
const rows = [...timings].map(([name, xs]) => `| ${name} | ${xs.length} | ${errors.get(name) ?? 0} | ${pct(xs, 50)} | ${pct(xs, 95)} | ${pct(xs, 99)} |`);
const peak = Math.max(0, ...memory.map((m) => m.rssMb));
const files = readdirSync(OUT);
const report = `# Load test: ${USERS} learners, ${SECONDS} s

| Request | Count | Errors | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|
${rows.join("\n")}
| write → synced back (echo) | ${echo.length} | | ${pct(echo, 50)} | ${pct(echo, 95)} | ${pct(echo, 99)} |

Live polls wait up to ~20 s by design; their latency is not a cost.

Server memory (RSS): start ${memory[0]?.rssMb ?? "?"} MB, peak ${peak} MB, end ${memory.at(-1)?.rssMb ?? "?"} MB.
Writes per second: ${((timings.get("write: reviews")?.length ?? 0) / SECONDS).toFixed(1)}.

Profiles in this folder: ${files.join(", ")}
Open the .cpuprofile in Chrome DevTools (Performance) or speedscope; the .md files are grep-friendly summaries.
`;
writeFileSync(join(OUT, "report.md"), report);
console.log(report);
