import { expect, test } from "bun:test";
import { BOT, claimComment, type Comment, type Issue, isUpkeep, releaseComment } from "../autorun/lib.ts";
import { deadClaim, goneFiles, isOpen, KINDS, namedPaths, title } from "./lib.ts";

const OWNER = "owner";
const NOW = new Date("2026-11-16T05:17:00Z");
const issue = (number: number, o: { by?: string; title?: string; body?: string; state?: string } = {}): Issue => ({
  number,
  title: o.title ?? `issue ${number}`,
  body: o.body ?? null,
  state: o.state ?? "open",
  created_at: "2026-11-01T00:00:00Z",
  user: { login: o.by ?? OWNER },
  labels: [{ name: "ready" }],
});

test("the titles it opens are the ones the autorun trusts, when the workflow's token opens them", () => {
  for (const kind of KINDS) {
    expect(title(kind, NOW)).toBe(`${kind} 2026-11-16`);
    expect(isUpkeep(issue(1, { by: BOT, title: title(kind, NOW) }))).toBe(true);
  }
});

test("isOpen: an open issue of the kind by the workflow or the owner; not a stranger's, a closed one or another kind", () => {
  expect(isOpen([issue(1, { by: BOT, title: "Cleanup sweep 2026-11-09" })], "Cleanup sweep", OWNER)).toBe(true);
  expect(isOpen([issue(1, { title: "Cleanup sweep 2026-11-12" })], "Cleanup sweep", OWNER)).toBe(true);
  expect(isOpen([issue(1, { by: "stranger", title: "Cleanup sweep 2026-11-09" })], "Cleanup sweep", OWNER)).toBe(false);
  expect(isOpen([issue(1, { by: BOT, title: "Cleanup sweep 2026-11-09", state: "closed" })], "Cleanup sweep", OWNER)).toBe(false);
  expect(isOpen([issue(1, { by: BOT, title: "Friction retro 2026-11-09" })], "Cleanup sweep", OWNER)).toBe(false);
});

let id = 0;
const said = (at: string, body: string, by = OWNER): Comment => ({ id: ++id, created_at: at, user: { login: by }, body });

test("deadClaim: the newest unreleased claim once none is live", () => {
  const old = said("2026-11-15T10:00:00Z", claimComment("a session in x"));
  expect(deadClaim([old], OWNER, NOW)?.who).toBe("a session in x");
  // Live: younger than CLAIM_HOURS.
  expect(deadClaim([said("2026-11-16T04:00:00Z", claimComment("a session in y"))], OWNER, NOW)).toBeUndefined();
  // Released: nothing to end.
  expect(deadClaim([old, said("2026-11-15T11:00:00Z", releaseComment("x", "done"), BOT)], OWNER, NOW)).toBeUndefined();
  // A stranger's claim is no claim.
  expect(deadClaim([said("2026-11-15T10:00:00Z", claimComment("z"), "stranger")], OWNER, NOW)).toBeUndefined();
  expect(deadClaim([], OWNER, NOW)).toBeUndefined();
});

test("namedPaths: repo paths, also partial or with a line; not links, folders or plain words", () => {
  expect(namedPaths("See `web/src/garden/walker.ts:42`, ./e2e/shots.ts and web/src/ui/. Not https://x.dev/a/b.ts, CLAUDE.md or 1.5.")).toEqual(["web/src/garden/walker.ts", "e2e/shots.ts"]);
});

const TRACKED = ["web/src/garden/walker.ts", "web/e2e/shots.ts"];
const DELETED = new Set(["web/src/garden/stick.ts", "web/e2e/call.spec.ts", "web/src/garden/walker.ts"]);

test("goneFiles: only when every named file is gone from main and was in it once", () => {
  expect(goneFiles(issue(1, { body: "Fix web/src/garden/stick.ts and e2e/call.spec.ts" }), TRACKED, DELETED)).toEqual(["web/src/garden/stick.ts", "e2e/call.spec.ts"]);
  // One named file is still here: the issue may still stand.
  expect(goneFiles(issue(1, { body: "Move web/src/garden/stick.ts into walker.ts, web/src/garden/walker.ts" }), TRACKED, DELETED)).toEqual([]);
  // A file that never existed is one the issue asks for.
  expect(goneFiles(issue(1, { body: "Add scripts/notes/scan.ts" }), TRACKED, DELETED)).toEqual([]);
  // Deleted once and back again: it is here.
  expect(goneFiles(issue(1, { body: "web/src/garden/walker.ts" }), TRACKED, DELETED)).toEqual([]);
  expect(goneFiles(issue(1, { title: "No files named" }), TRACKED, DELETED)).toEqual([]);
});
