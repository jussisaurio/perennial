// The robot learner (#1024): one command that lives in the app for many days of pinned time,
// as a new learner, and writes down what breaks. From web/:
//
//   bun run live /abs/folder --days 30 --seed 1
//
// It runs e2e/live.run.ts with the e2e setup (servers, ports, database, slot queue). The
// folder gets diary.txt (one line per action), day-NNN.png (the last screen of each day),
// findings.json and findings.md (each finding with its day, step and picture). The same
// seed makes the same learner. docs/agents.md says when to run it.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { LIVE_TZ, parseLive, USAGE } from "./liveArgs";

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.log(USAGE);
  process.exit(0);
}
let dir: string;
try {
  dir = resolve(parseLive(argv).dir);
  mkdirSync(dir, { recursive: true });
} catch (e) {
  console.error(`${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
  process.exit(2);
}
// TZ: the robot works out its days in the browser's time zone, so Node uses the same one.
const done = spawnSync("bunx", ["playwright", "test", "-c", "live.config.ts", "--project", "live"], { stdio: "inherit", env: { ...process.env, TZ: LIVE_TZ, LIVE_ARGS: JSON.stringify(argv) } });
// No status: the run was stopped by a signal.
process.exit(done.status ?? 1);
