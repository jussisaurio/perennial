// The alarm: one P0 issue that says when main is red, when production is behind main,
// or when the live check failed after a deploy. .github/workflows/alarm.yml runs it
// (docs/DEPLOY.md, "The alarm"). It needs `gh`.
//
//   bun scripts/alarm/run.ts                  open, update or close the alarm issue
//   bun scripts/alarm/run.ts --live-check     the same, and run scripts/live-check.ts first (after a deploy)
//   bun scripts/alarm/run.ts --print [run]    change nothing: print the issue text. With a CI run id,
//                                             print it as if that run were main's latest finished run.
import { $ } from "bun";
import { api, REPO, send } from "../gh.ts";
import { behindSection, carriedLiveSection, type Commit, failedTests, healthSection, issueBody, landedOnMain, liveSection, type Red, redSection, TITLE } from "./lib.ts";

const PROD = "https://playperennial.com";
const args = process.argv.slice(2);
const print = args.includes("--print");
const pinnedRun = print ? args[args.indexOf("--print") + 1] : undefined;

type Run = { id: number; run_number: number; head_sha: string; html_url: string; created_at: string };
type Job = { id: number; name: string; html_url: string; conclusion: string | null; steps: { name: string; conclusion: string | null }[] };
type Issue = { number: number; title: string; body: string; pull_request?: unknown };

/** The red section, or nothing when main's latest finished CI run is green. Cancelled runs do not count as finished. */
async function ci(): Promise<string | undefined> {
  const latest = async (query: string) => (await api<{ workflow_runs: Run[] }>(`repos/${REPO}/actions/workflows/ci.yml/runs?branch=main&per_page=1&${query}`)).workflow_runs.at(0);
  const red = pinnedRun ? await api<Run>(`repos/${REPO}/actions/runs/${pinnedRun}`) : await latest("status=failure");
  if (!red) return undefined;
  const green = await latest(pinnedRun ? `status=success&created=%3C${red.created_at}` : "status=success");
  if (!green) throw new Error("no green CI run on main to compare with");
  if (green.run_number > red.run_number) return undefined;

  const { jobs } = await api<{ jobs: Job[] }>(`repos/${REPO}/actions/runs/${red.id}/jobs?per_page=100&filter=latest`);
  const failed: Red["jobs"] = [];
  for (const job of jobs.filter((j) => j.conclusion === "failure")) {
    // A log that cannot be read (expired, or GitHub is down) must not stop the alarm: the issue says so instead.
    const log = await $`gh api repos/${REPO}/actions/jobs/${job.id}/logs`.nothrow().quiet();
    failed.push({
      name: job.name,
      url: job.html_url,
      steps: job.steps.filter((s) => s.conclusion === "failure").map((s) => s.name),
      tests: log.exitCode === 0 ? failedTests(log.stdout.toString()) : { unreadable: log.stderr.toString().trim() },
    });
  }
  const pages = (await $`gh api --paginate --slurp repos/${REPO}/compare/${green.head_sha}...${red.head_sha}?per_page=100`.json()) as { commits: Commit[] }[];
  return redSection({
    runUrl: red.html_url,
    sha: red.head_sha,
    jobs: failed,
    green: { sha: green.head_sha, runUrl: green.html_url },
    landed: landedOnMain(pages.flatMap((p) => p.commits), red.head_sha),
  });
}

/** The release that production runs, or the reason it could not be read. */
async function prodRelease(): Promise<{ release: string } | { error: string }> {
  try {
    // 10 s: /health answers in well under a second, and a hung connection must not hold the job.
    const res = await fetch(`${PROD}/health`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { error: `status ${res.status}` };
    return { release: ((await res.json()) as { release: string }).release };
  } catch (e) {
    // No answer at all is a state the issue must report, not a crash of the alarm.
    return { error: String(e) };
  }
}

/** Behind means: production does not have a commit that was on main an hour ago. Newer merges may still be deploying. */
async function behind(release: string): Promise<string | undefined> {
  const anHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const [old] = await api<Commit[]>(`repos/${REPO}/commits?sha=main&per_page=1&until=${anHourAgo}`);
  if (old.sha === release) return undefined;
  const { ahead_by } = await api<{ ahead_by: number }>(`repos/${REPO}/compare/${release}...${old.sha}`);
  return ahead_by > 0 ? behindSection(release, old.sha, ahead_by) : undefined;
}

async function liveCheck(release: string): Promise<string | undefined> {
  const run = await $`bun ${new URL("../live-check.ts", import.meta.url).pathname} ${PROD}`.nothrow().quiet();
  if (run.exitCode === 0) return undefined;
  const fails = run.stdout.toString().split("\n").filter((l) => l.startsWith("FAIL"));
  // No FAIL line means the script itself stopped: then its last error lines are the cause.
  return liveSection(release, fails.length ? fails.join("\n") : run.stderr.toString().trim().split("\n").slice(-10).join("\n"));
}

const open = (await api<Issue[]>(`repos/${REPO}/issues?state=open&labels=P0&per_page=100`)).find((i) => i.title === TITLE && !i.pull_request);
const prod = await prodRelease();
const sections = [
  await ci(),
  "error" in prod ? healthSection(prod.error) : await behind(prod.release),
  args.includes("--live-check") ? await liveCheck("error" in prod ? "unknown" : prod.release) : open && "release" in prod ? carriedLiveSection(open.body, prod.release) : undefined,
].filter((s) => s !== undefined);
const body = issueBody(sections);

if (print) {
  console.log(sections.length ? body : "No alarm: main is green and production is not behind.");
} else if (sections.length === 0) {
  if (open) {
    await send("POST", `repos/${REPO}/issues/${open.number}/comments`, { body: "Main's latest finished CI run is green and production has caught up with main. Closing." });
    await send("PATCH", `repos/${REPO}/issues/${open.number}`, { state: "closed" });
    console.log(`closed #${open.number}`);
  } else console.log("no alarm");
} else if (!open) {
  await send("POST", `repos/${REPO}/issues`, { title: TITLE, labels: ["P0"], body });
  console.log("opened the alarm issue");
} else if (open.body !== body) {
  // The issue text is the state now; the comment tells watchers that it changed.
  await send("PATCH", `repos/${REPO}/issues/${open.number}`, { body });
  await send("POST", `repos/${REPO}/issues/${open.number}/comments`, { body: `The alarm changed. Now:\n\n${sections.join("\n\n")}` });
  console.log(`updated #${open.number}`);
} else console.log(`#${open.number} is unchanged`);
