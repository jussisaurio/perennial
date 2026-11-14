// The story judges' back-test (#976, docs/judges.md, "Story"): builds the blind judge folders and
// scores the answers against the verdicts in docs/judges/story/cases.json.
//
//   bun scripts/story-judge.ts folders <design> <half> <run> <out dir>   one folder per batch of a run
//   bun scripts/story-judge.ts parts <out dir>                           the story, one file per part, for the memory writers
//   bun scripts/story-judge.ts ingest <out dir> <folder> <reply file>    adds a judge's reply to results.json
//   bun scripts/story-judge.ts score                                     the table, from results.json
//   bun scripts/story-judge.ts rules                                     design C, which needs no agent
//   bun scripts/story-judge.ts lint <thought|line> "<English text>"      design C on one English draft (docs/story-loop.md)
//
// A judge is a fresh Opus agent. It gets one folder and reads its items one file at a time, in story
// order, so it never sees a later part of the story before it answers an earlier item. Items are
// numbered per folder, so an id like "C-joke-d3" never tells the judge what the item tests.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../docs/judges/story");

type Half = "tuning" | "heldout";
type Case = {
  id: string;
  half: Half;
  source: "owner" | "rule" | "reader" | "control";
  kind?: "same" | "wordy" | "jokey" | "explains" | "hard";
  evidence?: string;
  /** The story part the line comes right after. */
  at: string;
  where: string;
  /** The owner's (or the rule's) side; for a "same" control, both sides are one text. */
  better: string;
  worse: string;
};
// a1: the judge in docs/story-loop.md before #976. a2: the owner's written rules. b: a2's questions,
// but the judge remembers each earlier part only as one line (memory.json), like a learner who reads
// a note every few days.
const DESIGNS = ["a1", "a2", "b"] as const;
type Design = (typeof DESIGNS)[number];
const isDesign = (d: string | undefined): d is Design => DESIGNS.some((x) => x === d);
const isHalf = (h: string | undefined): h is Half => h === "tuning" || h === "heldout";
type Answer = { design: Design; half: Half; run: number; item: string; pick: "1" | "2" | "same"; said: string };

const cases = JSON.parse(readFileSync(join(DIR, "cases.json"), "utf8")) as Case[];

/** The story's parts in the order a learner finds them, each with its text. */
const PARTS = readFileSync(join(DIR, "story-en.md"), "utf8")
  .split("\n## ")
  .slice(1)
  .map((s) => {
    const [id = "", ...rest] = s.split("\n");
    return { id: id.trim(), text: rest.join("\n").trim() };
  });
const order = (id: string) => {
  const i = PARTS.findIndex((p) => p.id === id);
  if (i < 0) throw new Error(`cases.json: no story part "${id}" in story-en.md`);
  return i;
};
/** That part's "Thoughts after it" may hold the judged line, so it is cut. */
const cutThoughts = (text: string) => text.replace(/\n*Thoughts after it:[^\n]*/, "");

/** The story up to and including `at`, in full. */
function storySoFar(at: string): string {
  return PARTS.slice(0, order(at) + 1)
    .map((p) => `[${p.id}]\n${p.id === at ? cutThoughts(p.text) : p.text}`)
    .join("\n\n");
}
/** What a forgetful reader has: one remembered line per earlier part, and the last part in full. */
function remembered(at: string, run: number): string {
  const memories = JSON.parse(readFileSync(join(DIR, "memory.json"), "utf8")) as Record<string, string>[];
  const memory = memories[run - 1];
  if (!memory) throw new Error(`memory.json has no memory for run ${run}`);
  const before = PARTS.slice(0, order(at)).map((p) => {
    const line = memory[p.id];
    if (!line) throw new Error(`memory.json run ${run}: no line for ${p.id}`);
    return `- ${line}`;
  });
  const last = PARTS[order(at)]!;
  return `What you remember of the earlier parts, one line each (you read them over many weeks):\n${before.join("\n")}\n\nThe part you read today:\n${cutThoughts(last.text)}`;
}

