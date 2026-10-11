// Perennial server: sync (op log), accounts, hosted AI, and billing. Also
// serves the built web app from ../web/dist when present.
//
// Configuration is read from the environment; see src/config.ts.

import { createApp } from "./src/app";
import { loadConfig } from "./src/config";

const config = loadConfig();
const app = createApp(config);
const server = Bun.serve({ port: config.port, fetch: app.fetch });

const housekeeping = () => {
  const r = app.maintain();
  if (r.rows || r.sessions || r.codes) console.log(`housekeeping: forgot ${r.rows} deleted rows (${r.ops} history entries), ${r.sessions} expired sessions, ${r.codes} old codes`);
};
housekeeping();
setInterval(housekeeping, 24 * 3_600_000);

console.log(
  `perennial server on http://localhost:${server.port}` +
    ` (db: ${config.dbPath}, ai: ${config.anthropic.apiKey || config.anthropic.baseURL ? config.anthropic.model : "off"},` +
    ` billing: ${app.billing.stripe ? "on" : "off"}, mail: ${config.dev ? "dev outbox" : "resend"})`,
);
