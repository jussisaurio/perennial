// The pairwise judge back-test (#1004, docs/judges.md "Which of two is better?").
// From web/:
//
//   bun e2e/pairwise.ts build <captures> <runs folder> <half|all> <runs per pair>
//   bun e2e/pairwise.ts score <runs folder>
//
// `build` makes one folder per judge run from docs/judges/pairs.json and the PNGs that
// docs/judges/capture.spec.ts.txt wrote into <captures>/<commit>/<case>/. Each folder has a
// random name and holds A-<n>.png, B-<n>.png, steps.txt and rules.md, and A-<n>-zoom.png and
// B-<n>-zoom.png where the changed part is small; the order of the two versions flips from run to run. key.json in the runs folder says which side is which.
// Then start one fresh judge per folder with docs/judges/pairwise-prompt.md; each writes
// verdict.txt in its folder. `score` reads the verdicts and prints the numbers.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { type Box, enlarge, pixelDiff } from "./pixelDiff";

const DOCS = fileURLToPath(new URL("../../docs/judges", import.meta.url));

type Side = { dir: string; frames: string[] };
type Pair = {
  id: string;
  issue: number;
  half: "tuning" | "heldout" | "control";
  /** real: the owner's fix (after is better). same: one picture twice. planted: after is a regression we made. */
  kind: "real" | "same" | "planted";
  before: Side;
  after: Side;
};
/** Which side the owner would pick. */
const wanted = (p: Pair) => (p.kind === "real" ? "after" : p.kind === "planted" ? "before" : "same");

type Run = { folder: string; pair: string; afterIs: "A" | "B" };

const pairs = (): Pair[] => JSON.parse(readFileSync(`${DOCS}/pairs.json`, "utf8")) as Pair[];

