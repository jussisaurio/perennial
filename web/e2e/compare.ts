// What a branch changed on screen (#1004): `bun run shots` on main and on this checkout,
// then the screens whose pixels differ. From web/:
//
//   bun run compare /abs/folder [-g "today|settings"]
//
// -g picks screens by name, as for shots (leave it out for all). It puts the commit where
// this branch left origin/main in a worktree beside this one (.claude/worktrees/<this one>-main),
// takes the shots in both at once, and prints one line per screen that changed: the share of
// its pixels and the box around them. <folder>/main and <folder>/branch hold the shots, and <folder>/diff/<name>.png
// marks each changed pixel in red.

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { pixelDiff } from "./pixelDiff";

const [dir, ...rest] = process.argv.slice(2);
if (dir === undefined || !dir.startsWith("/") || !(rest.length === 0 || (rest.length === 2 && rest[0] === "-g"))) {
  console.error('usage: bun run compare /abs/folder [-g "today|settings"]');
  process.exit(2);
}

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

const here = git(process.cwd(), "rev-parse", "--show-toplevel");
// The owner's checkout is the parent of the shared .git folder.
const repo = dirname(resolve(here, git(here, "rev-parse", "--git-common-dir")));
const name = /\/\.claude\/worktrees\/([^/]+)$/.exec(here)?.[1] ?? "compare";
const base = `${repo}/.claude/worktrees/${name}-main`;

git(here, "fetch", "-q", "origin", "main");
// The merge base, not origin/main: on a branch that is behind, origin/main's own changes
// would show up as this branch's.
const from = git(here, "merge-base", "HEAD", "origin/main");
if (existsSync(base)) git(base, "checkout", "-q", "--detach", from);
else git(here, "worktree", "add", "-q", "--detach", base, from);
const install = spawnSync("bun", ["install"], { cwd: base, stdio: "ignore" });
if (install.status !== 0) throw new Error(`bun install failed in ${base}`);

/** One shots run; resolves to its exit code. Its output goes to <folder>/<side>.log. */
function shots(side: "main" | "branch", root: string): Promise<number> {
  mkdirSync(`${dir}/${side}`, { recursive: true });
  const log = createWriteStream(`${dir}/${side}.log`);
  const run = spawn("bunx", ["playwright", "test", "-c", "shots.config.ts", ...rest], { cwd: `${root}/web`, env: { ...process.env, SHOTS_DIR: `${dir}/${side}` } });
  run.stdout.pipe(log, { end: false });
  run.stderr.pipe(log, { end: false });
  // No code: the run was stopped by a signal.
  return new Promise((done) => run.on("close", (code) => log.end(() => done(code ?? 1))));
}

console.log(`shots on main at ${from.slice(0, 7)} (${base}) and on this branch; logs in ${dir}/main.log and ${dir}/branch.log`);
const [onMain, onBranch] = await Promise.all([shots("main", base), shots("branch", here)]);
// Shots fails on a UI fault after it writes the picture, so a failed run still has its PNGs.
// Missing PNGs show below as "only on main" or "only here".
if (onMain !== 0) console.log(`shots on main failed (exit ${onMain}): its own faults, or a broken run. See main.log.`);
if (onBranch !== 0) console.log(`shots on this branch failed (exit ${onBranch}): read branch.log, as a UI fault there is yours.`);

const pngs = (side: string) => new Set(readdirSync(`${dir}/${side}`).filter((f) => f.endsWith(".png")));
const [m, b] = [pngs("main"), pngs("branch")];
mkdirSync(`${dir}/diff`, { recursive: true });
let same = 0;
for (const f of [...new Set([...m, ...b])].sort()) {
  const screen = basename(f, ".png");
  if (!b.has(f)) console.log(`only on main  ${screen}`);
  else if (!m.has(f)) console.log(`only here     ${screen}`);
  else {
    const d = pixelDiff(`${dir}/main/${f}`, `${dir}/branch/${f}`, `${dir}/diff/${f}`);
    if (d.box === null) same++;
    else console.log(`changed ${((100 * d.changed) / d.total).toFixed(2).padStart(6)}%  ${screen}  box ${d.box.x},${d.box.y} ${d.box.w}x${d.box.h}`);
  }
}
console.log(`same: ${same} screens`);
