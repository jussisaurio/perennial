// Serving the built app: hashed assets are cached forever, everything else
// revalidates, and a missing file is a 404 (never index.html in its place).

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveStatic } from "../src/http";

const dir = mkdtempSync(join(tmpdir(), "perennial-static-"));
mkdirSync(join(dir, "assets"));
writeFileSync(join(dir, "index.html"), "<!doctype html>app");
writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log(1)");

test("assets, app routes and missing files", async () => {
  const asset = await serveStatic(dir, "/assets/index-abc123.js");
  expect(asset.headers.get("cache-control")).toContain("immutable");
  for (const path of ["/", "/today", "/../etc/passwd"]) {
    const page = await serveStatic(dir, path);
    expect(await page.text()).toBe("<!doctype html>app");
    expect(page.headers.get("cache-control")).toBe("no-cache");
  }
  // Last release's chunk, after a deploy: 404, so the client reloads.
  expect((await serveStatic(dir, "/assets/index-old999.js")).status).toBe(404);
  expect((await serveStatic(dir, "/decks/es/deck.json")).status).toBe(404);
});

test("malformed percent-encoding is a bad request, not a server error", async () => {
  for (const path of ["/%E0", "/assets/%zz.js", "/%"]) expect((await serveStatic(dir, path)).status).toBe(400);
});
