// Entry point for the Better Auth CLI (`bunx auth generate --config auth.cli.ts`).
// The CLI runs under Node, so no Bun APIs here: the merge hook gets a stub.
import type { PgClient } from "@effect/sql-pg";
import { createAuth } from "./src/auth";
import { loadConfig } from "./src/config";
import { OutboxMailer } from "./src/mail";

const config = loadConfig();
export const auth = createAuth(config, {} as PgClient.PgClient, new OutboxMailer()).auth;
