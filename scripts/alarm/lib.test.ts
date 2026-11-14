import { expect, test } from "bun:test";
import { carriedLiveSection, failedTests, issueBody, landedOnMain, liveSection, redSection } from "./lib.ts";

// Lines copied from main's red CI runs of 2026-11-08 (runs 42507561014 and 42474935816).
const log = [
  "2026-11-08T17:59:40.1000000Z   ✓  17 [desktop] › e2e/demo.spec.ts:60:1 › demo story points: the first point (3.1s)",
  "2026-11-08T17:59:49.2180429Z   ✘  18 [desktop] › e2e/demo.spec.ts:80:1 › demo story points: the stile's point opens the garden with its words known (22.9s)",
  "2026-11-08T18:00:13.4984264Z   ✘  22 [desktop] › e2e/demo.spec.ts:80:1 › demo story points: the stile's point opens the garden with its words known (retry #1) (23.1s)",
  '2026-11-08T11:16:11.7615950Z ##[error]Expected: "1 Sept"',
  "2026-11-08T11:16:11.7622307Z (fail) shortDay says the date as toLocaleDateString does [7.01ms]",
  "2026-11-08T11:16:15.6178336Z 1 tests failed:",
  "2026-11-08T11:16:15.6178644Z (fail) shortDay says the date as toLocaleDateString does [7.01ms]",
  "2026-11-08T18:00:34.8148279Z ##[error]Process completed with exit code 1.",
].join("\r\n");

test("failedTests lists each failing Playwright and bun test once, without retry and time", () => {
  expect(failedTests(log)).toEqual([
    "[desktop] › e2e/demo.spec.ts:80:1 › demo story points: the stile's point opens the garden with its words known",
    "shortDay says the date as toLocaleDateString does",
  ]);
});

const commit = (sha: string, parents: string[], message = sha) => ({ sha, parents: parents.map((p) => ({ sha: p })), commit: { message } });

test("landedOnMain follows first parents from the head and leaves out the branches' own commits", () => {
  // green ← m1 ← m2 (head); b1 and b2 are the merged branches' commits.
  const commits = [commit("b1", ["green"]), commit("m1", ["green", "b1"]), commit("b2", ["m1"]), commit("m2", ["m1", "b2"])];
  expect(landedOnMain(commits, "m2").map((c) => c.sha)).toEqual(["m2", "m1"]);
});

test("the red section names the jobs, the tests, the last green commit and what landed since", () => {
  const text = redSection({
    runUrl: "https://example.test/run/2",
    sha: "a5f3d1b5aaaa",
    jobs: [
      { name: "End-to-end (Chromium 1/8)", url: "https://example.test/job/1", steps: ["Run e2e"], tests: ["[desktop] › e2e/demo.spec.ts:80:1 › the stile"] },
      { name: "Dependency audit and static analysis", url: "https://example.test/job/2", steps: ["Semgrep"], tests: [] },
      { name: "Decks", url: "https://example.test/job/3", steps: [], tests: { unreadable: "HTTP 410" } },
    ],
    green: { sha: "dac76c88bbbb", runUrl: "https://example.test/run/1" },
    landed: [commit("a5f3d1b5aaaa", ["x"], "Merge pull request #970 from o/fix\n\nStory: re-fit")],
  });
  expect(text).toContain('- **End-to-end (Chromium 1/8)** ([log](https://example.test/job/1)), step "Run e2e"\n  - `[desktop] › e2e/demo.spec.ts:80:1 › the stile`');
  expect(text).toContain("  - No failing test names in the log.");
  expect(text).toContain("  - The alarm could not read this job's log: HTTP 410");
  expect(text).toContain("Last green commit on main: `dac76c88`");
  expect(text).toContain("- `a5f3d1b5` Merge pull request #970 from o/fix");
  expect(text).not.toContain("Story: re-fit");
});

test("a live-check failure stays in the issue only while production runs the release it failed on", () => {
  const body = issueBody(["## CI on main is red\n\nx", liveSection("abc123", "FAIL  HSTS")]);
  expect(carriedLiveSection(body, "abc123")).toBe(liveSection("abc123", "FAIL  HSTS"));
  expect(carriedLiveSection(body, "def456")).toBeUndefined();
  expect(carriedLiveSection(issueBody(["## CI on main is red\n\nx"]), "abc123")).toBeUndefined();
});
