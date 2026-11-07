// Renders the app's recorded audio (#306) with Google Chirp 3 HD and uploads
// it to R2. Run by hand, from the owner's machine; never in CI.
//
//   bun scripts/tts/render.ts                          dry run: counts and cost, nothing sent
//   bun --env-file=.env.tts scripts/tts/render.ts --run --max-chars 500000
//
// Options: --lang es|de (default: every course), --rpm N (requests a minute,
// default Google's limit of 200), --concurrency N (default 16, above what the pace needs),
// --replace FILE (texts, one a line, whose clips are bad: made again and uploaded over
// the old ones; then purge the URLs it prints from Cloudflare's cache).
// A real run needs --max-chars: it refuses a plan over that, and stops once the
// characters sent (retries included) reach it. Clips already in R2 or in the
// out folder are not made again, so a re-run costs nothing for work done.
// Env (.env.tts): GOOGLE_TTS_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DECK_LANGS, isDeckLang } from "../../web/src/deck/langs.ts";
import { Deck } from "../../web/src/deck/schema.ts";
import { ROOT, decode, deckDir, flagValue } from "../deck/lib.ts";
import { GOOGLE_RPM, chars, clipsFor, costLine, putClip, render, spokenTexts, type Clip } from "./lib.ts";

const OUT = join(ROOT, "scripts/.tts-out");

const args = process.argv.slice(2);
const real = args.includes("--run");
const langArg = flagValue(args, "lang");
if (langArg !== undefined && !isDeckLang(langArg)) throw new Error(`--lang: no course "${langArg}"`);
const langs = langArg === undefined ? DECK_LANGS : [langArg];
const rpm = Number(flagValue(args, "rpm") ?? GOOGLE_RPM);
if (!Number.isInteger(rpm) || rpm <= 0) throw new Error(`--rpm: not a positive whole number`);

const clips: Clip[] = [];
for (const lang of langs) {
  const parsed = decode(Deck(lang), JSON.parse(readFileSync(join(deckDir(lang), "deck.json"), "utf8")));
  if (!parsed.success) throw new Error(`decks/${lang}/deck.json does not decode: run bun scripts/deck/check.ts`);
  const mine = await clipsFor(spokenTexts(parsed.data, lang), lang);
  console.log(`${lang}: ${mine.length.toLocaleString("en")} clips, ${chars(mine).toLocaleString("en")} characters`);
  clips.push(...mine);
}
const local = (path: string) => join(OUT, path);
const replaceArg = flagValue(args, "replace");
const replaceTexts = new Set(replaceArg === undefined ? [] : readFileSync(replaceArg, "utf8").split("\n").filter(Boolean).map((t) => t.normalize("NFC")));
const replace = new Set(clips.filter((c) => replaceTexts.has(c.text)).map((c) => c.path));
const unknown = [...replaceTexts].filter((t) => !clips.some((c) => c.text === t));
if (unknown.length) throw new Error(`--replace: no clip says ${unknown.map((t) => JSON.stringify(t)).join(", ")}`);
// A clip to replace is made again, even if the out folder has the bad one.
for (const p of replace) rmSync(local(p), { force: true });
const made = clips.filter((c) => existsSync(local(c.path)));
console.log(`All: ${clips.length.toLocaleString("en")} clips. ${costLine(chars(clips))}`);
if (made.length) console.log(`In ${OUT} already (upload only, not made again): ${made.length.toLocaleString("en")} clips.`);
console.log(`Time: about ${Math.ceil((clips.length - made.length) / rpm).toLocaleString("en")} minutes at ${rpm} requests a minute.`);

if (!real) {
  console.log("Dry run: nothing sent. Add --run --max-chars N to render. Clips already in R2 are skipped then.");
  process.exit(0);
}

const maxCharsArg = flagValue(args, "max-chars");
if (maxCharsArg === undefined) throw new Error("--run needs --max-chars N");
const maxChars = Number(maxCharsArg);
if (!Number.isInteger(maxChars) || maxChars <= 0) throw new Error(`--max-chars: not a positive whole number: ${maxCharsArg}`);
const concurrency = Number(flagValue(args, "concurrency") ?? 16);

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (bun --env-file=.env.tts ...)`);
  return v;
};
const apiKey = need("GOOGLE_TTS_KEY");
const s3 = new Bun.S3Client({
  accessKeyId: need("R2_ACCESS_KEY_ID"),
  secretAccessKey: need("R2_SECRET_ACCESS_KEY"),
  bucket: need("R2_BUCKET"),
  endpoint: `https://${need("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
});

const inBucket = new Set<string>();
for (const lang of langs) {
  let token: string | undefined;
  do {
    const page = await s3.list({ prefix: `${lang}/`, continuationToken: token });
    for (const o of page.contents ?? []) inBucket.add(o.key);
    token = page.isTruncated ? page.nextContinuationToken : undefined;
  } while (token);
}
const todo = clips.filter((c) => !inBucket.has(c.path) || replace.has(c.path));
const toMake = todo.filter((c) => !existsSync(local(c.path)));
console.log(`In R2 already: ${(clips.length - todo.length).toLocaleString("en")}. To upload: ${todo.length.toLocaleString("en")}, of which to make: ${toMake.length.toLocaleString("en")}. ${costLine(chars(toMake))}`);
if (chars(toMake) > maxChars) {
  console.error(`Refused: ${chars(toMake).toLocaleString("en")} characters to make is over --max-chars ${maxChars.toLocaleString("en")}.`);
  process.exit(1);
}

const result = await render(
  todo,
  { apiKey, maxChars, concurrency, rpm, attempts: 6 },
  {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
    random: Math.random,
    local: {
      read: (path) => (existsSync(local(path)) ? new Uint8Array(readFileSync(local(path))) : null),
      write: (path, bytes) => {
        mkdirSync(dirname(local(path)), { recursive: true });
        writeFileSync(local(path), bytes);
      },
    },
    // A presigned PUT, so the object gets its Cache-Control: Bun's S3 write cannot set it.
    upload: (path, bytes) => putClip(s3.file(path).presign({ method: "PUT", expiresIn: 3600 }), bytes, fetch),
    log: (line) => console.log(line),
  },
);

console.log(`Done: ${result.done.toLocaleString("en")} uploaded, ${result.sent.toLocaleString("en")} characters sent.`);
if (result.failed.length) {
  console.log(`Failed (${result.failed.length}):`);
  for (const f of result.failed) console.log(`  ${f.path}  ${JSON.stringify(f.text)}  ${f.reason}`);
}
if (replace.size) {
  // Cloudflare's edge keeps a clip a year (s-maxage, lib.ts CLIP_HEADERS): until purged, it serves the bad one.
  console.log(`Replaced: purge these from Cloudflare now (audio.playperennial.com's zone → Caching → Configuration → Purge Cache → Custom Purge → URL):`);
  for (const p of replace) console.log(`  https://audio.playperennial.com/${p}`);
}
if (result.failed.length) process.exit(1);
