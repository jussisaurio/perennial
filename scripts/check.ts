// Everything to run before a merge, in one command: `bun run check` at the repo root.
// CI's `checks` job runs the same command, so local and CI cannot drift.
//
// It runs every step even after a failure, so one run shows all the failures.
// It prints one line per step, then the output of each failed step, and exits 1 if any failed.

import { connect } from "node:net";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const POSTGRES_PORT = 25432; // docker-compose.yml

type Step = { name: string; cmd: string[]; cwd: string };

const steps: Step[] = [
  { name: "typecheck (all workspaces)", cmd: ["bun", "run", "typecheck"], cwd: ROOT },
  { name: "lint", cmd: ["bun", "run", "lint"], cwd: ROOT },
  { name: "knip", cmd: ["bun", "run", "knip"], cwd: ROOT },
  { name: "unit tests (web)", cmd: ["bun", "run", "test"], cwd: join(ROOT, "web") },
  { name: "unit tests (scripts)", cmd: ["bun", "run", "test"], cwd: join(ROOT, "scripts") },
];
const serverTests: Step = { name: "server tests (Postgres)", cmd: ["bun", "run", "test"], cwd: join(ROOT, "server") };

/** True when something listens on the local Postgres port. */
function postgresIsUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(POSTGRES_PORT, "localhost");
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    // A refused connection is the answer "not up", not a failure of the check.
    socket.once("error", () => resolve(false));
  });
}

const label = (name: string) => name.padEnd(30);

const failed: { step: Step; output: string }[] = [];
async function run(step: Step) {
  const start = performance.now();
  // Both streams go to one file descriptor, so the lines keep their order.
  const proc = Bun.spawn(["sh", "-c", '"$@" 2>&1', "sh", ...step.cmd], { cwd: step.cwd, stdout: "pipe", stderr: "inherit" });
  const output = await new Response(proc.stdout).text();
  const ok = (await proc.exited) === 0;
  const seconds = ((performance.now() - start) / 1000).toFixed(1);
  console.log(`${ok ? "pass" : "FAIL"}  ${label(step.name)} ${seconds} s`);
  if (!ok) failed.push({ step, output });
}

for (const step of steps) await run(step);

// On CI the server tests always run: a missing Postgres there must fail, not skip.
if (process.env.CI || (await postgresIsUp())) await run(serverTests);
else console.log(`skip  ${label(serverTests.name)} not run: Postgres is not up on port ${POSTGRES_PORT} (start it with \`docker compose up -d\`)`);

for (const { step, output } of failed) {
  console.log(`\n── FAIL: ${step.name} (\`${step.cmd.join(" ")}\` in ${step.cwd}) ──\n${output.trimEnd()}`);
}
if (failed.length > 0) {
  console.log(`\n${failed.length} failed: ${failed.map((f) => f.step.name).join(", ")}`);
  process.exit(1);
}
console.log("\nall passed");
