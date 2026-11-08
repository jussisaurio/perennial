// Makes bad lone-word clips again (#776), under their old names, in the same voice. Each take is
// checked by Gemini, twice; the first take both votes pass is uploaded over the old clip; it prints
// the URLs to purge from Cloudflare's cache. Takes switch between the word's IPA pinned (ipa.ts) and plain text.
// Run by hand, from the owner's machine; never in CI.
//
// The words come from the owner, who heard them. The checker is not good at finding bad clips:
// most of the prod clips it failed sounded fine to the owner. As a gate on new takes it worked:
// the owner heard the 63 clips it passed 2 of 2 and found them fine.
//
//   bun scripts/tts/fix.ts --lang de --words FILE           dry run: the words, their clips and IPAs
//   bun --env-file=.env.tts --env-file=.env.gemini scripts/tts/fix.ts --lang de --words FILE --run --max-usd 5
//
// FILE has one word a line, each a clip already in R2. Options: --takes N (default 8).
// Results go to scripts/.tts-out/fix-<lang>.jsonl; a re-run skips the words in it. A word whose
// takes all fail keeps its old clip, and is listed there and at the end for the owner to hear.
// Env: as render.ts, and GEMINI_API_KEY.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeckLang, type DeckLang } from "../../web/src/deck/langs.ts";
import { language } from "../../web/src/content/languages.ts";
import { ROOT, flagValue } from "../deck/lib.ts";
import { ipasFor, parseWikipron, WIKIPRON_FILE, wikipronUrl } from "./ipa.ts";
import { AUDIO_BASE, GOOGLE_RPM, Refused, Retry, clipsFor, pace, purgeList, putClip, synthesize, type Clip } from "./lib.ts";

const OUT = join(ROOT, "scripts/.tts-out");
const WORKERS = 8;

const args = process.argv.slice(2);
const lang = flagValue(args, "lang");
if (lang === undefined || !isDeckLang(lang)) throw new Error("--lang es|de is needed");
const wordsFile = flagValue(args, "words");
if (wordsFile === undefined) throw new Error("--words FILE is needed");
const takes = Number(flagValue(args, "takes") ?? 8);
if (!Number.isInteger(takes) || takes <= 0) throw new Error("--takes: not a positive whole number");

const log = join(OUT, `fix-${lang}.jsonl`);
const done = new Set(existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { text: string }).text) : []);
const words = [...new Set(readFileSync(wordsFile, "utf8").split("\n").map((w) => w.trim().normalize("NFC")).filter(Boolean))];
const multi = words.filter((w) => /\s/u.test(w));
if (multi.length) throw new Error(`lone words only (one IPA pins the whole text): ${multi.map((w) => JSON.stringify(w)).join(", ")}`);
const clips = await clipsFor(words.filter((w) => !done.has(w)), lang);

const dictFile = join(OUT, "wikipron", WIKIPRON_FILE[lang]);
if (!existsSync(dictFile)) {
  const res = await fetch(wikipronUrl(lang));
  if (!res.ok) throw new Error(`WikiPron: HTTP ${res.status}`);
  mkdirSync(join(OUT, "wikipron"), { recursive: true });
  writeFileSync(dictFile, await res.text());
}
const dict = parseWikipron(readFileSync(dictFile, "utf8"));

console.log(`${lang}: ${words.length} words, ${words.length - clips.length} done before (${log}), ${clips.length} to fix.`);
if (!args.includes("--run")) {
  for (const c of clips) console.log(`  ${c.path}  ${c.text}  ${ipasFor(lang, c.text, dict).join(" ") || "(no IPA: plain takes only)"}`);
  console.log("Dry run: nothing sent. Add --run --max-usd N.");
  process.exit(0);
}
const maxUsd = Number(flagValue(args, "max-usd"));
if (!(maxUsd > 0)) throw new Error("--run needs --max-usd N: Gemini spend stops there");

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (bun --env-file=.env.tts --env-file=.env.gemini ...)`);
  return v;
};
const ttsKey = need("GOOGLE_TTS_KEY");
const geminiKey = need("GEMINI_API_KEY");
const s3 = new Bun.S3Client({
  accessKeyId: need("R2_ACCESS_KEY_ID"),
  secretAccessKey: need("R2_SECRET_ACCESS_KEY"),
  bucket: need("R2_BUCKET"),
  endpoint: `https://${need("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
});
// Only clips already in R2 are replaced: this tool never adds a name.
const missing = (await Promise.all(clips.map(async (c) => ((await s3.file(c.path).exists()) ? null : c)))).filter((c) => c !== null);
if (missing.length) throw new Error(`no clip in R2 for ${missing.map((c) => `${JSON.stringify(c.text)} (${c.path})`).join(", ")}`);

