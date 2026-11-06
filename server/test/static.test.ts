// Serving the built app: hashed assets are cached forever, everything else
// revalidates, and a missing file is a 404 (never index.html in its place).

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveStatic } from "../src/http";
import { startApp, stopMockLLM } from "./helpers";

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

test("the CSP allows the page's own inline script by hash, and no other", async () => {
  const pageDir = mkdtempSync(join(tmpdir(), "perennial-inline-"));
  const script = "\n  document.documentElement.dataset.theme = 'dark';\n";
  writeFileSync(join(pageDir, "index.html"), `<!doctype html><head><script>${script}</script><script type="module" src="/assets/main.js"></script></head>`);
  const t = await startApp({ staticDir: pageDir });
  try {
    const csp = (await fetch(t.url + "/")).headers.get("content-security-policy") ?? "";
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src "));
    expect(scriptSrc).toBe(`script-src 'self' 'sha256-${createHash("sha256").update(script).digest("base64")}'`);
  } finally {
    await t.stop();
    stopMockLLM();
  }
});

test("a HEAD request learns the length of what GET would send", async () => {
  const t = await startApp({ staticDir: dir });
  try {
    for (const path of ["/assets/index-abc123.js", "/today", "/assets/index-old999.js", "/%E0", "/sw.js"]) {
      const get = await fetch(t.url + path);
      const head = await fetch(t.url + path, { method: "HEAD" });
      expect({ path, status: head.status, length: head.headers.get("content-length") }).toEqual({ path, status: get.status, length: String((await get.arrayBuffer()).byteLength) });
    }
  } finally {
    await t.stop();
    stopMockLLM();
  }
});
