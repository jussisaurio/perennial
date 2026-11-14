// The agent runner: one Claude Code agent takes one issue and works it to a merged PR.
// .github/workflows/autorun.yml runs it, and docs/autonomy.md has the owner's steps. It needs `gh`
// and GITHUB_REPOSITORY.
//
//   bun scripts/autorun/run.ts pick        pick the issue: write `issue=<n>` to $GITHUB_OUTPUT, or say why there is none
//   bun scripts/autorun/run.ts --print     change nothing: print the issues in pick order, and which one a run would take
//   bun scripts/autorun/run.ts start <n>   claim the issue and write the agent's prompt
//   bun scripts/autorun/run.ts agent       run Claude Code on the prompt, within the limits
//   bun scripts/autorun/run.ts finish <n>  after the agent: if nothing merged, report on the issue, remove the claim,
//                                          and after MAX_FAILURES failed runs hand the issue to the owner
import { $ } from "bun";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type AgentResult, candidates, claimComment, claims, type Comment, dayStart, failedComment, failures, isAlarm, type Issue, type IssueEvent, MAX_FAILURES, mergedSince, prompt, readyByOwner, type TimelineEvent } from "./lib.ts";

const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
const REPO = need("GITHUB_REPOSITORY");
// The repository's owner is the one account whose issues and labels can start a run.
const OWNER = REPO.split("/")[0];

const api = async <T>(path: string) => (await $`gh api ${path}`.json()) as T;
const all = async <T>(path: string) => ((await $`gh api --paginate --slurp ${path}`.json()) as T[][]).flat();
const send = (method: "POST" | "DELETE", path: string, payload: object) => $`gh api -X ${method} ${path} --input - < ${new Response(JSON.stringify(payload))}`.quiet();

/** A line for the log and, in Actions, for the run's summary page. */
function say(line: string) {
  console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  // Outside Actions (--print) there is no summary page.
  if (summary) appendFileSync(summary, `${line}\n\n`);
}

const files = () => {
  const dir = `${need("RUNNER_TEMP")}/autorun`;
  mkdirSync(dir, { recursive: true });
  return { prompt: `${dir}/prompt.md`, notes: `${dir}/notes.md`, result: `${dir}/result.json` };
};
const runUrl = () => `${need("GITHUB_SERVER_URL")}/${REPO}/actions/runs/${need("GITHUB_RUN_ID")}`;
const issueNumber = (arg: string | undefined) => {
  const n = Number(arg);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`not an issue number: ${arg}`);
  return n;
};