/** Each frame's line from the capture's steps.txt. A planted frame's line names the plant: the judge must not see it. */
function stepOf(dir: string, frame: string): string {
  const line = readFileSync(`${dir}/steps.txt`, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${frame}: `));
  if (line === undefined) throw new Error(`no step for ${frame} in ${dir}/steps.txt`);
  return line.slice(frame.length + 2).replace(/; planted: .*$/, "");
}

/** A box in the middle of the picture: a third of its width, a sixth of its height. */
function middle(file: string): Box {
  const { width, height } = PNG.sync.read(readFileSync(file));
  return { x: Math.round(width / 3), y: Math.round(height / 3), w: Math.round(width / 3), h: Math.round(height / 6) };
}

function build(captures: string, out: string, half: string, runs: number) {
  mkdirSync(out, { recursive: true });
  const keyFile = `${out}/key.json`;
  const key: Run[] = existsSync(keyFile) ? (JSON.parse(readFileSync(keyFile, "utf8")) as Run[]) : [];
  const made: string[] = [];
  for (const p of pairs().filter((p) => half === "all" || p.half === half)) {
    const sides = { before: { ...p.before, dir: `${captures}/${p.before.dir}` }, after: { ...p.after, dir: `${captures}/${p.after.dir}` } };
    if (sides.before.frames.length !== sides.after.frames.length) throw new Error(`${p.id}: the two sides have different frame counts`);
    // The part of each moment to enlarge: where the pixels differ. Identical pictures get their
    // middle, so a missing zoom does not give the answer away.
    const boxes = sides.before.frames.map((f, i) => (p.kind === "same" ? middle(`${sides.before.dir}/${f}`) : pixelDiff(`${sides.before.dir}/${f}`, `${sides.after.dir}/${sides.after.frames[i]}`).box));
    // A real or planted pair whose pixels are all the same tests nothing.
    if (p.kind !== "same" && boxes.every((b) => b === null)) throw new Error(`${p.id}: before and after are the same pixels`);
    for (let r = 0; r < runs; r++) {
      // Alternate over all runs, not per pair, so one run per pair still shows "after" as A half the time.
      const afterIs = key.length % 2 === 0 ? "A" : "B";
      const folder = randomBytes(4).toString("hex");
      const dir = `${out}/${folder}`;
      mkdirSync(dir);
      const steps: string[] = [];
      for (const [letter, side] of afterIs === "A" ? ([["A", sides.after], ["B", sides.before]] as const) : ([["A", sides.before], ["B", sides.after]] as const))
        side.frames.forEach((f, i) => {
          const name = `${letter}-${i + 1}`;
          copyFileSync(`${side.dir}/${f}`, `${dir}/${name}.png`);
          steps.push(`${name}.png: ${stepOf(side.dir, f)}`);
          const box = boxes[i];
          const scale = box === null ? 0 : enlarge(`${side.dir}/${f}`, box, `${dir}/${name}-zoom.png`);
          if (box !== null && scale > 0) steps.push(`${name}-zoom.png: the part of ${name}.png at x ${box.x}, y ${box.y} (${box.w} x ${box.h} px, with a margin), ${scale} times bigger`);
        });
      writeFileSync(`${dir}/steps.txt`, steps.join("\n") + "\n");
      copyFileSync(`${DOCS}/rules.md`, `${dir}/rules.md`);
      key.push({ folder, pair: p.id, afterIs });
      made.push(dir);
    }
  }
  writeFileSync(keyFile, JSON.stringify(key, null, 1));
  console.log(made.join("\n"));
}

/** A judge's verdict.txt, as which version it picked: "A | reason", "B | reason" or "same | reason". */
function verdict(dir: string): { pick: "A" | "B" | "same"; why: string } | null {
  if (!existsSync(`${dir}/verdict.txt`)) return null;
  const line = readFileSync(`${dir}/verdict.txt`, "utf8").trim().split("\n")[0] ?? "";
  const m = /^`?(A|B|same)\s*\|\s*(.*?)`?$/i.exec(line);
  if (m === null) throw new Error(`${dir}/verdict.txt: cannot read "${line}"`);
  const pick = m[1].toLowerCase() === "same" ? "same" : (m[1].toUpperCase() as "A" | "B");
  return { pick, why: m[2] };
}

function score(out: string) {
  const key = JSON.parse(readFileSync(`${out}/key.json`, "utf8")) as Run[];
  const byId = new Map(pairs().map((p) => [p.id, p]));
  type Row = { pair: Pair; run: Run; got: "after" | "before" | "same"; why: string };
  const rows: Row[] = [];
  for (const run of key) {
    const v = verdict(`${out}/${run.folder}`);
    const pair = byId.get(run.pair);
    if (pair === undefined) throw new Error(`key.json names ${run.pair}, which pairs.json does not have`);
    if (v === null) continue;
    const got = v.pick === "same" ? "same" : v.pick === run.afterIs ? "after" : "before";
    rows.push({ pair, run, got, why: v.why });
  }
  const share = (rs: Row[]) => (rs.length === 0 ? "-" : `${rs.filter((r) => r.got === wanted(r.pair)).length} of ${rs.length}`);
  const groups: [string, (r: Row) => boolean][] = [
    ["real, tuning half: picked the owner's version", (r) => r.pair.kind === "real" && r.pair.half === "tuning"],
    ["real, held-out half: picked the owner's version", (r) => r.pair.kind === "real" && r.pair.half === "heldout"],
    ["identical pictures: said same", (r) => r.pair.kind === "same"],
    ["planted regressions: picked the version without it", (r) => r.pair.kind === "planted"],
  ];
  for (const [name, f] of groups) console.log(`${name}: ${share(rows.filter(f))}`);
  // Run-to-run: the pairs whose runs all gave the same answer, of the pairs with 2 or more runs.
  const runsOf = new Map<string, Row[]>();
  for (const r of rows) runsOf.set(r.pair.id, [...(runsOf.get(r.pair.id) ?? []), r]);
  const multi = [...runsOf.values()].filter((rs) => rs.length >= 2);
  console.log(`pairs where every run agreed: ${multi.filter((rs) => rs.every((r) => r.got === rs[0].got)).length} of ${multi.length}`);
  console.log(`runs that picked A: ${rows.filter((r) => r.run.afterIs === "A" ? r.got === "after" : r.got === "before").length} of ${rows.filter((r) => r.got !== "same").length} that picked a side`);
  console.log(`\npair | kind | half | wanted | answers`);
  for (const [id, rs] of runsOf) console.log(`${id} | ${rs[0].pair.kind} | ${rs[0].pair.half} | ${wanted(rs[0].pair)} | ${rs.map((r) => r.got).join(", ")}`);
  writeFileSync(`${out}/scored.json`, JSON.stringify(rows.map((r) => ({ pair: r.pair.id, kind: r.pair.kind, half: r.pair.half, wanted: wanted(r.pair), got: r.got, afterIs: r.run.afterIs, why: r.why })), null, 1));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "build" && args.length === 4) build(args[0], args[1], args[2], Number(args[3]));
else if (cmd === "score" && args.length === 1) score(args[0]);
else throw new Error("usage: bun e2e/pairwise.ts build <captures> <runs folder> <half|all> <runs per pair> | score <runs folder>");
