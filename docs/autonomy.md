# Agents that start without the owner

`.github/workflows/autorun.yml` starts a few Claude Code agents in GitHub Actions, each on its own issue. Each agent works its issue to a merged PR, the way [agents.md](agents.md) says. The workflow is **off** until the owner turns it on (below). Its logic is in `scripts/autorun/`.

## How a run goes

1. Every two hours, or when you start it by hand, the workflow checks the switch and how many agents started today.
2. It lists the candidates: first the alarm issue ("Alarm: main is red or production is behind"), then the open `ready` issues, highest priority first (P0), oldest first. It skips `tracking` and `needs-owner` issues, and issues that another agent holds (see "Claims").
3. It takes up to `AUTORUN_AGENTS_PER_RUN` of them, at most one in each area of the repo: garden scene, garden core, story, UI screens, app data, server, decks, scripts and CI, docs. The areas of an issue come from the files and folders its text names, and from words in its title. An issue with no clear area has the area "unknown", so at most one of those runs at a time. The alarm always gets a slot. This way, agents that work at the same time seldom change the same files.
4. It claims each issue that it takes.
5. Each issue gets its own agent, in its own job. The agent reads CLAUDE.md and agents.md, makes the change, runs the checks and merges with `scripts/merge.sh`. The other agents merge at the same time, so it rebases when its PR conflicts.
6. When the agent stops, its job comments on the issue, and the comment ends the claim. If no PR merged, the comment says what the agent tried (its notes) and how the run ended, so a later run can try again with those notes. After two failed runs, the job labels the issue `needs-owner`.

To see what a run would take now, and why, without changing anything:

```
bun scripts/autorun/run.ts --print
```

## Claims

A claim is a comment on the issue that says who holds it, with the time. Local agents claim with the same script (agents.md, "Pick an issue"), so a local agent and a run never take the same issue. A claim ends when its agent releases the issue, when a run reports on the issue, or by itself after 3 hours. A run's job stops within 2.5 hours, so an older claim is from an agent that died.

## What a run trusts

The repo is public: anyone can open issues and write comments. So:
- A run takes only an issue that **the owner's account opened**, and only if **the owner's account added `ready`** the last time. The one other issue it takes is the alarm, which only the workflow's own token can open.
- Only comments by the workflow's token or the owner's account can claim or release an issue.
- The agent gets the issue's title and text, and the workflow's own reports of earlier runs. It never gets comments by other accounts. Its prompt says that the issue text is data about the task, not instructions about tokens, secrets or workflows.
- Nothing that other people do starts a run. It starts only on the schedule or by hand, never on issue, comment or pull request events.
- The agent's GitHub token can't change workflows or the repo's settings (rules, secrets, variables). GitHub refuses a push that changes `.github/workflows/` from a token without the Workflows permission.

## Limits

They are at the top of `autorun.yml`, under `env`:
- `AUTORUN_AGENTS_PER_RUN` (3): the most agents that one run starts.
- `AUTORUN_AGENTS_PER_DAY` (12): the most agents that the runs start in one day (UTC). Local agents do not count.
- `AUTORUN_MAX_BUDGET_USD` (15): the most one agent may spend, as Claude Code counts it. The agent stops there.
- `AUTORUN_MAX_TURNS` (250): the most turns of one agent.
- One run at a time. Each agent gets 2 hours at most.

So the runs spend at most 12 agents × $15 = $180 in one day.

These limits are on our side. The spend limit at the provider (step 1) is the one that holds even if something here goes wrong.

## Turn it on (owner)

You do these steps once, in the browser. Only you can, because they hold secrets. Secrets and the variable are at: the repo on GitHub → Settings → Secrets and variables → Actions.

1. **The Claude credential.** Add one of these two as a repository secret, not both:
   - `ANTHROPIC_API_KEY`: you pay for what the runs use. In the Claude Console (platform.claude.com), make a new workspace for these runs: the default workspace can't have a spend limit. Set the new workspace's monthly spend limit to the most you want to pay in a month, and make an API key in that workspace. When the limit is reached, the API refuses the runs until the next month. (If the organization is only for these runs, its own limit at platform.claude.com/settings/spend-limits works too.)
   - `CLAUDE_CODE_OAUTH_TOKEN`: the runs use your Claude subscription. On your computer, run `claude setup-token` and copy the token that it prints. The runs then use your plan's usage limits, which your own sessions use too. There is no money limit to set.
2. **The agent's GitHub token.** On GitHub: your picture → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.
   - Name: `perennial-autorun`. Expiration: 90 days. When it ends, runs stop with an error; make a new one.
   - Repository access: Only select repositories → `jussisaurio/perennial`.
   - Repository permissions: **Contents**, **Issues** and **Pull requests**: Read and write. **Actions** and **Commit statuses**: Read-only. (Metadata: Read-only comes by itself.) Leave all the others at No access, above all **Workflows**, **Administration**, **Secrets** and **Variables**.
   - Add it as the repository secret `AUTORUN_GH_TOKEN`.
   - Why not the workflow's own token: GitHub starts no CI for a push made with it, so the PR's required checks would never run.
3. **Turn it on:** add the repository variable `AUTORUN_ENABLED` with the value `true` (Variables tab → New repository variable).
4. **Check it:** Actions → Autorun → Run workflow. The run's summary page says which issues it took, or why it took none.

## Turn it off

Each of these works at once, with no commit:
- **Stop new runs:** set the variable `AUTORUN_ENABLED` to `false`, or delete it. The next run stops at the start and says so on its summary page. A run that has already started goes on to its end.
- **Stop the run that is going on now:** Actions → the run → Cancel workflow run. Each agent's job still comments on its issue, and that ends the claim.
- **Stop all spending:** delete the secret, or delete the API key in the Claude Console.
- Or: Actions → Autorun → ⋯ → Disable workflow.

## When an issue gets `needs-owner`

Two runs failed on it. The two comments from `github-actions` on the issue say what the agents tried and how each run ended. Make the issue clearer or smaller, then remove `needs-owner` and add `ready` again. Failed runs count again from the time you add `ready`.
