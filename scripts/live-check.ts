// Live security check against a deployed Perennial (our own app; non-destructive).
// Probes headers, closed dev/auth endpoints, file leaks, cross-user isolation,
// CSRF and limits, using two throwaway anonymous users that it deletes at the end.
//
//   bun scripts/live-check.ts https://perennial-production.up.railway.app
const BASE = process.argv[2] ?? "https://perennial-production.up.railway.app";
const ORIGIN = BASE;
let fails = 0;
const ok = (cond: boolean, what: string, detail = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};

async function req(path: string, opts: { method?: string; body?: unknown; raw?: string; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, ...(opts.cookie ? { cookie: opts.cookie } : {}), ...opts.headers };
  let body: string | undefined;
  if (opts.raw !== undefined) body = opts.raw;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] ??= "application/json";
  }
  const go = () => fetch(BASE + path, { method: opts.method ?? (body === undefined ? "GET" : "POST"), headers, body, redirect: "manual" });
  // A reused socket can be dead after a refused oversized upload: retry once on a fresh one.
  const res = await go().catch((e) => (path === "/api/write" && body && body.length > 512 * 1024 ? Promise.reject(e) : go()));
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

async function anon() {
  const res = await fetch(BASE + "/api/auth/sign-in/anonymous", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });
  const setCookies = res.headers.getSetCookie();
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  const me = await (await fetch(BASE + "/api/me", { headers: { cookie } })).json().catch(() => ({}));
  return { status: res.status, cookie, setCookies, id: (me as { id?: string }).id };
}

console.log(`Probing ${BASE}\n`);

