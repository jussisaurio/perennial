// The weekly upkeep's pure parts (CLAUDE.md, "Every week"): the issues it opens, and which `ready`
// issues and claims it cleans up. run.ts does the I/O, and .github/workflows/upkeep.yml runs it.
import { BOT, CLAIM_HOURS, type Claim, type Comment, holder, type Issue, unended } from "../autorun/lib.ts";

/** The two issues each week. Their titles are `<kind> <date>`, the pattern that autorun's isUpkeep trusts. */
export const KINDS = ["Cleanup sweep", "Friction retro"] as const;
export type Kind = (typeof KINDS)[number];
export const title = (kind: Kind, now: Date) => `${kind} ${now.toISOString().slice(0, 10)}`;

/**
 * True when an issue of this kind is still open, so that a week with an unfinished one opens no
 * second. Only issues by the workflow's token or the owner count: anyone can open an issue with
 * this title, and that must not stop the week's issue.
 */
export const isOpen = (issues: Issue[], kind: Kind, owner: string) =>
  issues.some((i) => i.state === "open" && !i.pull_request && i.title.startsWith(`${kind} `) && (i.user.login === BOT || i.user.login === owner));

export const SWEEP_BODY = `The weekly cleanup sweep (CLAUDE.md, "Every week"). Reviews of each PR catch local problems, not slow drift across files. This sweep looks for that drift.

Split the code by folder: \`web/src/garden\`, \`web/src/ui\`, the rest of \`web/src\`, \`web/e2e\` and \`web/perf\`, \`server\` and \`contract\`, \`scripts\`. If you can start agents, give each one a folder. In each folder, look for:

- **Duplication:** two helpers, constants or rules for one thing (CLAUDE.md, "One way to do each thing").
- **Dead code:** unused exports, branches that no input reaches, commented-out code. \`bun run deadcode <report.md>\` (it runs the whole e2e suite) and knip help.
- **Needless fallbacks:** a default, \`??\`, \`||\`, \`catch {}\`, retry or timeout with no comment that says why (CLAUDE.md, "No silent fallbacks").
- **Tangled modules:** a file that does several jobs, or modules that reach into each other.

Rules:

- Refactors only: no change in behaviour. A behaviour change you find becomes its own issue.
- Small PRs: one per finding or per folder, each with \`bun run check\`.
- Do the biggest wins first, and stop at your time box. File the rest as issues with a priority.
- When you are done, comment the list of PRs here and close this issue.`;

export const retroBody = (top: string, now: Date) => `The weekly friction retro (CLAUDE.md, "Every week"). Agents log what slows them with \`bun scripts/friction.ts add\` (docs/agents.md, "Report"). Below are the open frictions, worst first.

**Fix the top three.** For each:

- Find the cause first. Then prefer a guard in code or a script over a sentence in docs: a check that fails and says the fix, or a script that does the step.
- One small PR each.
- After it merges, run \`bun scripts/friction.ts fixed "<area>" "#<pr>"\`. If main already has the fix, run \`fixed\` with the PR that fixed it. If only the owner can fix it, file an issue with \`needs-owner\` and run \`fixed\` with that issue.

When the three are done, comment the PRs here and close this issue.

${top}

From \`bun scripts/friction.ts top\` on ${now.toISOString().slice(0, 10)}.`;

/** The claim that ended by itself: the newest claim that no one released, when none is live any more. */
export function deadClaim(comments: Comment[], owner: string, now: Date): Claim | undefined {
  return holder(comments, owner, now) ? undefined : unended(comments, owner).at(-1);
}
export const deadClaimWhy = (c: Claim) =>
  `the claim by ${c.who} at ${c.at} had already ended by itself after ${CLAIM_HOURS} hours. Its agent stopped without releasing it`;

/** Words in an issue that look like a path in the repo: `web/src/garden/walker.ts`, `e2e/shots.ts:30`. A link is a page elsewhere. */
export function namedPaths(text: string): string[] {
  const words = text.replace(/https?:\/\/\S+/g, "").split(/[^\w.@/-]+/);
  const paths = words.map((w) => w.replace(/^(\.{0,2}\/)+/, "").replace(/\.+$/, "")).filter((w) => w.includes("/") && /\.[a-z]+$/i.test(w));
  return [...new Set(paths)];
}

const isIn = (path: string, files: Iterable<string>) => {
  for (const f of files) if (f === path || f.endsWith(`/${path}`)) return true;
  return false;
};

/**
 * The files a `ready` issue names that were in the repo once and are gone now, when it names no
 * file that is still here. Then its work is likely done or moved, and an agent would start from a
 * stale text. A path that never existed is a file the issue asks for, so it never counts as gone.
 */
export function goneFiles(issue: Issue, tracked: string[], deleted: Set<string>): string[] {
  const paths = namedPaths(`${issue.title}\n${issue.body ?? ""}`);
  if (paths.some((p) => isIn(p, tracked))) return [];
  return paths.filter((p) => isIn(p, deleted));
}

export const goneComment = (gone: string[]) =>
  `The weekly upkeep removed \`ready\`: this issue names files that are no longer on main (${gone.map((g) => `\`${g}\``).join(", ")}), and no file that is. Its work may be done, or the code moved. To make it ready again, update the text to name the files as they are now, then add \`ready\` (.github/workflows/upkeep.yml).`;
