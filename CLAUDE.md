# Working on Perennial

How we write and merge code here. It applies to every session and every agent. What we build, and what we don't, is in [docs/direction.md](docs/direction.md). The architecture and deploy steps are in README.md, DESIGN.md and docs/.

## Code standard

- **Fix the cause, not the symptom.** If you don't know why something fails, find out before you change code. Reproduce it first, in the user's real setup: the same browser, timezone, clock and data.
- **No silent fallbacks.** A default, `??`, `||`, `catch {}`, retry or timeout must have a reason, written in a short comment. Do not hide a case that "should not happen". Let it fail loudly, or handle it on purpose. `??` keeps an empty string and `||` replaces it: pick the one you mean.
- **Do not silence the checks.** No `@ts-ignore`, `as any`, lint-disable comments, `test.skip` or loosened assertions, unless a short comment says why the check is wrong here.
- **No speculative code.** Handle only the cases that exist. No options, flags, layers or "just in case" timers for situations nobody has seen. The owner is the only user, so write no code to carry old clients or unsent writes across a change: just switch. Two things still need care: learner progress on the server (docs/direction.md, "Never break progress") and migrations (docs/agents.md).
- **One way to do each thing.** Before you add a helper, search for one that already exists. A constant or rule lives in one place.
- **A mode is one state.** When a thing can be in one of several modes (seated, walking, gliding; which card is open), model it as one discriminated union with one function that changes it, not as several booleans or nullables. Then a wrong mix can't be written (#877).
- **Delete, don't keep.** No commented-out code, unused exports, or dead branches. Git keeps the history.
- **Match the surrounding code**: its naming, comment density and idioms. Comments say *why*, in short, plain English.
- **Small diffs.** One PR does one thing. A refactor is not mixed with a behaviour change. Small, low-risk fixes may share one PR, with one commit and one `Closes #n` for each issue. Auth, sync, the data model and AI spending stay in their own PRs.
- **Effect for I/O** (server, wire contract, later the app's data layer), with the patterns in [docs/effect.md](docs/effect.md). Not in pure code, React or the garden.

## Tests

- A test for a fix must **fail without the fix**. Run it against the old code once to check.
- Test behaviour, not the code's own structure. A test that passes whether or not the bug exists is deleted, not kept as "coverage".
- **A failing CI test is never just re-run.** Find the cause: read the log, check if a retry fails the same way, reproduce it locally. If a change caused it, fix it in the next PR. If it is an older flaky test, fix it in its own PR.
- Tests that depend on time pin the clock: `page.clock.setFixedTime` in e2e, and a fixed `now` passed in for unit tests. Tests that depend on layout pin the viewport.

## Before merge

We are pre-alpha and the owner is the only user. Breaking something is fine. Producing trash is not. So the process is light, and the bar on the result is high.

- **Every PR**, including auth, sync, the data model and migrations: your own checks come first (docs/agents.md, "Checks"). No other agent reviews it. For UI, you look at the screenshots yourself. Then merge right away: GitHub merges the PR when two fast CI jobs pass (about a minute), and does not wait for the e2e tests.
- **A new way to move or interact in the garden** is the one exception. It has two gates (docs/agents.md, "Play description review" and "Playtest"): a fresh agent reviews the text in [docs/garden-play.md](docs/garden-play.md) before you build, and a fresh agent playtests the change before you merge. A small change skips both gates: one element, copy, art, or a tweak to an interaction that exists. It still keeps its garden-play.md text and tests true. #976 measures how often these agent judges find real problems. By that number each gate is kept, changed or dropped.
- The PR description ends with `Reviewed: <none | playtest>`.

Deck content (decks/) also follows the proofreader process in docs/decks.md.

Then merge: `scripts/merge.sh <pr>` (it works from any worktree and deletes the branch). `main` has two required checks, the CI jobs "Typecheck, lint, unit tests, build" and "Decks (schema, up to date, compatibility, replay)": no PR merges until both pass on it. The script asks GitHub to merge when they pass, and waits. It ends with `MERGED`, or with `NOT merged`, the failed check and a link: then fix the PR and run it again. The e2e tests are not required. They run after the merge, on `main`, and Railway does not deploy a red `main` (Wait for CI, docs/DEPLOY.md). When `main` is red, one agent fixes it and other merges go on. Do not watch that run in the foreground.

## Every week: a cleanup sweep

Open a P2 issue "Cleanup sweep <date>" and run it. Agents split the code by directory and look for duplication, dead code, needless fallbacks and tangled modules. These are refactors with no behaviour change, in small PRs.

## Product rules that code reviews also check

- **Simple English** in all UI text and docs: short sentences, common words. Many learners do not speak English as a first language.
- **Choices predict their outcome.** For side-by-side buttons or options, the labels alone must tell a first-time user how the results differ. A button's label starts with a verb that says what the tap does ("Practice more").
- **Accessibility:** follow [docs/accessibility.md](docs/accessibility.md): a choice never looks like an action, and a state is never shown by color alone.
- **The garden is physical.** One set of physics everywhere: if there is ground and nothing solid in the way, you can walk there; if something is solid, you can't. You go places by walking (keys, or tapping a spot to walk there around obstacles). No teleports, no tracks, no button that moves you. Anything that looks climbable is climbable; anything that looks open is open. A way that is shut, or the world's edge, is shut by a thing you can see (brambles, a hedge, water), never an invisible wall, so don't show ground we can't let you reach. A button acts on a thing in reach (read, raise, sit), never for travel. The one exception is access: the screen-reader-only Next plant button moves you, because a blind learner can't steer in 3D.
- **Whimsy is quiet.** Small, discoverable details. Never streaks, shaming or confetti, and never in the way of learning.
- **Privacy:** logs and analytics carry ids, counts and short values. Never emails, sign-in codes, request bodies or the learner's text.

## Workflow

- Work in the main checkout on a branch from an up-to-date `main`. Use separate worktrees only for agents that run in parallel; `scripts/clean-worktrees.sh` removes finished ones.
- Agents read [docs/agents.md](docs/agents.md): setup, checks, merge and the report. Agent prompts give only the task.
- Every substantial piece of work has a GitHub issue with a priority label (P0–P3). The PR says `Closes #n`. A finding or idea you do not act on now also becomes an issue, so it is not lost in a chat or a report. Close issues that are done or stale, with a comment that says why.
- **What to do next:** with no other task, take the next `ready` issue by the pick rule in [docs/agents.md](docs/agents.md), "Pick an issue".
- **You decide.** Build any fix or improvement without asking, and choose which features to build, inside docs/direction.md. Decide product and UX details yourself: walk through the learner's moments (the first day, back after a week, wants more) and ask what they want there. Never hold finished work for the owner's approval. Stop and ask only before a thing outside the code that is hard to undo: deleting production data, spending money, or publishing a secret.