// A seeded shuffle, so one design, half and run always gives the same folders and the same key.
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
/** Which side is version 1, for each item of a run. */
function key(design: Design, half: Half, run: number): Map<string, "better" | "worse"> {
  const r = rng(`${design}/${half}/${run}`);
  return new Map(cases.filter((c) => c.half === half).map((c) => [c.id, r() < 0.5 ? "better" : "worse"]));
}
/** The run's items in batches of at most 9, each in story order. Items that share a version go to
 * different batches, so a judge never sees one text twice and guesses that it is the kept one. */
function batches(design: Design, half: Half, run: number): Case[][] {
  const r = rng(`batch/${design}/${half}/${run}`);
  const mine = cases.filter((c) => c.half === half).map((c) => ({ c, k: r() }));
  mine.sort((a, b) => a.k - b.k);
  const out: Case[][] = Array.from({ length: Math.ceil(mine.length / 9) }, () => []);
  const shares = (b: Case[], c: Case) => b.some((x) => [x.better, x.worse].some((t) => t === c.better || t === c.worse));
  for (const { c } of mine) {
    const open = out.filter((b) => b.length < 9).sort((x, y) => x.length - y.length);
    const to = open.find((b) => !shares(b, c)) ?? open[0];
    if (!to) throw new Error("no batch has room");
    to.push(c);
  }
  return out.map((b) => b.sort((x, y) => order(x.at) - order(y.at)));
}

const FRAME = `A language learner meets this story a few minutes a day, in a small garden inside a language app. Notes hang in the shed, diary pages lie on a stone on a hill, and a short thought shows when the learner taps a thing. The story is quiet and dry, and it never explains itself.`;

// The author's own written rules (CLAUDE.md; #639; #711; #884), as a checklist. They live in the
// loop's Judge prompt, so a rerun tests what the loop uses. (#976 ran them with "Simple English"
// where the loop now says "Simple words", since its judges read es and de.)
const RULES = /You stand in for the story's author[\s\S]*?Do not try to guess which version is new\./.exec(
  readFileSync(join(import.meta.dir, "../docs/story-loop.md"), "utf8"),
)?.[0];
if (!RULES) throw new Error("docs/story-loop.md, Judge: the rules block is missing");

const ASK: Record<Design, string> = {
  // docs/story-loop.md, "Judge", as it was before #976.
  a1: `First, for each version on its own, say in one sentence what happened.

Then for each question, answer "1", "2" or "same", and one line why:
1. Which makes you want to come back tomorrow?
2. In which is it clearer what happened, from the words you can read?
3. Which fits the voice better: dry, quiet, never sentimental, never explaining?
4. Is every line worth reading by itself, or does one feel like filler?

Then give your overall pick: "1", "2" or "same". Do not try to guess which version is new.`,
  a2: RULES,
  b: RULES,
};

function itemFile(design: Design, run: number, n: string, c: Case, side: Map<string, "better" | "worse">): string {
  const one = side.get(c.id) === "better" ? c.better : c.worse;
  const two = side.get(c.id) === "better" ? c.worse : c.better;
  const quote = (t: string) => t.split("\n").map((l) => `> ${l}`).join("\n");
  const story = design === "b" ? remembered(c.at, run) : `The story so far, in the order the learner found it:\n\n${storySoFar(c.at)}`;
  return `# Item ${n}

Where the line is: ${c.where}

${story}

Version 1:
${quote(one)}

Version 2:
${quote(two)}
`;
}

function brief(design: Design, files: string[], folder: string): string {
  return `You are a judge in a back-test of story judges (issue #976 in this project). You compare two versions of one part of a story, for several items.

${FRAME}

Folder: ${folder}
It holds ${files.length} item files: ${files.join(", ")}. Read them one at a time, in that order, with the Read tool. Answer an item in full before you read the next file: a later file shows more of the story, and you must judge each item knowing only what its file gives. Use nothing else: do not read other files, run commands, search, or start agents.

For each item:
${ASK[design]}

Reply with only this, one block per item, in the order you read them:

item <number>
1: <one sentence>
2: <one sentence>
why: <one or two lines>
pick: <1|2|same>`;
}

