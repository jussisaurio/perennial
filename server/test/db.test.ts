// sslmode=require means TLS without a certificate check (libpq's meaning, and
// Bun.SQL's); production's DATABASE_URL uses it (docs/DEPLOY.md). sql-pg alone
// would check the certificate.

import { expect, test } from "bun:test";
import { connection } from "../src/db";

// No TLS Postgres here to connect to: the PR that brought sql-pg (#322 part 2)
// shows the handshake against one with a self-signed certificate.
test("sslmode=require uses TLS without checking the certificate; verify-full checks it", () => {
  expect(connection("postgres://u:p@db.example:5432/x?sslmode=require").ssl).toEqual({ rejectUnauthorized: false });
  expect(connection("postgres://u:p@db.example:5432/x?sslmode=verify-full").ssl).toBeUndefined();
  expect(connection("postgres://u:p@localhost:25432/x").ssl).toBeUndefined();
});