/** The first issue a run may take, after the owner check that candidates() leaves to the caller. With `print`, every candidate and its verdict. */
async function firstIssue(print: boolean): Promise<Issue | undefined> {
  const open = await all<Issue>(`repos/${REPO}/issues?state=open&per_page=100`);
  let first: Issue | undefined;
  for (const issue of candidates(open, OWNER)) {
    const ok = isAlarm(issue) || readyByOwner(await all<IssueEvent>(`repos/${REPO}/issues/${issue.number}/events?per_page=100`), OWNER) !== undefined;
    if (ok && !print) return issue;
    if (print) console.log(`#${issue.number} [${issue.labels.map((l) => l.name).join(", ")}] ${issue.title}: ${!ok ? `skip, the last \`ready\` was not added by ${OWNER}` : first ? "next" : "a run would take this one"}`);
    if (ok && !first) first = issue;
  }
  return first;
}

async function pick(print: boolean) {
  if (!print && process.env.AUTORUN_ENABLED !== "true") {
    say('Autorun is off: the repository variable AUTORUN_ENABLED is not "true", so no agent starts. docs/autonomy.md says how to turn it on.');
    return;
  }
  // Checked here, before an issue is claimed, so a missing secret stops the run with a clear message.
  if (!print && process.env.AUTORUN_SECRETS !== "true") throw new Error("AUTORUN_ENABLED is true, but a secret is missing: AUTORUN_GH_TOKEN, and ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (docs/autonomy.md)");

  const today = dayStart(new Date());
  const runsToday = claims(await all<Comment>(`repos/${REPO}/issues/comments?since=${today}&per_page=100`)).filter((c) => c.created_at >= today).length;
  if (print) console.log(`Agent runs started today (UTC): ${runsToday}\nCandidates, best first:`);
  else {
    const perDay = Number(need("AUTORUN_RUNS_PER_DAY"));
    if (runsToday >= perDay) return say(`No agent starts: ${runsToday} runs started today (UTC), and the limit is AUTORUN_RUNS_PER_DAY = ${perDay}.`);
  }

  const issue = await firstIssue(print);
  if (!issue) say("No agent starts: no open issue is ready for one (docs/agents.md, \"Pick an issue\").");
  else if (print) console.log(`A run would take #${issue.number}. (--print changed nothing.)`);
  else {
    say(`Picked #${issue.number}: ${issue.title}`);
    appendFileSync(need("GITHUB_OUTPUT"), `issue=${issue.number}\n`);
  }
}

async function start(n: number) {
  const issue = await api<Issue>(`repos/${REPO}/issues/${n}`);
  // Assigned is claimed (docs/agents.md, "Pick an issue"), for the owner's own agents too.
  await send("POST", `repos/${REPO}/issues/${n}/assignees`, { assignees: [OWNER] });
  await send("POST", `repos/${REPO}/issues/${n}/comments`, { body: claimComment(runUrl()) });
  const comments = await all<Comment>(`repos/${REPO}/issues/${n}/comments?per_page=100`);
  const f = files();
  writeFileSync(f.prompt, prompt({ repo: REPO, owner: OWNER, issue, notesPath: f.notes, earlier: failures(comments) }));
  console.log(`claimed #${n}; the prompt is in ${f.prompt}`);
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
      "--max-turns", need("AUTORUN_MAX_TURNS"),
      "--max-budget-usd", need("AUTORUN_MAX_BUDGET_USD"),
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
  const comments = await all<Comment>(`repos/${REPO}/issues/${n}/comments?per_page=100`);
  const started = claims(comments).at(-1)?.created_at;
  if (!started) throw new Error(`#${n} has no claim comment, but this step runs only after the claim`);
  if (issue.state === "closed") return say(`#${n} is closed: the run did its job.`);

  const unassign = () => send("DELETE", `repos/${REPO}/issues/${n}/assignees`, { assignees: [OWNER] });
  const merged = mergedSince(await all<TimelineEvent>(`repos/${REPO}/issues/${n}/timeline?per_page=100`), OWNER, started);
  if (merged.length) {
    // A merged part of a larger issue: the issue stays ready for the next part.
    await unassign();
    return say(`#${n} is still open, and the run merged ${merged.map((p) => `#${p}`).join(", ")}. The claim is removed.`);
  }

  // The alarm issue has no `ready` label: its failures count from when it was opened.
  const since = readyByOwner(await all<IssueEvent>(`repos/${REPO}/issues/${n}/events?per_page=100`), OWNER) ?? issue.created_at;
  const count = failures(comments).filter((c) => c.created_at > since).length + 1;
  const body = failedComment({
    runUrl: runUrl(),
    agentStep: need("AGENT_OUTCOME"),
    result: existsSync(f.result) ? (JSON.parse(readFileSync(f.result, "utf8")) as AgentResult) : undefined,
    notes: existsSync(f.notes) ? readFileSync(f.notes, "utf8") : undefined,
    count,
  });
  await send("POST", `repos/${REPO}/issues/${n}/comments`, { body });
  await unassign();
  if (count >= MAX_FAILURES) {
    await send("POST", `repos/${REPO}/issues/${n}/labels`, { labels: ["needs-owner"] });
    if (issue.labels.some((l) => l.name === "ready")) await $`gh api -X DELETE repos/${REPO}/issues/${n}/labels/ready`.quiet();
  }
  say(`#${n}: no merged PR. Reported on the issue (failed run ${count} of ${MAX_FAILURES}) and removed the claim.`);
  process.exitCode = 1;
}

const [command, arg] = process.argv.slice(2);
if (command === "pick" || command === "--print") await pick(command === "--print");
else if (command === "start") await start(issueNumber(arg));
else if (command === "agent") await agent();
else if (command === "finish") await finish(issueNumber(arg));
else throw new Error(`unknown command ${command}: use pick, --print, start, agent or finish`);
