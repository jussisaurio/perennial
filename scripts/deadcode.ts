// The dead-code report for a cleanup sweep (#812): knip's production findings for every
// workspace, then each web/src function that never ran across the e2e suite (V8
// coverage, web/e2e/coverage.ts), split into parts for parallel agents.
//
//   bun run deadcode <report.md>
//
// It runs the whole Chromium e2e suite, so it takes a while. The server runs on Bun,
// which has no coverage outside `bun test`, so server code is in knip's part only.
import { rmSync } from "node:fs";

const out = process.argv[2];
if (out === undefined) throw new Error("usage: bun run deadcode <report.md>");
const ROOT = new URL("..", import.meta.url).pathname;
const WEB = `${ROOT}web`;
// About 8 agents share a sweep (CLAUDE.md, "Every week: a cleanup sweep").
const PARTS = 8;
const started = Date.now();

// knip exits 1 when it finds something, which is what this report is for; 2 is its own error.
const knip = Bun.spawnSync(["bunx", "knip", "--production", "--reporter", "markdown"], { cwd: ROOT, stderr: "inherit" });
if (knip.exitCode > 1) throw new Error(`knip failed (exit ${knip.exitCode})`);
const knipReport = knip.stdout.toString().replace(/^# Knip report\n/, "").replaceAll(/^## /gm, "### ");

// Coverage from an earlier run would mix with this one.
rmSync(`${WEB}/coverage/e2e`, { recursive: true, force: true });
// Only the Chromium projects: WebKit (iphone) has no page.coverage.
const e2eStart = Date.now();
const e2e = Bun.spawnSync(["bunx", "playwright", "test", "--project=desktop", "--project=phone"], {
  cwd: WEB,
  env: { ...process.env, E2E_COVERAGE: "1" },
  stdout: "inherit",
  stderr: "inherit",
});
const e2eMinutes = ((Date.now() - e2eStart) / 60_000).toFixed(1);

const section = `${WEB}/coverage/e2e/section.md`;
const cov = Bun.spawnSync(["bun", "e2e/coverage-report.ts", section, String(PARTS)], { cwd: WEB, stdout: "inherit", stderr: "inherit" });
if (cov.exitCode !== 0) throw new Error(`coverage report failed (exit ${cov.exitCode})`);

const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: ROOT }).stdout.toString().trim();
const report = [
  "# Dead-code report",
  "",
  `Commit ${commit}, ${new Date().toISOString().slice(0, 10)}. Took ${((Date.now() - started) / 60_000).toFixed(1)} min (e2e ${e2eMinutes} min).`,
  // A failed test still counts what it ran, but code after the failure point looks dead.
  e2e.exitCode === 0 ? "All e2e tests passed." : `**Some e2e tests failed (exit ${e2e.exitCode})**: code they did not reach shows as never run.`,
  "",
  "A finding is a lead, not proof. Check each one before you delete it: code may run only on a path the suite does not take (an error, a slow network, the iPhone touch spec, a server-only path).",
  "",
  "## 1. knip --production",
  "",
  "Production mode leaves out tests and tools, so an export used only by tests shows here, and so does a script that is run by hand.",
  knipReport,
  "## 2. Never ran in the e2e suite (web/src)",
  "",
  await Bun.file(section).text(),
].join("\n");
await Bun.write(out, report);
console.log(`deadcode: wrote ${out}`);
