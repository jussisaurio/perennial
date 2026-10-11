// Perennial server: auth, sync (Electric proxy + writes), Perennial AI, and
// the built web app from ../web/dist. Configuration: see src/config.ts.
// Error reporting is set up in instrument.ts (preloaded, see package.json).

import { createApp } from "./src/app";
import { configProblems, loadConfig } from "./src/config";
import { log } from "./src/log";

const config = loadConfig();
const problems = configProblems(config);
if (problems.length) {
  for (const p of problems) log.error("configuration", { problem: p });
  process.exit(1);
}
const sql = new Bun.SQL(config.databaseUrl, { max: 10, idleTimeout: 30 });
const app = createApp(config, sql);

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
  // Electric holds live shape requests open for ~20 s; Bun's default 10 s idle
  // timeout would cut them.
  idleTimeout: 0,
});

log.info("perennial server started", {
  url: `http://localhost:${server.port}`,
  release: config.release,
  ai: app.ai.enabled ? config.anthropic.model : "off",
  mail: config.dev ? "dev outbox" : "resend",
  electric: config.electric.url,
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    log.info("shutting down", { signal });
    await server.stop();
    await app.close();
    await sql.close();
    process.exit(0);
  });
}
