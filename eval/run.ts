// Run Perennial's real content prompts against any OpenAI-compatible endpoint and
// record outputs plus automatic checks. Human/frontier grading reads the
// saved JSON afterwards.
//
//   bun eval/run.ts --base http://localhost:8080/v1 --model <id> --out eval/out/<name>.json
//
// Frequency lists are read from $FREQ_DIR/freq_<lang>.txt (FrequencyWords format).

import { askJSON, type LLMConfig } from "../web/src/ai/llm";
import { frequencyBatchPrompt, minePrompt, validateLexemes, type GenLexeme } from "../web/src/ai/prompts";
import { formKey, parseFrequencyList, tokenize } from "../web/src/content/text";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = arg("base", "http://localhost:8080/v1")!;
const model = arg("model")!;
const out = arg("out")!;
const only = arg("langs")?.split(",");
const freqDir = process.env.FREQ_DIR ?? "eval/freq";

// mlx_lm.server defaults to a short max_tokens and Qwen3 thinks by default;
// neither is something the app sends, so inject them here.
const realFetch = globalThis.fetch;
globalThis.fetch = ((url: string, init?: RequestInit) => {
  if (init?.body && typeof init.body === "string") {
    const b = JSON.parse(init.body);
    b.max_tokens = 6000;
    b.temperature = 0.7;
    b.chat_template_kwargs = { enable_thinking: false };
    init = { ...init, body: JSON.stringify(b) };
  }
  return realFetch(url, init);
}) as typeof fetch;

const LANGS: Record<string, { name: string; tag: string; mine: { sentence: string; forms: string[] } }> = {
  es: { name: "Spanish", tag: "es-ES", mine: { sentence: "Ayer encontré un perro abandonado cerca del puerto.", forms: ["encontré", "abandonado", "puerto"] } },
  ja: { name: "Japanese", tag: "ja-JP", mine: { sentence: "昨日、駅の近くで財布を落としてしまった。", forms: ["財布", "落として", "駅"] } },
  fi: { name: "Finnish", tag: "fi-FI", mine: { sentence: "Unohdin sateenvarjoni bussiin eilen illalla.", forms: ["unohdin", "sateenvarjoni", "bussiin"] } },
  ar: { name: "Arabic", tag: "ar", mine: { sentence: "نسيت مفاتيحي في السيارة هذا الصباح.", forms: ["نسيت", "مفاتيحي", "السيارة"] } },
  th: { name: "Thai", tag: "th-TH", mine: { sentence: "เมื่อวานฉันลืมกระเป๋าเงินไว้ที่ร้านกาแฟ", forms: ["ลืม", "กระเป๋าเงิน", "ร้านกาแฟ"] } },
  de: { name: "German", tag: "de-DE", mine: { sentence: "Gestern habe ich meinen Regenschirm im Bus vergessen.", forms: ["regenschirm", "vergessen", "bus"] } },
};

// --deep: four levels per language (the MVP languages get graded in depth).
const deep = process.argv.includes("--deep");
const LEVELS = deep
  ? [
      { kind: "beginner", at: 0 },
      { kind: "early", at: 60 },
      { kind: "intermediate", at: 300 },
      { kind: "advanced", at: 1500 },
    ]
  : [
      { kind: "beginner", at: 0 },
      { kind: "intermediate", at: 300 },
    ];

interface CaseResult {
  lang: string;
  kind: string;
  ms: number;
  error?: string;
  words: GenLexeme[];
  checks: Record<string, number>;
}

function checks(words: GenLexeme[], tag: string, kind: CaseResult["kind"], known: Set<string>, mineSentence?: string) {
  const ex = words.flatMap((w) => w.examples.map((e) => ({ w, e })));
  const clozeOk = ex.filter(({ e }) => e.cloze && e.text.includes(e.cloze)).length;
  const lens = ex.map(({ e }) => tokenize(e.text, tag).filter((t) => t.word).length);
  // Share of words in each sentence that are known or the target itself.
  let inVocab = 0;
  let total = 0;
  for (const { w, e } of ex) {
    const target = new Set([...w.forms.map(formKey), formKey(w.lemma), formKey(e.cloze)]);
    for (const t of tokenize(e.text, tag)) {
      if (!t.word) continue;
      total++;
      const f = formKey(t.text);
      if (known.has(f) || target.has(f)) inVocab++;
    }
  }
  return {
    words: words.length,
    examples: ex.length,
    threePerWord: words.filter((w) => w.examples.length === 3).length / Math.max(1, words.length),
    clozeOk: clozeOk / Math.max(1, ex.length),
    avgLen: lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length),
    ...(kind !== "beginner" && kind !== "mine" ? { inVocab: inVocab / Math.max(1, total) } : {}),
    ...(mineSentence ? { keptOriginal: words.filter((w) => w.examples[0]?.text === mineSentence).length / Math.max(1, words.length) } : {}),
  };
}

const config: LLMConfig = { dialect: "openai", baseUrl: base, model, apiKey: "" };
const results: CaseResult[] = [];

for (const [code, L] of Object.entries(LANGS)) {
  if (only && !only.includes(code)) continue;
  const freq = parseFrequencyList(await Bun.file(`${freqDir}/freq_${code}.txt`).text());
  const forms = (from: number, n: number) => freq.slice(from, from + n).map((f) => f.form);
  const knownList = forms(0, 150);
  const known = new Set(knownList);

  const cases: { kind: CaseResult["kind"]; system: string; user: string; known: Set<string>; mine?: string }[] = [
    ...LEVELS.map(({ kind, at }) => {
      // The learner knows everything earlier in the list (capped like the app does).
      const k = forms(0, Math.min(at, 400));
      return { kind, ...frequencyBatchPrompt(L.name, "English", forms(at, 12), k, k), known: new Set(forms(0, at)) };
    }),
    {
      kind: "mine",
      ...minePrompt(L.name, "English", L.mine.forms.map((form) => ({ form, sentence: L.mine.sentence })), knownList),
      known,
      mine: L.mine.sentence,
    },
  ];
  for (const c of cases) {
    const t0 = performance.now();
    try {
      const words = await askJSON(c.system, c.user, validateLexemes, { config });
      results.push({ lang: code, kind: c.kind, ms: performance.now() - t0, words, checks: checks(words, L.tag, c.kind, c.known, c.mine) });
    } catch (e) {
      results.push({ lang: code, kind: c.kind, ms: performance.now() - t0, error: String(e), words: [], checks: {} });
    }
    const r = results[results.length - 1];
    console.log(`${model} ${code} ${c.kind}: ${(r.ms / 1000).toFixed(1)}s ${r.error ?? JSON.stringify(r.checks)}`);
  }
}

await Bun.write(out, JSON.stringify({ model, results }, null, 2));