function folders(design: Design, half: Half, run: number, out: string) {
  const side = key(design, half, run);
  const keys: Record<string, string> = {};
  batches(design, half, run).forEach((b, i) => {
    const name = `${design}-${half}-r${run}-b${i + 1}`;
    const folder = join(out, name);
    mkdirSync(folder, { recursive: true });
    const files = b.map((c, j) => {
      const n = String(j + 1).padStart(2, "0");
      writeFileSync(join(folder, `${n}.md`), itemFile(design, run, n, c, side));
      keys[`${name}/${n}`] = c.id;
      return `${n}.md`;
    });
    // The brief goes to the agent as its prompt; it stays beside the items as a record.
    writeFileSync(join(out, `${name}.brief.txt`), brief(design, files, folder));
    console.log(folder);
  });
  writeFileSync(join(out, `${design}-${half}-r${run}.keys.json`), JSON.stringify(keys, null, 2));
}

/** The memory writers read the story one part at a time, like the judges, and keep one line per part. */
function parts(out: string) {
  mkdirSync(out, { recursive: true });
  PARTS.forEach((p, i) => writeFileSync(join(out, `${String(i + 1).padStart(2, "0")}-${p.id}.md`), `${p.text}\n`));
  console.log(out);
}

/** Reads one judge's reply ("item 03 ... pick: 2") into results.json, by the run's keys file. */
function ingest(out: string, folder: string, reply: string) {
  const [, design, half, run] = /^(\w+)-(\w+)-r(\d+)-b\d+$/.exec(folder) ?? [];
  if (!isDesign(design) || !isHalf(half)) throw new Error(`not a judge folder name: ${folder}`);
  const keys = JSON.parse(readFileSync(join(out, `${design}-${half}-r${run}.keys.json`), "utf8")) as Record<string, string>;
  const blocks = readFileSync(reply, "utf8").split(/^item /m).slice(1);
  const want = Object.keys(keys).filter((k) => k.startsWith(`${folder}/`));
  if (blocks.length !== want.length) throw new Error(`${folder}: ${blocks.length} answers for ${want.length} items`);
  const path = join(DIR, "results.json");
  const answers = JSON.parse(readFileSync(path, "utf8")) as Answer[];
  for (const b of blocks) {
    const n = /^\s*(\d+)/.exec(b)?.[1]?.padStart(2, "0");
    const pick = /^pick:\s*(1|2|same)\b/m.exec(b)?.[1];
    const item = keys[`${folder}/${n}`];
    if (!item || (pick !== "1" && pick !== "2" && pick !== "same")) throw new Error(`${folder}: can't read the answer "${b.slice(0, 80)}"`);
    if (answers.some((a) => a.design === design && a.half === half && a.run === Number(run) && a.item === item)) throw new Error(`${folder}: ${item} is already in results.json`);
    answers.push({ design, half, run: Number(run), item, pick, said: b.replace(/^pick:.*$/m, "").trim().split("\n").slice(1).join(" ") });
  }
  writeFileSync(path, `${JSON.stringify(answers, null, 2)}\n`);
}

const of = (n: number, d: number) => (d === 0 ? "-" : `${n}/${d}`);

function score() {
  const answers = JSON.parse(readFileSync(join(DIR, "results.json"), "utf8")) as Answer[];
  const byId = new Map(cases.map((c) => [c.id, c]));
  const get = (id: string) => {
    const c = byId.get(id);
    if (!c) throw new Error(`results.json: no case "${id}"`);
    return c;
  };
  /** The pick, as the side it chose. */
  const chose = (a: Answer) => (a.pick === "same" ? "same" : key(a.design, a.half, a.run).get(a.item) === (a.pick === "1" ? "better" : "worse") ? "better" : "worse");
  console.log("design half     verdicts  owner  same-ctl  worse-ctl  steady");
  for (const design of DESIGNS) {
    for (const half of ["tuning", "heldout"] as const) {
      const mine = answers.filter((a) => a.design === design && a.half === half);
      if (mine.length === 0) continue;
      const pick = (f: (c: Case) => boolean) => mine.filter((a) => f(get(a.item)));
      const verdicts = pick((c) => c.source !== "control");
      const owner = pick((c) => c.source === "owner");
      const same = pick((c) => c.kind === "same");
      const worse = pick((c) => c.source === "control" && c.kind !== "same");
      const items = [...new Set(mine.map((a) => a.item))];
      const steady = items.filter((id) => new Set(mine.filter((a) => a.item === id).map(chose)).size === 1).length;
      const right = (xs: Answer[], want: string) => xs.filter((a) => chose(a) === want).length;
      console.log(
        `${design.padEnd(6)} ${half.padEnd(8)} ${of(right(verdicts, "better"), verdicts.length).padEnd(9)} ${of(right(owner, "better"), owner.length).padEnd(6)} ${of(right(same, "same"), same.length).padEnd(9)} ${of(right(worse, "better"), worse.length).padEnd(10)} ${of(steady, items.length)}`,
      );
      for (const a of mine.filter((a) => (get(a.item).kind === "same" ? chose(a) !== "same" : chose(a) !== "better"))) {
        console.log(`    miss ${a.item} (run ${a.run}): chose ${chose(a)}. ${a.said}`);
      }
    }
  }
}

