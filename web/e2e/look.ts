// The look tool (#974): one command that drives the app and writes a picture and a state
// file after each step, so an agent need not write a spec to see a change. From web/:
//
//   bun run look /abs/folder --demo es:800 --spot walk "tap stile" "wait mode free"
//
// Run it with no arguments for the flags and the steps. It checks the arguments here, then
// runs look.run.ts with the e2e setup (servers, ports, database, slot queue).

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

import { parseRun, USAGE } from "./lookScript";
import { SPOTS } from "./spots";

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.log(USAGE);
  process.exit(0);
}
let view: string;
try {
  const run = parseRun(argv, Object.keys(SPOTS));
  mkdirSync(run.dir, { recursive: true });
  view = run.view;
} catch (e) {
  console.error(`${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
  process.exit(2);
}
const done = spawnSync("bunx", ["playwright", "test", "-c", "look.config.ts", "--project", view], { stdio: "inherit", env: { ...process.env, LOOK_ARGS: JSON.stringify(argv) } });
// No status: the run was stopped by a signal.
process.exit(done.status ?? 1);
