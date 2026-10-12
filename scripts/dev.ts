// Local development in one command: `bun run dev` at the repo root.
//
// Starts Postgres + Electric (docker compose), installs dependencies when
// missing, applies migrations, then runs the API (:8787) and the app (:5173)
// with their output side by side. Ctrl-C stops both (the containers keep
// running; `docker compose down` stops them).
//
//   bun run dev          sign-in codes appear in the API output
//   bun run dev --ai     also a mock model, so Perennial AI works without a key

import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const AI = process.argv.includes("--ai");

function run(cmd: string[], cwd = ROOT) {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) {
    console.error(`\nfailed: ${cmd.join(" ")}`);
    process.exit(1);
  }
}

console.log("▸ Postgres + Electric");
run(["docker", "compose", "up", "-d", "--wait"]);
// One install at the root covers every workspace (web, server, scripts).
if (["node_modules", "web/node_modules", "server/node_modules"].some((d) => !existsSync(join(ROOT, d)))) {
  console.log("▸ installing dependencies");
  run(["bun", "install"]);
}
console.log("▸ migrations");
run(["bun", "src/migrate.ts"], join(ROOT, "server"));

// Long-running processes, each line prefixed with its name.
const COLORS = { api: 36, web: 35, ai: 33 } as const;
const children: ReturnType<typeof Bun.spawn>[] = [];
function start(name: keyof typeof COLORS, cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const child = Bun.spawn(cmd, { cwd, env: { ...process.env, FORCE_COLOR: "1", ...env }, stdout: "pipe", stderr: "pipe" });
  const tag = `\x1b[${COLORS[name]}m${name.padEnd(3)}\x1b[0m │ `;
  for (const stream of [child.stdout, child.stderr]) {
    void (async () => {
      let rest = "";
      for await (const chunk of stream as ReadableStream<Uint8Array>) {
        const lines = (rest + new TextDecoder().decode(chunk)).split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) process.stdout.write(tag + line + "\n");
      }
    })();
  }
  void child.exited.then((code) => {
    if (!stopping) {
      console.error(`${tag}exited (${code}); stopping`);
      stop();
    }
  });
  children.push(child);
}

const aiEnv: Record<string, string> = AI ? { ANTHROPIC_API_KEY: "mock", ANTHROPIC_BASE_URL: "http://localhost:8788" } : {};
if (AI) start("ai", ["bun", "mock-llm.ts"], join(ROOT, "server"), { PORT: "8788" });
start("api", ["bun", "run", "dev"], join(ROOT, "server"), aiEnv);
start("web", ["bun", "run", "dev"], join(ROOT, "web"));

console.log(`
  App:   http://localhost:5173
  Demo:  http://localhost:5173/?demo=es:30   (a Spanish learner with 30 words and a history)
  Codes: sign-in codes are printed below as "[mail] sign-in code for …"${AI ? "\n  AI:    mock model on :8788 (placeholder words)" : ""}
`);

let stopping = false;
function stop() {
  stopping = true;
  for (const c of children) c.kill();
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
