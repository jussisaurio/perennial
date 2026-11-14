// The agent runner: several Claude Code agents, each on its own issue, work them to merged PRs.
// .github/workflows/autorun.yml runs it, and docs/autonomy.md has the owner's steps. Local agents use
// next, claim and release (docs/agents.md, "Pick an issue"). It needs `gh`.
//
//   bun scripts/autorun/run.ts pick         claim the issues for this run and write `issues=[...]` to $GITHUB_OUTPUT, or say why there are none
//   bun scripts/autorun/run.ts --print      change nothing: print the candidates in pick order, and which ones a run would take and why
//   bun scripts/autorun/run.ts next         change nothing: print the issue a local agent should take
//   bun scripts/autorun/run.ts claim <n>    claim the issue for this local session, or say who holds it
//   bun scripts/autorun/run.ts release <n>  end this local session's claim
//   bun scripts/autorun/run.ts prompt <n>   write the agent's prompt
//   bun scripts/autorun/run.ts agent        run Claude Code on the prompt, within the limits
//   bun scripts/autorun/run.ts finish <n>   after the agent: if nothing merged, report on the issue and end the claim,
//                                           and after MAX_FAILURES failed runs hand the issue to the owner
import { $ } from "bun";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { all, api, remove, REPO, send } from "../gh.ts";
import {
  type AgentResult, agentsStarted, candidates, choose, CLAIM_HOURS, claimComment, claims, type Comment, dayStart, failedComment, failures, holder,
  isAlarm, type Issue, type IssueEvent, MAX_FAILURES, mergedSince, prompt, readyByOwner, releaseComment, slots, type TimelineEvent,
} from "./lib.ts";

const ROOT = join(import.meta.dir, "../..");
// The repository's owner is the one account whose issues and labels can start a run.
const OWNER = REPO.split("/")[0];

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
/** A limit from the top of autorun.yml, the one place they are set (docs/autonomy.md, "Limits"). */
const limit = (name: string) => {
  const env = (Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/autorun.yml"), "utf8")) as { env: Record<string, string> }).env;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < 0) throw new Error(`autorun.yml: ${name} is not a whole number: ${env[name]}`);
  return value;
};

/** A line for the log and, in Actions, for the run's summary page. */
function say(line: string) {
  console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  // Outside Actions (--print, next) there is no summary page.
  if (summary) appendFileSync(summary, `${line}\n\n`);
}

const files = () => {
  const dir = `${need("RUNNER_TEMP")}/autorun`;
  mkdirSync(dir, { recursive: true });
  return { prompt: `${dir}/prompt.md`, notes: `${dir}/notes.md`, result: `${dir}/result.json` };
};
const runUrl = () => `${need("GITHUB_SERVER_URL")}/${REPO}/actions/runs/${need("GITHUB_RUN_ID")}`;
/**
 * Who a local claim is for: the checkout's folder, which is the agent's own in a worktree, and the
 * Claude Code session, as two sessions can share the main checkout. Subagents share their parent's
 * session, so their worktree tells them apart.
 */
const localSession = async () =>
  `a session in ${basename((await $`git rev-parse --show-toplevel`.text()).trim())} (${need("CLAUDE_CODE_SESSION_ID").slice(0, 8)})`;
const issueNumber = (arg: string | undefined) => {
  const n = Number(arg);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`not an issue number: ${arg}`);
  return n;
};
const comments = (n: number) => all<Comment>(`repos/${REPO}/issues/${n}/comments?per_page=100`);

/** Why an issue can't be taken now, from GitHub: the owner's `ready` check that candidates() leaves out, and a live claim. */
async function blocked(issue: Issue): Promise<string | undefined> {
  if (!isAlarm(issue) && !readyByOwner(await all<IssueEvent>(`repos/${REPO}/issues/${issue.number}/events?per_page=100`), OWNER)) return `the last \`ready\` was not added by ${OWNER}`;
  const h = holder(await comments(issue.number), OWNER, new Date());
  return h && `claimed by ${h.who} at ${h.at}`;
}

/** The issues to take, at most `n`, one per area, with a verdict for each candidate looked at. */
async function chooseIssues(n: number) {
  const open = await all<Issue>(`repos/${REPO}/issues?state=open&per_page=100`);
  const tracked = (await $`git ls-files`.cwd(ROOT).text()).trim().split("\n");
  return choose(candidates(open, OWNER), { slots: n, files: tracked, blocked });
}

/**
 * Claims the issue for `who`, or says who holds it. Two agents that claim at once both see the oldest
 * live claim win (holder), so the one that lost takes its comment back.
 */
