// Mutation testing: do the tests fail when the code is wrong? `bun run mutate` at the repo root.
//
//   bun run mutate web/src/garden/walker.ts scripts/alarm/lib.ts   whole files
//   bun run mutate --changed                                        the lines this branch changed
//
// It makes small wrong versions of the code (mutants): a comparison flipped, + for -, && for ||, a
// condition made always true or always false, a statement or return removed, a constant changed, an
// array element dropped, Math.min for Math.max. For each mutant it runs the test files that import
// the file, directly or through other files. A mutant that every test passes "survives": it shows a
// missing test, or code nobody needs. Each survivor prints as file:line with the change, then a score
// per file: the share of mutants that a test caught.
//
// `--changed` takes the lines changed since the branch left origin/main, with uncommitted edits and
// new files. StrykerJS was tried first (#1041): it compiles all mutants into the file at once, and that
// made world.ts's tests 30 times slower. Here each mutant is its own copy of the file, which
// mutant-loader.ts serves to `bun test`: the tests run at full speed and the files on disk never change.

import { parse } from "@babel/parser";
import type { Node } from "@babel/types";
import { mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..");
const LOADER = join(import.meta.dir, "mutant-loader.ts");
// The workspaces whose unit tests run with plain `bun test`. server/ is left out: its tests need Postgres.
const WORKSPACES = ["web", "scripts"];

type Mutant = { start: number; end: number; line: number; endLine: number; replacement: string };

// --- Making the mutants ---

/** Comparisons flip to their opposite. */
const FLIP: Record<string, string> = { "<": ">=", "<=": ">", ">": "<=", ">=": "<", "===": "!==", "!==": "===", "==": "!=", "!=": "==" };
/** Arithmetic and logic swap with their partner. */
const SWAP: Record<string, string> = { "+": "-", "-": "+", "*": "/", "/": "*", "%": "*", "&&": "||", "||": "&&", "+=": "-=", "-=": "+=", "*=": "/=", "/=": "*=", "++": "--", "--": "++" };
/** TypeScript nodes that hold code: only their expression is visited. Every other TypeScript node is a type. */
const TS_CODE = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression"]);
/** Keys of a node that hold types or positions, not code. */
const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments", "typeAnnotation", "returnType", "typeParameters", "typeArguments", "superTypeParameters", "implements"]);

function span(n: Node): { start: number; end: number; line: number; endLine: number } {
  // The parser sets all four on every node it makes.
  if (n.start == null || n.end == null || !n.loc) throw new Error(`${n.type} has no position`);
  return { start: n.start, end: n.end, line: n.loc.start.line, endLine: n.loc.end.line };
}

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";

function mutantsOf(source: string): Mutant[] {
  const out: Mutant[] = [];
  // A child in parentheses keeps them, so a swap never changes what binds to what.
  const text = (n: Node) => {
    const s = span(n);
    return n.extra?.parenthesized ? `(${source.slice(s.start, s.end)})` : source.slice(s.start, s.end);
  };
  const add = (n: Node, replacement: string) => out.push({ ...span(n), replacement });

  const visit = (n: Node) => {
    if (n.type.startsWith("TS") && !TS_CODE.has(n.type)) return;
    // Imports name files and exports, not behaviour.
    if (n.type === "ImportDeclaration" || n.type === "ExportAllDeclaration") return;
    switch (n.type) {
      case "BinaryExpression": {
        const op = FLIP[n.operator] ?? SWAP[n.operator];
        if (op) add(n, `${text(n.left)} ${op} ${text(n.right)}`);
        break;
      }
      case "LogicalExpression":
        // `a ?? b` loses its fallback: if no test notices, the fallback is not needed.
        add(n, n.operator === "??" ? text(n.left) : `${text(n.left)} ${SWAP[n.operator]} ${text(n.right)}`);
        break;
      case "AssignmentExpression":
        if (SWAP[n.operator]) add(n, `${text(n.left)} ${SWAP[n.operator]} ${text(n.right)}`);
        break;
      case "UpdateExpression":
        add(n, n.prefix ? `${SWAP[n.operator]}${text(n.argument)}` : `${text(n.argument)}${SWAP[n.operator]}`);
        break;
      case "UnaryExpression":
        if (n.operator === "!" || n.operator === "-") add(n, text(n.argument));
        break;
      case "IfStatement":
      case "ConditionalExpression":
        add(n.test, "true");
        add(n.test, "false");
        break;
      case "NumericLiteral":
        add(n, n.value === 0 ? "1" : String(n.value * 2));
        break;
      case "BooleanLiteral":
        add(n, String(!n.value));
        break;
      case "ArrayExpression": {
        const els = n.elements.filter((el) => el !== null);
        // An array with holes ([a, , b]) has no element to drop cleanly.
        if (els.length < n.elements.length) break;
        els.forEach((el, i) => {
          // Strings are text, like the lines of a message: no test needs to pin each one.
          if (el.type === "StringLiteral" || el.type === "TemplateLiteral") return;
          // Drop the element with the comma after it (or, for the last one, before it).
          const from = i < els.length - 1 ? span(el).start : i > 0 ? span(els[i - 1]).end : span(el).start;
          const to = i < els.length - 1 ? span(els[i + 1]).start : span(el).end;
          out.push({ ...span(el), start: from, end: to, replacement: "" });
        });
        break;
      }
      case "CallExpression":
        if (n.callee.type === "MemberExpression" && n.callee.object.type === "Identifier" && n.callee.object.name === "Math" && n.callee.property.type === "Identifier") {
          const swap = { min: "max", max: "min" }[n.callee.property.name];
          if (swap) add(n.callee.property, swap);
        }
        break;
      case "ExpressionStatement":
      case "ReturnStatement":
      case "BreakStatement":
      case "ContinueStatement":
        add(n, ";");
        break;
    }
    for (const [key, value] of Object.entries(n)) {
      if (SKIP_KEYS.has(key)) continue;
      // A property's name is not code: `{ 2: x }` keeps its key.
      if (key === "key" && "computed" in n && !n.computed) continue;
      if (Array.isArray(value)) for (const v of value) isNode(v) && visit(v);
      else if (isNode(value)) visit(value);
    }
  };
  visit(parse(source, { sourceType: "module", plugins: ["typescript"] }).program);
  return out.sort((a, b) => a.start - b.start);
}

// --- Which code, and which tests ---

type Target = { file: string; lines: [number, number][] | "all" };

function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd: ROOT });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed:\n${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** A file this can mutate: TypeScript in a workspace above, and not a test. web/e2e/ is Playwright's: `bun test` can't run it. */
const mutable = (file: string) =>
  WORKSPACES.some((w) => file.startsWith(`${w}/`)) && !file.startsWith("web/e2e/") && file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts");

/** The lines this branch changed since it left origin/main, uncommitted edits and new files included. */
function changedTargets(): Target[] {
  const base = git("merge-base", "origin/main", "HEAD").trim();
  const targets = new Map<string, [number, number][]>();
  let file: string | null = null;
  for (const line of git("diff", "-U0", "--no-color", "--no-ext-diff", base, "--", ...WORKSPACES).split("\n")) {
    if (line.startsWith("+++ ")) {
      // A deleted file shows as "+++ /dev/null": it has no lines left to mutate.
      file = line.startsWith("+++ b/") && mutable(line.slice(6)) ? line.slice(6) : null;
      continue;
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!file || !hunk) continue;
    // A hunk with no count is one line; a count of 0 only deletes lines, so nothing is left to mutate.
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count === 0) continue;
    const start = Number(hunk[1]);
    targets.set(file, [...(targets.get(file) ?? []), [start, start + count - 1]]);
  }
  const all: Target[] = [...targets].map(([f, lines]) => ({ file: f, lines }));
  for (const f of git("ls-files", "--others", "--exclude-standard", "--", ...WORKSPACES).split("\n")) if (mutable(f)) all.push({ file: f, lines: "all" });
  return all;
}