// The model and thinking level the #776 checks used; the owner heard its 2/2 passes and found them fine.
const MODEL = "gemini-3.8-flash";
/** USD per 1M tokens, input (audio) and output (thinking included), as estimated for #776's scan. */
const USD_IN = 0.75;
const USD_OUT = 3.75;
let usd = 0;
const HINTS: Record<DeckLang, string> = {
  de: "vowel length (Name, Tod, Plan have long vowels), the German R (uvular or vocalized, never English [ɹ]), initial st/sp/sch said [ʃt]/[ʃp]/[ʃ], final devoicing, a hard g in loanwords (Agent [aˈɡɛnt]), German stress in loanwords",
  es: "pure vowels (no English diphthongs), tapped or trilled r, no aspiration of p/t/k, Spanish stress, j/g as [x], no English [ɪ] [æ] [ʌ] [ɹ]",
};

/** One vote: would a native speaker say the word this way? */
const judge = async (bytes: Uint8Array, c: Clip): Promise<{ native: boolean; problem: string }> => {
  const name = language(lang).name;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: "audio/mp3", data: Buffer.from(bytes).toString("base64") } },
              {
                text: `This clip is from a ${name} course for learners. It should be the ${name} text "${c.text}", said the way a native ${name} speaker says it. Many ${name} words look like English words, and the voice sometimes says them the English way. Be a strict ${name} phonetics teacher: transcribe exactly what you hear in narrow IPA (not what the spelling suggests), then decide whether a native ${name} speaker would say it this way. Check: ${HINTS[lang]}. Also fail it if it is silent, cut off, or a different word. If it fails, name the problem in a few words.`,
              },
            ],
          },
        ],
        generationConfig: {
          thinkingConfig: { thinkingLevel: "low" },
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: { ipa: { type: "STRING" }, native: { type: "BOOLEAN" }, problem: { type: "STRING" } }, required: ["ipa", "native", "problem"] },
        },
      }),
    });
    // Throttled or a server error: these pass. Anything else (402 when the credits run out) stops the run.
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await Bun.sleep(2000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini: HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[]; usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; thoughtsTokenCount?: number } };
    const u = j.usageMetadata;
    // `?? 0`: Gemini leaves the field out when it did not think.
    usd += (u.promptTokenCount * USD_IN + (u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0)) * USD_OUT) / 1e6;
    return JSON.parse(j.candidates[0]!.content.parts[0]!.text) as { native: boolean; problem: string };
  }
};

const slot = pace(GOOGLE_RPM, Date.now, Bun.sleep);
/** One take, or why there is none. Throttles and server errors are asked again; a 400 is an IPA Chirp refuses. */
async function take(c: Clip, ipa: string | undefined): Promise<Uint8Array<ArrayBuffer> | string> {
  for (let attempt = 1; ; attempt++) {
    await slot();
    try {
      return await synthesize(c, ttsKey, fetch, ipa);
    } catch (e) {
      if (e instanceof Refused) return "refused";
      if (!(e instanceof Retry)) throw e;
      if (attempt === 4) return e.message;
      await Bun.sleep(2000 * attempt);
    }
  }
}

const fixed: string[] = [];
const failing: string[] = [];
let stop: unknown = null;
const queue = [...clips];
const worker = async () => {
  for (let c = queue.shift(); c && stop === null && usd < maxUsd; c = queue.shift()) {
    const ipas = ipasFor(lang, c.text, dict);
    const tried: string[] = [];
    let kept: { take: number; ipa: string | null } | null = null;
    for (let t = 0; t < takes && !kept; t++) {
      // Even takes pin an IPA, in turn, when the word has any; odd takes are plain text.
      const ipa = ipas.length && t % 2 === 0 ? ipas[(t / 2) % ipas.length] : undefined;
      const bytes = await take(c, ipa);
      if (typeof bytes === "string") {
        tried.push(`${ipa ?? "plain"}: ${bytes}`);
        continue;
      }
      const votes = await Promise.all([judge(bytes, c), judge(bytes, c)]);
      if (votes.every((v) => v.native)) {
        await putClip(s3.file(c.path).presign({ method: "PUT", expiresIn: 3600 }), bytes, fetch);
        kept = { take: t + 1, ipa: ipa ?? null };
      } else tried.push(`${ipa ?? "plain"}: ${votes.map((v) => (v.native ? "ok" : v.problem)).join(" / ")}`);
    }
    (kept ? fixed : failing).push(c.path);
    appendFileSync(log, JSON.stringify({ text: c.text, path: c.path, kept, tried }) + "\n");
    console.log(`${c.text}: ${kept ? `kept take ${kept.take} (${kept.ipa ?? "plain"})` : `still fails after ${takes} takes`}`);
  }
};
// A word cut off by an error is not logged, so a re-run makes it again.
await Promise.all(Array.from({ length: WORKERS }, () => worker().catch((e: unknown) => void (stop ??= e))));
// Listed even when the run stopped early: these clips are already uploaded.
if (fixed.length) console.log(purgeList(fixed));
console.log(`Fixed ${fixed.length} (uploaded), still failing ${failing.length}, not tried ${queue.length}. Gemini: about $${usd.toFixed(2)}.`);
if (failing.length) console.log(`Still failing, to hear:\n${failing.map((p) => `  ${AUDIO_BASE}/${p}`).join("\n")}`);
if (stop !== null) throw stop;
if (queue.length) console.log(`Stopped at --max-usd ${maxUsd}: run again to go on.`);
