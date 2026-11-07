# Brief for agents

Every agent reads this first, along with CLAUDE.md. Your prompt gives the task: the issue, the time box, and anything special. This file gives the rest, so prompts stay short.

## Setup
- Branch from an up-to-date `origin/main`. Other agents merge in parallel: if your PR conflicts, rebase onto origin/main, re-run your checks and force-push with lease.
- **Scratch files:** in the session scratchpad your prompt names, under a subfolder named after your task. Never at its top level, because other agents share it.
- **E2E ports:** in a worktree under `.claude/worktrees/`, `web/playwright.config.ts` picks a port offset from the worktree's path, so parallel agents don't clash. Set `E2E_PORT_OFFSET` only to override that. If a port is still in use, the run fails loudly at start (no server is reused): set another multiple of 10.
- **Postgres** is one shared container (`docker compose up -d` from the main checkout). Never touch the `pg-sandbox` container.
- Run only the specs you need, not the whole suite.

## Checks
- **Light testing:** typecheck, lint, and the tests closest to your change. Unit tests run with `bun run test`. A test for a fix must fail without the fix.
- Never run prettier (there is no config, and it rewraps files).
- Pin the clock and viewport in tests that depend on them.
- **UI changes:** before merging, take screenshots on phone and desktop, light and dark, and look at them yourself. Nothing misaligned or cheap-looking.
- **Machine load:** many agents share one machine. If an e2e test times out, run `uptime` and rerun only that spec with `--workers=1`. If it fails alone, it's a real failure: fix it. If it fails only under load, say so in the PR. Never just rerun it until it's green.

## PR and merge
- One PR does one thing. It says `Closes #n`, or `Refs #n` when it is one part of an issue.
- **Some tasks need no code change:** the bug is already gone, or the issue is wrong. Then close the issue with a comment that gives the evidence, and open no PR.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- The PR body ends with `Reviewed: none`, a blank line, then `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Merge right after your checks, without waiting for CI: `scripts/merge.sh <pr>`. It merges, checks the state is MERGED, and deletes the remote branch. It works from any worktree.
- **Migrations are expand, then contract:** never drop a table or column in the same release that stops using it. Railway runs migrations while the old version is still serving. #604 broke this rule and caused #614. The full rule is in [DEPLOY.md](DEPLOY.md).

## Report
Your final message gives:
- the PR number, or the issue you closed;
- what changed, for the learner or the owner;
- anything left for later, filed as issues;
- **Friction:** a few bullets on what was annoying or slow, and what would have made it easier (tools, repo setup, docs, the prompt). These go to #656.
- **Least sure about:** one thing.