// 1. Public surface and headers
const home = await req("/");
ok(home.status === 200, "home page serves");
const csp = home.headers.get("content-security-policy") ?? "";
ok(csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'"), "CSP with default-src self and frame-ancestors none");
ok(!/unsafe-eval'/.test(csp.replace("wasm-unsafe-eval", "")), "CSP has no unsafe-eval (only wasm-unsafe-eval)");
ok((home.headers.get("strict-transport-security") ?? "").includes("max-age"), "HSTS");
ok(home.headers.get("x-content-type-options") === "nosniff", "nosniff");
ok((await req("/health")).status === 200, "/health 200");

// 2. Things that must not be public
for (const p of ["/api/dev/outbox", "/api/dev/rows?table=review"]) ok([401, 403, 404].includes((await req(p)).status), `dev endpoint closed: ${p}`, String((await req(p)).status));
for (const p of ["/.env", "/.git/config", "/server/src/config.ts", "/../../etc/passwd", "/assets/../../server/.env", "/package.json"]) {
  const r = await req(p);
  const leaked = /DATABASE_URL|BETTER_AUTH|\[core\]|root:x:|"dependencies"/.test(r.text);
  ok(!leaked, `no file leak: ${p}`, `${r.status}`);
}
const assets = (home.text.match(/\/assets\/[^"']+\.js/g) ?? []).slice(0, 3);
for (const a of assets) ok((await req(a + ".map")).status !== 200 || !(await req(a + ".map")).text.includes('"sources"'), `no source map: ${a}.map`);
ok((await req("/api/shape?table=review&offset=-1")).status === 401, "shape needs a session");
ok((await req("/api/me")).status === 401, "/api/me needs a session");
ok([401, 403].includes((await req("/api/ai/examples", { body: { lang: "es", words: [], known: [] } })).status), "AI needs a session");

// 3. Sessions and cookies
const A = await anon();
const B = await anon();
ok(A.status === 200 && !!A.id && !!B.id && A.id !== B.id, "two anonymous users", `${A.status}`);
const sc = A.setCookies.join(" | ").toLowerCase();
ok(sc.includes("httponly") && sc.includes("secure") && sc.includes("samesite"), "session cookie is HttpOnly, Secure, SameSite");

// 4. Unused Better Auth endpoints are closed
for (const p of ["/api/auth/list-sessions", "/api/auth/update-user", "/api/auth/sign-up/email", "/api/auth/sign-in/email", "/api/auth/forget-password", "/api/auth/email-otp/request-password-reset", "/api/auth/list-accounts", "/api/auth/delete-user", "/api/auth/change-email"]) {
  const r = await req(p, { body: {}, cookie: A.cookie });
  ok(r.status === 404, `auth endpoint closed: ${p}`, String(r.status));
}

// 5. Cross-user isolation
const reviewId = crypto.randomUUID();
const wA = await req("/api/write", { cookie: A.cookie, headers: { "x-perennial-version": "9.9.9" }, body: { mutations: [{ type: "review.insert", row: { id: reviewId, lang: "es", word_id: "es.w.aaaaaaaaaa", skill: "read", grade: 3, reviewed_at: new Date().toISOString(), duration_ms: 3000 } }] } });
ok(wA.status === 200, "user A can write", String(wA.status));
for (const extra of ["", "&where=true", `&where=user_id%3D'${A.id}'`, `&params[1]=${A.id}`, `&subset__where=user_id%3D'${A.id}'`]) {
  const r = await req(`/api/shape?table=review&offset=-1${extra}`, { cookie: B.cookie });
  ok(!r.text.includes(A.id!) && !r.text.includes(reviewId), `B cannot read A's reviews${extra ? ` via ${decodeURIComponent(extra)}` : ""}`, String(r.status));
}
for (const t of ["user", "session", "account", "verification", "ai_request", "mail_log"]) ok((await req(`/api/shape?table=${t}&offset=-1`, { cookie: B.cookie })).status === 400, `shape refuses table ${t}`);
const wB = await req("/api/write", { cookie: B.cookie, headers: { "x-perennial-version": "9.9.9" }, body: { mutations: [{ type: "review.delete", id: reviewId }, { type: "review.insert", row: { id: reviewId, lang: "es", word_id: "x", skill: "read", grade: 1, reviewed_at: new Date().toISOString(), duration_ms: 1 } }] } });
const stillA = await req("/api/shape?table=review&offset=-1", { cookie: A.cookie });
ok(stillA.text.includes(reviewId) && /"grade":"?3/.test(stillA.text), "B cannot delete or overwrite A's review", `B write ${wB.status}`);

// 6. CSRF and request hygiene
ok((await req("/api/write", { cookie: A.cookie, headers: { origin: "https://evil.example" }, body: { mutations: [] } })).status === 403, "cross-origin write refused");
ok((await req("/api/account/delete", { cookie: A.cookie, headers: { origin: "https://evil.example" }, body: {} })).status === 403, "cross-origin account delete refused");
ok((await req("/api/account/delete", { cookie: A.cookie, raw: "a=1", headers: { "content-type": "application/x-www-form-urlencoded" } })).status === 415, "form-encoded post refused (415)");
{
  // Refused either with 413, or by the server closing the connection mid-upload.
  const r = await req("/api/write", { cookie: A.cookie, headers: { "content-type": "application/json" }, raw: JSON.stringify({ mutations: [{ type: "user_sentence.insert", row: { text: "x".repeat(600 * 1024) } }] }) }).catch((e) => ({ status: (e as { code?: string }).code ?? "error", headers: new Headers(), text: "" }));
  ok(r.status === 413 || r.status === "ECONNRESET", "oversized body refused", String(r.status));
}
ok([400, 422].includes((await req("/api/write", { cookie: A.cookie, body: { mutations: [{ type: "drop.table", sql: "drop table review" }] } })).status), "unknown mutation type refused");

// Clean up: delete both throwaway accounts.
for (const u of [A, B]) await req("/api/account/delete", { cookie: u.cookie, body: {} });
ok((await req("/api/me", { cookie: A.cookie })).status === 401, "deleted account loses access at once");

console.log(`\n${fails ? `${fails} FAILED` : "all passed"}`);
process.exit(fails ? 1 : 0);