// Design C: checks that need no taste. A version breaks a rule when a thought is longer than 8 words
// (#936: "keep the English to about 6-8 plain words"), a sentence is longer than 14 words, or more than
// 1 in 8 of its words are hard: 3 or more syllables and 8 or more letters ("nobody" and "anymore" are
// common, "nomenclature" is not; tuned on the tuning half). C picks a side only when exactly one version
// breaks a rule.
// `match` gives null when nothing matches: that is zero, not an error.
const syllables = (w: string) => (w.toLowerCase().replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length;
const wordsOf = (s: string) => s.match(/[A-Za-z']+/g) ?? [];
function breaks(isThought: boolean, text: string): string[] {
  const words = wordsOf(text);
  const sentences = text.split(/[.?!:\n]+/).map((s) => wordsOf(s).length);
  const hard = words.filter((w) => w.length >= 8 && syllables(w) >= 3);
  const out: string[] = [];
  // A version that adds a thought names it in a frame ('A new line on the hills: "…"'): count the thought,
  // not the frame. A version with no quote is the thought itself.
  const thought = wordsOf(/"([^"]+)"/.exec(text)?.[1] ?? text);
  if (isThought && thought.length > 8) out.push(`${thought.length} words in a thought`);
  if (Math.max(...sentences) > 14) out.push(`a sentence of ${Math.max(...sentences)} words`);
  if (hard.length * 8 > words.length) out.push(`hard words: ${hard.join(", ")}`);
  return out;
}
function rules() {
  const rows = cases.map((c) => {
    const isThought = c.where.startsWith("A thought");
    const b = breaks(isThought, c.better);
    const w = breaks(isThought, c.worse);
    const chose = c.better === c.worse || b.length > 0 === w.length > 0 ? "same" : w.length > 0 ? "better" : "worse";
    return { c, chose, why: [...b.map((x) => `better: ${x}`), ...w.map((x) => `worse: ${x}`)].join("; ") };
  });
  for (const r of rows) console.log(`${r.c.id.padEnd(18)} ${r.chose.padEnd(6)} ${r.why}`);
  for (const half of ["tuning", "heldout"] as const) {
    const h = rows.filter((r) => r.c.half === half);
    const v = h.filter((r) => r.c.source !== "control");
    const worse = h.filter((r) => r.c.source === "control" && r.c.kind !== "same");
    console.log(
      `\nC ${half}: verdicts ${of(v.filter((r) => r.chose === "better").length, v.length)} agreed, ${v.filter((r) => r.chose === "worse").length} against; same-controls ${of(h.filter((r) => r.c.kind === "same" && r.chose === "same").length, h.filter((r) => r.c.kind === "same").length)}; made-worse ${of(worse.filter((r) => r.chose === "better").length, worse.length)} caught`,
    );
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "folders") {
  const [design, half, run, out] = args;
  if (!isDesign(design) || !isHalf(half) || !run || !out) throw new Error("usage: folders <a1|a2|b> <tuning|heldout> <run> <out dir>");
  folders(design, half, Number(run), out);
} else if (cmd === "parts" && args[0]) parts(args[0]);
else if (cmd === "ingest" && args.length === 3) ingest(args[0]!, args[1]!, args[2]!);
else if (cmd === "score") score();
else if (cmd === "rules") rules();
else if (cmd === "lint" && (args[0] === "thought" || args[0] === "line") && args[1]) {
  const found = breaks(args[0] === "thought", args[1]);
  console.log(found.length === 0 ? "ok" : found.join("\n"));
  if (found.length > 0) process.exit(1);
} else throw new Error("usage: bun scripts/story-judge.ts folders|parts|ingest|score|rules|lint");