/** For each source file in the workspaces, the files that import it. */
async function importers(): Promise<Map<string, string[]>> {
  const by = new Map<string, string[]>();
  const ts = new Bun.Transpiler({ loader: "ts" });
  const tsx = new Bun.Transpiler({ loader: "tsx" });
  for (const w of WORKSPACES) {
    for await (const rel of new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: join(ROOT, w) })) {
      if (rel.includes("node_modules/")) continue;
      const path = join(ROOT, w, rel);
      const imports = (path.endsWith("x") ? tsx : ts).scanImports(await Bun.file(path).text());
      // A package resolves into node_modules, never to a file here, so only relative imports count.
      for (const i of imports.filter((i) => i.path.startsWith("."))) {
        const to = Bun.resolveSync(i.path, dirname(path));
        by.set(to, [...(by.get(to) ?? []), path]);
      }
    }
  }
  return by;
}

/** A `bun test` run: some test files of one workspace. */
type Batch = { workspace: string; files: string[] };

/**
 * The test files whose imports reach `file`, directly or through other files. The files that import
 * it directly come first: they catch most mutants, and a caught mutant stops the run early.
 */
function testsOf(file: string, by: Map<string, string[]>): Batch[] {
  const direct = new Set(by.get(join(ROOT, file)) ?? []);
  const seen = new Set([join(ROOT, file)]);
  const todo = [join(ROOT, file)];
  for (let f = todo.pop(); f !== undefined; f = todo.pop()) {
    for (const i of by.get(f) ?? []) if (!seen.has(i)) (seen.add(i), todo.push(i));
  }
  const tests = [...seen].filter((f) => f.endsWith(".test.ts")).sort();
  const batches: Batch[] = [];
  for (const near of [true, false]) {
    for (const workspace of WORKSPACES) {
      const files = tests.filter((f) => direct.has(f) === near && f.startsWith(join(ROOT, workspace, "/"))).map((f) => `./${relative(join(ROOT, workspace), f)}`);
      if (files.length > 0) batches.push({ workspace, files });
    }
  }
  return batches;
}

