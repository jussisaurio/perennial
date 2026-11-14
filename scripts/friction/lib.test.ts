import { expect, test } from "bun:test";
import { BOT, type Comment } from "../autorun/lib.ts";
import { fixedLine, openFrictions, renderTop, reportLine } from "./lib.ts";

const OWNER = "owner";
let id = 0;
const said = (body: string, o: { by?: string; at?: string } = {}): Comment => ({ id: ++id, body, created_at: o.at ?? "2026-11-14T10:00:00Z", user: { login: o.by ?? OWNER } });

test("reportLine: one line in the fixed format, the area as a short lower-case tag", () => {
  expect(reportLine(" Shots ", "-g with ^ found\nno tests", "10")).toBe("friction: shots | 10 min | -g with ^ found no tests");
});

test("reportLine and fixedLine refuse what the ranking could not use", () => {
  expect(() => reportLine("a very long area name that is a sentence", "x", "1")).toThrow(/short tag/);
  expect(() => reportLine("gh", "x", "ten")).toThrow(/whole number/);
  expect(() => reportLine("gh", "x", "-5")).toThrow(/whole number/);
  expect(() => reportLine("gh", "  ", "5")).toThrow(/say what/);
  expect(() => reportLine("gh", "x".repeat(301), "5")).toThrow(/300/);
  expect(() => fixedLine("gh", "PR 12")).toThrow(/#1043/);
});

test("openFrictions: grouped by area, the most minutes lost first, then the most reports, then the latest", () => {
  const open = openFrictions(
    [
      said(reportLine("gh", "no output", "5")),
      said(`Notes from a run:\n${reportLine("shots", "^ pattern", "20")}\n${reportLine("gh", "needs --repo", "5")}`),
      said(reportLine("e2e ports", "clash", "10")),
      said(reportLine("zsh", "glob", "10"), { at: "2026-11-13T00:00:00Z" }),
    ],
    OWNER,
  );
  expect(open.map((o) => [o.area, o.reports.length, o.minutes])).toEqual([["shots", 1, 20], ["gh", 2, 10], ["e2e ports", 1, 10], ["zsh", 1, 10]]);
});

test("openFrictions: a fixed line closes the reports of its area before it, not after", () => {
  const open = openFrictions([said(reportLine("gh", "a", "5")), said(fixedLine("gh", "#12")), said(reportLine("gh", "b", "3"))], OWNER);
  expect(open.map((o) => [o.area, o.reports.map((r) => r.what)])).toEqual([["gh", ["b"]]]);
});

test("openFrictions: only the owner's account and the workflow's token count, and free text is ignored", () => {
  const open = openFrictions(
    [said(reportLine("gh", "a", "5"), { by: "stranger" }), said(fixedLine("shots", "#1"), { by: "stranger" }), said(reportLine("shots", "b", "5"), { by: BOT }), said("The shots friction: lots of it")],
    OWNER,
  );
  expect(open.map((o) => o.area)).toEqual(["shots"]);
});

test("renderTop: a table of the worst, then each area's latest three notes; nothing when none is open", () => {
  const comments = [1, 2, 3, 4].map((n) => said(reportLine("gh", `note ${n}`, "1"), { at: `2026-11-1${n}T00:00:00Z` }));
  const text = renderTop(openFrictions([...comments, said(reportLine("zsh", "glob", "2"))], OWNER), 1);
  expect(text).toContain("| 1 | gh | 4 | 4 | 2026-11-14 |");
  expect(text).not.toContain("zsh");
  expect(text).not.toContain("note 1");
  expect(text).toContain("- 2026-11-14, 1 min: note 4");
  expect(renderTop([], 10)).toBe("");
});
