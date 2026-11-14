// The weekly upkeep (CLAUDE.md, "Every week"), run by .github/workflows/upkeep.yml. It needs `gh`
// and the repo's whole git history (for the files that were deleted).
//
//   bun scripts/upkeep/run.ts             open the week's issues, and clean up claims and `ready`
//   bun scripts/upkeep/run.ts --dry-run   change nothing: print what it would do
//
// 1. Opens "Cleanup sweep <date>" when none is open, and "Friction retro <date>" when none is open
//    and #656 has open frictions. Both get P2 and `ready`, so the autorun or a local agent takes them.
// 2. Ends the claims that ended by itself (scripts/autorun/lib.ts, CLAIM_HOURS), with a comment.
// 3. Takes `ready` off an issue whose named files are all gone from main, with a comment.
import { $ } from "bun";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Comment, Issue } from "../autorun/lib.ts";
import { releaseComment } from "../autorun/lib.ts";
import { LOG_ISSUE, openFrictions, renderTop } from "../friction/lib.ts";
import { all, remove, REPO, send } from "../gh.ts";
import { deadClaim, deadClaimWhy, goneComment, goneFiles, isOpen, KINDS, type Kind, retroBody, SWEEP_BODY, title } from "./lib.ts";

const ROOT = join(import.meta.dir, "../..");
const OWNER = REPO.split("/")[0];
const dry = process.argv.includes("--dry-run");
const now = new Date();
// Outside Actions (a local dry run) there is no run to link to.
const who = process.env.GITHUB_RUN_ID ? `The weekly upkeep (${process.env.GITHUB_SERVER_URL}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID})` : "The weekly upkeep (a local run)";

/** A line for the log and, in Actions, for the run's summary page. */
function say(line: string) {
  console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  // Outside Actions there is no summary page.
  if (summary) appendFileSync(summary, `${line}\n\n`);
}
/** Does the write, or in a dry run only says it. */
async function act(what: string, write: () => Promise<unknown>) {
  say(`${dry ? "Would" : "Did"}: ${what}`);
  if (!dry) await write();
}
const comments = (n: number) => all<Comment>(`repos/${REPO}/issues/${n}/comments?per_page=100`);

const open = (await all<Issue>(`repos/${REPO}/issues?state=open&per_page=100`)).filter((i) => !i.pull_request);

const bodies: Record<Kind, () => Promise<string | undefined>> = {
  "Cleanup sweep": async () => SWEEP_BODY,
  "Friction retro": async () => {
    const top = renderTop(openFrictions(await comments(LOG_ISSUE), OWNER), 10);
    return top ? retroBody(top, now) : undefined;
  },
};
for (const kind of KINDS) {
  if (isOpen(open, kind, OWNER)) {
    say(`${kind}: one is still open, so none opens this week.`);
    continue;
  }
  const body = await bodies[kind]();
  if (!body) {
    say(`${kind}: #${LOG_ISSUE} has no open frictions, so none opens this week.`);
    continue;
  }
  const t = title(kind, now);
  await act(`open "${t}" with P2 and ready`, () => send("POST", `repos/${REPO}/issues`, { title: t, body, labels: ["P2", "ready"] }));
}

const ready = open.filter((i) => i.labels.some((l) => l.name === "ready"));
for (const issue of ready) {
  const dead = deadClaim(await comments(issue.number), OWNER, now);
  if (dead) await act(`#${issue.number}: end the dead claim by ${dead.who} (${dead.at})`, () => send("POST", `repos/${REPO}/issues/${issue.number}/comments`, { body: releaseComment(who, deadClaimWhy(dead)) }));
}

const tracked = (await $`git ls-files`.cwd(ROOT).text()).trim().split("\n");
// Every path that a commit deleted or moved away; a shallow checkout would miss most of them.
const deleted = new Set((await $`git log --no-renames --diff-filter=D --name-only --format=`.cwd(ROOT).text()).split("\n").filter(Boolean));
if (!deleted.size) throw new Error("git log found no deleted files: the checkout needs the whole history (fetch-depth: 0)");
for (const issue of ready) {
  const gone = goneFiles(issue, tracked, deleted);
  if (!gone.length) continue;
  await act(`#${issue.number} ${issue.title}: remove ready, as it names only files that are gone (${gone.join(", ")})`, async () => {
    await send("POST", `repos/${REPO}/issues/${issue.number}/comments`, { body: goneComment(gone) });
    await remove(`repos/${REPO}/issues/${issue.number}/labels/ready`);
  });
}
say(`Checked ${ready.length} ready issues of ${open.length} open ones.${dry ? " (--dry-run changed nothing.)" : ""}`);