// --- Running ---

/** A mutant to test: the copy of `file` at `source`. */
type Swap = { file: string; source: string; timeoutMs: number };

/** Runs the batches in order, with the mutant's source in place of its file, until a test fails. */
async function passes(batches: Batch[], mutant: Swap | null): Promise<boolean> {
  for (const { workspace, files } of batches) {
    const proc = Bun.spawn(["bun", "test", "--bail", ...(mutant ? ["--preload", LOADER] : []), ...files], {
      cwd: join(ROOT, workspace),
      env: mutant ? { ...process.env, MUTANT_FILE: mutant.file, MUTANT_SOURCE: mutant.source } : process.env,
      stdout: "ignore",
      stderr: "ignore",
      // A mutant can loop forever (a `while` whose step now goes the wrong way), and bun's own test
      // timeout can't stop a loop that never yields. A timeout counts as caught.
      timeout: mutant?.timeoutMs,
    });
    if ((await proc.exited) !== 0) return false;
  }
  return true;
}

type Result = { file: string; tests: number; testMs: number; mutants: (Mutant & { caught: boolean })[]; source: string };

async function mutateFile(t: Target, by: Map<string, string[]>, dir: string): Promise<Result | "untested"> {
  const path = join(ROOT, t.file);
  const source = await Bun.file(path).text();
  const tests = testsOf(t.file, by);
  if (tests.length === 0) return "untested";
  const lines = t.lines;
  const mutants = mutantsOf(source).filter((m) => lines === "all" || lines.some(([a, b]) => m.line <= b && m.endLine >= a));
  const count = tests.flatMap((b) => b.files).length;
  if (mutants.length === 0) return { file: t.file, tests: count, testMs: 0, mutants: [], source };

  const testStart = performance.now();
  if (!(await passes(tests, null))) {
    throw new Error(`The tests of ${t.file} fail with no mutant: fix them first.\n  ${tests.flatMap((b) => b.files).join(" ")}`);
  }
  const testMs = performance.now() - testStart;
  // Every core runs tests at once, so a run is slower than this one alone: a mutant may take 5 times as long, plus 5 s.
  const timeoutMs = Math.round(5_000 + 5 * testMs);

  const caught: boolean[] = [];
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < mutants.length; i = next++) {
      const m = mutants[i];
      const file = join(dir, `${i}-${t.file.replaceAll("/", "_")}`);
      await Bun.write(file, source.slice(0, m.start) + m.replacement + source.slice(m.end));
      caught[i] = !(await passes(tests, { file: path, source: file, timeoutMs }));
    }
  };
  await Promise.all(Array.from({ length: availableParallelism() }, worker));
  return { file: t.file, tests: count, testMs, mutants: mutants.map((m, i) => ({ ...m, caught: caught[i] })), source };
}

