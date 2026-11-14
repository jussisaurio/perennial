// The alarm's pure parts: what it reads from a CI log and how it writes the issue.
// The calls to GitHub and to production are in run.ts.

export const TITLE = "Alarm: main is red or production is behind";

export type Commit = { sha: string; parents: { sha: string }[]; commit: { message: string } };
type FailedJob = { name: string; url: string; steps: string[]; tests: string[] | { unreadable: string } };
export type Red = { runUrl: string; sha: string; jobs: FailedJob[]; green: { sha: string; runUrl: string }; landed: Commit[] };

/**
 * The names of the failing tests in one job's log. It matches two kinds of line:
 * - Playwright's list reporter: `  ✘  18 [desktop] › e2e/demo.spec.ts:80:1 › the title (retry #1) (22.9s)`
 * - bun test: `(fail) the title [7.01ms]`
 * A test that failed and then passed on a retry is also listed. Each name is listed once.
 */
export function failedTests(log: string): string[] {
  const names = new Set<string>();
  for (const line of log.split("\n")) {
    const m = /✘\s+\d+ (.+?)(?: \(retry #\d+\))? \([\d.]+(?:ms|s|m)\)\s*$/.exec(line) ?? /^\S+ \(fail\) (.+?)(?: \[[\d.]+ms\])?\s*$/.exec(line);
    if (m) names.add(m[1]);
  }
  return [...names];
}

/** The commits that landed on main itself (merges and direct pushes), newest first: from `head`, each commit's first parent. */
export function landedOnMain(commits: Commit[], head: string): Commit[] {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const out: Commit[] = [];
  for (let c = bySha.get(head); c; c = bySha.get(c.parents[0].sha)) out.push(c);
  return out;
}

const short = (sha: string) => sha.slice(0, 8);
const firstLine = (message: string) => message.split("\n", 1)[0];

export function redSection(red: Red): string {
  const jobs = red.jobs.map((j) => {
    const step = j.steps.length ? `, step ${j.steps.map((s) => `"${s}"`).join(", ")}` : "";
    const tests = "unreadable" in j.tests ? [`The alarm could not read this job's log: ${j.tests.unreadable}`] : j.tests.length ? j.tests.map((t) => `\`${t}\``) : ["No failing test names in the log. Read the log for the cause."];
    return [`- **${j.name}** ([log](${j.url}))${step}`, ...tests.map((t) => `  - ${t}`)].join("\n");
  });
  return [
    "## CI on main is red",
    `The latest finished [CI run](${red.runUrl}) on main failed, at \`${short(red.sha)}\`. Railway does not deploy a red main.`,
    "Failing jobs and tests:",
    jobs.join("\n"),
    `Last green commit on main: \`${short(red.green.sha)}\` ([run](${red.green.runUrl})). Commits that landed on main after it, newest first:`,
    red.landed.map((c) => `- \`${short(c.sha)}\` ${firstLine(c.commit.message)}`).join("\n"),
  ].join("\n\n");
}

export const behindSection = (release: string, mainAnHourAgo: string, aheadBy: number) =>
  `## Production is behind main\n\nProduction runs \`${short(release)}\` (the release in \`/health\`). One hour ago main was at \`${short(mainAnHourAgo)}\`, which is ${aheadBy} commits ahead of production.`;

export const healthSection = (error: string) =>
  `## The alarm could not read production's release\n\n\`GET /health\` failed: ${error}. So this run could not tell if production is behind main.`;

// The live check runs only after a deploy. Its failure stays in the issue until production runs another
// release, so the section carries the release it failed on, and the hourly run reads it back from the issue.
const LIVE = /<!-- live-check (\S+) -->[\s\S]*?<!-- \/live-check -->/;

export const liveSection = (release: string, output: string) =>
  `<!-- live-check ${release} -->\n## The live check failed after a deploy\n\n\`bun scripts/live-check.ts\` failed against production (release \`${short(release)}\`):\n\n\`\`\`\n${output}\n\`\`\`\n<!-- /live-check -->`;

/** The live-check section of an alarm issue, if it is about the release that production still runs. */
export function carriedLiveSection(body: string, release: string): string | undefined {
  const m = LIVE.exec(body);
  return m && m[1] === release ? m[0] : undefined;
}

export const issueBody = (sections: string[]) =>
  `${sections.join("\n\n")}\n\n---\n\`.github/workflows/alarm.yml\` keeps this issue up to date and closes it when main is green and production has caught up (docs/DEPLOY.md, "The alarm").`;