async function claim(n: number, who: string): Promise<string | undefined> {
  const before = holder(await comments(n), OWNER, new Date());
  if (before && before.who !== who) return `#${n} is claimed by ${before.who} at ${before.at}`;
  const mine = (await send("POST", `repos/${REPO}/issues/${n}/comments`, { body: claimComment(who) })).json() as Comment;
  const after = holder(await comments(n), OWNER, new Date());
  if (!after) throw new Error(`#${n}: the claim comment ${mine.id} is not in the issue's comments`);
  if (after.who === who) return undefined;
  await remove(`repos/${REPO}/issues/comments/${mine.id}`);
  return `#${n} was claimed by ${after.who} at ${after.at}, just before this claim`;
}

async function pick(print: boolean) {
  const output = (issues: number[]) => appendFileSync(need("GITHUB_OUTPUT"), `issues=${JSON.stringify(issues)}\n`);
  if (!print && process.env.AUTORUN_ENABLED !== "true") {
    say('Autorun is off: the repository variable AUTORUN_ENABLED is not "true", so no agent starts. docs/autonomy.md says how to turn it on.');
    return output([]);
  }
  // Checked here, before an issue is claimed, so a missing secret stops the run with a clear message.
  if (!print && process.env.AUTORUN_SECRETS !== "true") throw new Error("AUTORUN_ENABLED is true, but a secret is missing: AUTORUN_GH_TOKEN, and ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (docs/autonomy.md)");

  const today = dayStart(new Date());
  const started = agentsStarted(await all<Comment>(`repos/${REPO}/issues/comments?since=${today}&per_page=100`), today);
  const [perRun, perDay] = [limit("AUTORUN_AGENTS_PER_RUN"), limit("AUTORUN_AGENTS_PER_DAY")];
  const n = slots(perRun, perDay, started);
  say(`Agents started today (UTC): ${started} of AUTORUN_AGENTS_PER_DAY = ${perDay}. This run may start ${n} (AUTORUN_AGENTS_PER_RUN = ${perRun}).`);
  if (n === 0) {
    if (!print) output([]);
    return;
  }

  const verdicts = await chooseIssues(n);
  console.log("Candidates in pick order, until the run is full:");
  for (const v of verdicts) console.log(`  #${v.issue.number} [${v.issue.labels.map((l) => l.name).join(", ")}] ${v.issue.title} (${v.areas.join(", ") || "any area"}): ${v.why}`);
  const take = verdicts.filter((v) => v.take).map((v) => v.issue);
  if (!take.length) say('No agent starts: no open issue is ready for one (docs/agents.md, "Pick an issue").');
  if (print) return console.log(`A run would take ${take.map((i) => `#${i.number}`).join(", ") || "none"}. (--print changed nothing.)`);

  const claimed: number[] = [];
  for (const issue of take) {
    const lost = await claim(issue.number, runUrl());
    // A local agent claimed it since the check above. Its slot stays empty in this run.
    if (lost) say(`Skipped: ${lost}.`);
    else {
      say(`Picked #${issue.number}: ${issue.title}`);
      claimed.push(issue.number);
    }
  }
  output(claimed);
}

async function next() {
  const take = (await chooseIssues(1)).find((v) => v.take);
  console.log(take ? `#${take.issue.number} ${take.issue.title}\nClaim it before you start: bun scripts/autorun/run.ts claim ${take.issue.number}` : 'No open issue is ready for an agent (docs/agents.md, "Pick an issue").');
}

async function claimLocal(n: number) {
  const who = await localSession();
  const lost = await claim(n, who);
  if (lost) throw new Error(`${lost}. Take another issue (bun scripts/autorun/run.ts next).`);
  console.log(`#${n} is claimed by ${who} for ${CLAIM_HOURS} hours; claim it again to renew. Release it if you stop before it is done: bun scripts/autorun/run.ts release ${n}`);
}

async function release(n: number) {
  const who = await localSession();
  const h = holder(await comments(n), OWNER, new Date());
  if (!h) return console.log(`#${n} has no live claim.`);
  if (h.who !== who) throw new Error(`#${n} is claimed by ${h.who}, not by ${who}`);
  await send("POST", `repos/${REPO}/issues/${n}/comments`, { body: releaseComment(who, "it stopped before the issue was done") });
  console.log(`#${n} is released.`);
}

async function writePrompt(n: number) {
  const issue = await api<Issue>(`repos/${REPO}/issues/${n}`);
  const f = files();
  writeFileSync(f.prompt, prompt({ repo: REPO, owner: OWNER, issue, notesPath: f.notes, earlier: failures(await comments(n)) }));
  console.log(`the prompt for #${n} is in ${f.prompt}`);
}

async function agent() {
  const f = files();
  // Commits need an author. The token that pushes them is the owner's (AUTORUN_GH_TOKEN).
  await $`git config user.name ${"Claude (autorun)"}`;
  await $`git config user.email noreply@anthropic.com`;
  // A secret that is not set reaches here as an empty variable, which Claude Code may take as a
  // credential: pass only the one that has a value.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => !(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"].includes(k) && !v)));
  const claude = Bun.spawn(
    [
      "claude", "--print", "--output-format", "json", "--no-session-persistence",
      "--model", "opus",
      "--max-turns", String(limit("AUTORUN_MAX_TURNS")),
      "--max-budget-usd", String(limit("AUTORUN_MAX_BUDGET_USD")),
      // Auto mode: a classifier checks each action, and anything that would need a person is refused.
      "--permission-mode", "auto", "--permission-prompts", "none",
      // Merging is the task, so it is allowed outright; auto mode would refuse a merge nobody reviewed.
      "--allowedTools", "Bash(scripts/merge.sh *)",
      // Web pages are text from strangers.
      "--disallowedTools", "WebFetch,WebSearch",
    ],
    { stdin: Bun.file(f.prompt), stdout: "pipe", stderr: "inherit", env },
  );
  const out = await new Response(claude.stdout).text();
  const code = await claude.exited;
  // No JSON means Claude Code did not get to run (a bad flag or credential): its own words are the reason.
  if (!out.trimStart().startsWith("{")) throw new Error(`Claude Code printed no result (exit ${code}):\n${out}`);
  writeFileSync(f.result, out);
  const result = JSON.parse(out) as AgentResult;
  say(`Claude Code ended with \`${result.subtype}\` after ${result.num_turns} turns ($${result.total_cost_usd.toFixed(2)}).`);
  // An error result (the turn or budget limit) has no last message.
  if (result.result) say(result.result);
  process.exit(code);
}

async function finish(n: number) {
  const f = files();
  const issue = await api<Issue>(`repos/${REPO}/issues/${n}`);
  const said = await comments(n);
  const started = claims(said, OWNER).filter((c) => c.who === runUrl()).at(-1)?.at;
  if (!started) throw new Error(`#${n} has no claim by this run, but the pick claims each issue before its job starts`);
  if (issue.state === "closed") return say(`#${n} is closed: the run did its job.`);

  const merged = mergedSince(await all<TimelineEvent>(`repos/${REPO}/issues/${n}/timeline?per_page=100`), OWNER, started);
  if (merged.length) {
    // A merged part of a larger issue: the issue stays ready for the next part.
    const done = `it merged ${merged.map((p) => `#${p}`).join(", ")}, and the issue stays open for its next part`;
    await send("POST", `repos/${REPO}/issues/${n}/comments`, { body: releaseComment(runUrl(), done) });
    return say(`#${n}: ${done}. The claim is released.`);
  }

  // The alarm issue has no `ready` label: its failures count from when it was opened.
  const since = readyByOwner(await all<IssueEvent>(`repos/${REPO}/issues/${n}/events?per_page=100`), OWNER) ?? issue.created_at;
  const count = failures(said).filter((c) => c.created_at > since).length + 1;
  const body = failedComment({
    runUrl: runUrl(),
    agentStep: need("AGENT_OUTCOME"),
    result: existsSync(f.result) ? (JSON.parse(readFileSync(f.result, "utf8")) as AgentResult) : undefined,
    notes: existsSync(f.notes) ? readFileSync(f.notes, "utf8") : undefined,
    count,
  });
  await send("POST", `repos/${REPO}/issues/${n}/comments`, { body });
  if (count >= MAX_FAILURES) {
    await send("POST", `repos/${REPO}/issues/${n}/labels`, { labels: ["needs-owner"] });
    if (issue.labels.some((l) => l.name === "ready")) await remove(`repos/${REPO}/issues/${n}/labels/ready`);
  }
  say(`#${n}: no merged PR. Reported on the issue (failed run ${count} of ${MAX_FAILURES}); the report ends the claim.`);
  process.exitCode = 1;
}

const [command, arg] = process.argv.slice(2);
if (command === "pick" || command === "--print") await pick(command === "--print");
else if (command === "next") await next();
else if (command === "claim") await claimLocal(issueNumber(arg));
else if (command === "release") await release(issueNumber(arg));
else if (command === "prompt") await writePrompt(issueNumber(arg));
else if (command === "agent") await agent();
else if (command === "finish") await finish(issueNumber(arg));
else throw new Error(`unknown command ${command}: use pick, --print, next, claim, release, prompt, agent or finish`);
