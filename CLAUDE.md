# Working on Perennial

How we write and merge code here. It applies to every session and every agent. The product, architecture and deploy steps are in README.md, DESIGN.md and docs/.

## Code standard

- **Fix the cause, not the symptom.** If you don't know why something fails, find out before you change code. Reproduce it first, in the user's real setup: the same browser, timezone, clock and data.
- **No silent fallbacks.** A default, `??`, `||`, `catch {}`, retry or timeout must have a reason, written in a short comment. Do not hide a case that "should not happen". Let it fail loudly, or handle it on purpose. `??` keeps an empty string and `||` replaces it: pick the one you mean.
- **Do not silence the checks.** No `@ts-ignore`, `as any`, lint-disable comments, `test.skip` or loosened assertions, unless a short comment says why the check is wrong here. Reviewers flag each new one.
- **No speculative code.** Handle only the cases that exist. No options, flags, layers or "just in case" timers for situations nobody has seen.
- **One way to do each thing.** Before you add a helper, search for one that already exists. A constant or rule lives in one place.
- **Delete, don't keep.** No commented-out code, unused exports, or dead branches. Git keeps the history.
- **Match the surrounding code**: its naming, comment density and idioms. Comments say *why*, in short, plain English.
- **Small diffs.** One PR does one thing. A refactor is not mixed with a behaviour change.
- **Effect for I/O** (server, wire contract, later the app's data layer), with the patterns in [docs/effect.md](docs/effect.md). Not in pure code, React or the garden.

## Tests

- A test for a fix must **fail without the fix**. Run it against the old code once to check.
- Test behaviour, not the code's own structure. A test that passes whether or not the bug exists is deleted, not kept as "coverage".
- **A failing CI test is never just re-run.** Find the cause: read the log, check if a retry fails the same way, reproduce it locally. If a change caused it, fix it in the next PR. If it is an older flaky test, fix it in its own PR.
- Tests that depend on time pin the clock: `page.clock.setFixedTime` in e2e, and a fixed `now` passed in for unit tests. Tests that depend on layout pin the viewport.

## Before merge

We are pre-alpha and the owner is the only user: ship fast. A temporary break costs nothing.

- **Every PR**, including auth, sync, the data model and migrations: the author's own checks (typecheck, lint, the tests that cover the change) are enough. Merge right away; do not wait for CI. For a non-trivial change, ask one fresh agent for a quick review, but don't wait for it: put its findings in a follow-up PR.
- **Garden changes that touch movement or interaction** are the one exception:
  1. Before building, write or update the feature's section in [docs/garden-play.md](docs/garden-play.md). Describe in prose how it plays: what the learner sees, what they can and must do, and what happens when they do each thing. A fresh Opus agent reviews that text for UX friction, and you fix the design before you write code.
  2. Before merge, a fresh Opus agent playtests the change (docs/agents.md, "Playtest") against that text, and you fix what it finds.
  A screenshot and a passing test do not show how a thing feels to play.
- The PR description ends with `Reviewed: <none | quick | playtest>`.

Deck content (decks/) also follows the proofreader process in docs/decks.md.

Then merge: `scripts/merge.sh <pr>` (it works from any worktree and deletes the branch). CI still runs on `main`, and Railway does not deploy a red `main` (Wait for CI, docs/DEPLOY.md), so a red `main` is the first thing to fix: nothing deploys until it is green again. `scripts/merge-when-green.sh` remains for when you do want to wait. Do not watch CI in the foreground.

## Every week: a cleanup sweep

Per-PR reviews catch local problems, not slow drift across files. Once a week, open a P2 issue "Cleanup sweep <date>" and run it. Agents split the code by directory and look for duplication, dead code, needless fallbacks and tangled modules. These are refactors with no behaviour change, in small PRs.

## Product rules that code reviews also check

- **Simple English** in all UI text and docs: short sentences, common words. Many learners do not speak English as a first language.
- **Choices predict their outcome.** For side-by-side buttons or options, the labels alone must tell a first-time user how the results differ.
- **Accessibility:** follow [docs/accessibility.md](docs/accessibility.md): a choice never looks like an action, and a state is never shown by color alone.
- **The garden is physical.** You go places by walking. No teleports, no auto-walks, no button that moves you. A thing that looks like you can climb it, you can; a thing that looks open is open; a way that is shut looks shut. A button is for acting on a thing in reach (read, raise, sit), never for travel.
- **Whimsy is quiet.** Small, discoverable details. Never streaks, shaming or confetti, and never in the way of learning.
- **Privacy:** logs and analytics carry ids, counts and short values. Never emails, sign-in codes, request bodies or the learner's text.

## Workflow

- Work in the main checkout on a branch from an up-to-date `main`. Use separate worktrees only for agents that run in parallel; `scripts/clean-worktrees.sh` removes finished ones.
- Agents read [docs/agents.md](docs/agents.md): setup, checks, merge and the report. Agent prompts give only the task.
- Every substantial piece of work has a GitHub issue with a priority label (P0–P3). The PR says `Closes #n`.
