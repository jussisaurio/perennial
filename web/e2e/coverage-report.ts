// Turns the e2e coverage (e2e/coverage.ts) into the markdown section of the dead-code
// report: each web/src function that never ran in the suite, grouped by directory and
// split into parts of about equal size, one per agent of a cleanup sweep (#812).
// Run from web/: bun e2e/coverage-report.ts <out.md> <parts>

import { parse } from "@babel/parser";
import { CoverageReport } from "monocart-coverage-reports";
import { globSync, readFileSync, writeFileSync } from "node:fs";

import { coverageOptions } from "./coverage";

type Range = { start: number; end: number; count: number };
type Fn = { name: string; start: number; end: number; body: number };
type Dead = { name: string; line: number; endLine: number };
type File = { path: string; dir: string; total: number; dead: Dead[]; loaded: boolean; weight: number };

const [out, partsArg] = process.argv.slice(2);
if (out === undefined || partsArg === undefined) throw new Error("usage: bun e2e/coverage-report.ts <out.md> <parts>");
const PARTS = Number(partsArg);

const results = await new CoverageReport(coverageOptions).generate();
if (results === undefined) throw new Error("no coverage: run the e2e suite with E2E_COVERAGE=1 first");

type Node = { type: string; start: number; end: number; [key: string]: unknown };
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as Node).type === "string";

/** A readable name for a function node, from the node or what it is assigned to. */
function nameOf(fn: Node, parent: Node | undefined, grandparent: Node | undefined): string {
  const id = (n: unknown) => (isNode(n) && n.type === "Identifier" ? (n.name as string) : undefined);
  const named = id(fn.id) ?? id(fn.key) ?? (parent && (id(parent.id) ?? id(parent.key) ?? id(parent.left)));
  if (named) return named;
  if (parent?.type === "JSXExpressionContainer" && grandparent?.type === "JSXAttribute") return `${(grandparent.name as Node).name as string} handler`;
  if (parent?.type === "CallExpression") {
    const callee = parent.callee as Node;
    return `callback of ${id(callee) ?? id(callee.property) ?? "a call"}()`;
  }
  return "anonymous function";
}

const FUNCTION = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod|ClassPrivateMethod)$/;

/** Every function in a TS or TSX source, by the original source's offsets. */
function functionsIn(source: string, path: string): Fn[] {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", ...(path.endsWith(".tsx") ? (["jsx"] as const) : [])] });
  const fns: Fn[] = [];
  const visit = (node: Node, parent: Node | undefined, grandparent: Node | undefined) => {
    if (FUNCTION.test(node.type)) {
      const body = node.body as Node;
      fns.push({ name: nameOf(node, parent, grandparent), start: node.start, end: node.end, body: body.start });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      for (const child of Array.isArray(value) ? value : [value]) if (isNode(child)) visit(child, node, parent);
    }
  };
  visit(ast.program as unknown as Node, undefined, undefined);
  return fns;
}

/**
 * V8's count for a source position: the innermost range around it, the one that starts
 * last. Ranges that start at the same place come from the React Compiler, which moves a
 * component's callbacks out to new functions that the source map points at the whole
 * component (Main and its never-called _temp5 both map to Main): the highest count wins.
 * A position in no range ran with its module, which loaded.
 */
function countAt(ranges: Range[], pos: number): number {
  let best: Range | undefined;
  for (const r of ranges) {
    if (r.start > pos || pos >= r.end) continue;
    if (!best || r.start > best.start || (r.start === best.start && r.count > best.count)) best = r;
  }
  return best ? best.count : 1;
}

const lineAt = (source: string, offset: number) => source.slice(0, offset).split("\n").length;

/** The functions that never ran, leaving out those inside another one that never ran. */
function deadFunctions(source: string, fns: Fn[], ranges: Range[]): Dead[] {
  const never = fns.filter((f) => countAt(ranges, f.body) === 0).sort((a, b) => a.start - b.start);
  const outer: Fn[] = [];
  for (const f of never) {
    const last = outer.at(-1);
    if (last && f.end <= last.end) continue;
    outer.push(f);
  }
  return outer.map((f) => ({ name: f.name, line: lineAt(source, f.start), endLine: lineAt(source, f.end) }));
}

const fileOf = (path: string, rest: Omit<File, "path" | "dir">): File => ({ path, dir: path.slice(0, path.lastIndexOf("/")), ...rest });

const files = new Map<string, File>();
for (const f of results.files) {
  const ranges = f.data?.bytes;
  if (f.source === undefined || ranges === undefined) throw new Error(`coverage: no source or byte ranges for ${f.sourcePath}`);
  const fns = functionsIn(f.source, f.sourcePath);
  const dead = deadFunctions(f.source, fns, ranges);
  files.set(f.sourcePath, fileOf(f.sourcePath, { total: fns.length, dead, loaded: true, weight: dead.reduce((n, d) => n + d.endLine - d.line + 1, 0) }));
}

// Modules the suite never loaded at all.
for (const rel of globSync("src/**/*.{ts,tsx}")) {
  const path = `web/${rel}`;
  if (files.has(path) || /\.(test|d)\.tsx?$/.test(rel)) continue;
  files.set(path, fileOf(path, { total: 0, dead: [], loaded: false, weight: readFileSync(rel, "utf8").split("\n").length }));
}

// Parts of about equal weight: files in order, by directory, each part taking its share
// of what is left, so a part holds whole files and mostly whole directories.
const listed = [...files.values()].filter((f) => !f.loaded || f.dead.length > 0).sort((a, b) => a.dir.localeCompare(b.dir) || a.path.localeCompare(b.path));
const parts: File[][] = [];
let left = listed.reduce((n, f) => n + f.weight, 0);
let i = 0;
while (i < listed.length) {
  const target = left / (PARTS - parts.length);
  const part: File[] = [];
  let w = 0;
  while (i < listed.length && (part.length === 0 || w + listed[i]!.weight / 2 <= target || parts.length === PARTS - 1)) {
    w += listed[i]!.weight;
    part.push(listed[i++]!);
  }
  parts.push(part);
  left -= w;
}

const loaded = [...files.values()].filter((f) => f.loaded);
const total = loaded.reduce((n, f) => n + f.total, 0);
const dead = loaded.reduce((n, f) => n + f.dead.length, 0);
const md: string[] = [
  `${loaded.length} modules loaded, with ${total} functions; ${dead} outermost functions never ran. ${listed.filter((f) => !f.loaded).length} modules never loaded.`,
  "",
  "Each entry is the outermost function that never ran: a function inside it is not listed again. A part's weight is its lines of never-run code (the whole file if it never loaded).",
];
for (const [n, part] of parts.entries()) {
  const w = part.reduce((sum, f) => sum + f.weight, 0);
  md.push("", `### Part ${n + 1} of ${parts.length}: ${part[0]!.path} to ${part.at(-1)!.path} (${w} lines)`);
  let dir = "";
  for (const f of part) {
    if (f.dir !== dir) {
      dir = f.dir;
      md.push("", `#### ${dir}/`, "");
    }
    if (!f.loaded) {
      md.push(`- \`${f.path}\`: **never loaded** (${f.weight} lines)`);
      continue;
    }
    md.push(`- \`${f.path}\`: ${f.dead.length} of ${f.total} functions never ran`);
    for (const d of f.dead) md.push(`  - L${d.line}${d.endLine > d.line ? `–${d.endLine}` : ""} \`${d.name}\``);
  }
}
writeFileSync(out, md.join("\n") + "\n");