// --- Main ---

const oneLine = (s: string) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
};

const args = process.argv.slice(2);
const changed = args.includes("--changed");
const files = args.filter((a) => a !== "--changed");
if (changed === files.length > 0) {
  console.log("usage: bun run mutate <file.ts ...>   or   bun run mutate --changed");
  process.exit(2);
}
const targets: Target[] = changed ? changedTargets() : files.map((f) => ({ file: relative(ROOT, resolve(f)), lines: "all" }));
const notMutable = targets.filter((t) => !mutable(t.file));
if (notMutable.length > 0) {
  console.log(`Not a TypeScript source file in ${WORKSPACES.join("/ or ")}/: ${notMutable.map((t) => t.file).join(", ")}`);
  process.exit(2);
}
if (targets.length === 0) {
  console.log(`No TypeScript source changed in ${WORKSPACES.join("/ or ")}/ since origin/main: nothing to mutate.`);
  process.exit(0);
}

const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const start = performance.now();
const by = await importers();
const dir = mkdtempSync(join(tmpdir(), "mutate-"));
const results: Result[] = [];
const untested: string[] = [];
try {
  for (const t of targets) {
    const fileStart = performance.now();
    const r = await mutateFile(t, by, dir);
    if (r === "untested") {
      untested.push(t.file);
      continue;
    }
    results.push(r);
    const survivors = r.mutants.filter((m) => !m.caught);
    console.log(`\n${t.file}: ${r.mutants.length} mutants, ${r.tests} test files${r.mutants.length ? ` (${Math.round(r.testMs)} ms for one run)` : ""}, ${s(performance.now() - fileStart)}`);
    for (const m of survivors) {
      const was = oneLine(r.source.slice(m.start, m.end));
      console.log(`  ${t.file}:${m.line}  ${[";", ""].includes(m.replacement) ? `removed: ${was}` : `${was}  ->  ${oneLine(m.replacement)}`}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true });
}

const pct = (k: number, n: number) => (n === 0 ? "     -" : `${((100 * k) / n).toFixed(1).padStart(5)}%`);
if (results.length > 0) console.log("\n score  caught/mutants  file");
let caught = 0;
let total = 0;
for (const r of results) {
  const k = r.mutants.filter((m) => m.caught).length;
  caught += k;
  total += r.mutants.length;
  console.log(`${pct(k, r.mutants.length)}  ${`${k}/${r.mutants.length}`.padStart(14)}  ${r.file}`);
}
if (results.length > 1) console.log(`${pct(caught, total)}  ${`${caught}/${total}`.padStart(14)}  all`);
for (const f of untested) console.log(`  no test file imports ${f}, directly or through other files`);
console.log(`\n${s(performance.now() - start)}`);
