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
- **A failing CI test is never just re-run.** Find the cause: read the log, check if a retry fails the same way, reproduce it locally. If this PR caused it, fix it here. If it is an older flaky test, fix it in a separate PR first. Then start `scripts/merge-when-green.sh` again.
- Tests that depend on time pin the clock: `page.clock.setFixedTime` in e2e, and a fixed `now` passed in for unit tests. Tests that depend on layout pin the viewport.

## Before merge: a review sized to the risk

We are pre-alpha: ship fast, and keep heavy process for mistakes that are hard to undo.

- **Most PRs** (app code, garden, UI, tooling, tests, docs): CI green and the author's own checks are enough when the author is reasonably sure the change is correct and it cannot corrupt or lose data. For a non-trivial change, ask one fresh agent for a quick review, but don't wait for it: merge when CI is green, and put its findings in a follow-up PR.
- **Careful review** for changes that can corrupt or lose data, or weaken security: data migrations, the data model and sync merge rules, auth, security, and AI spend once AI is on in production. A fresh agent reviews the diff (`gh pr diff <n>`), the linked issue and this file, and reports must-fix findings with file:line and a failing scenario. A second agent checks each must-fix before it is acted on. These PRs wait for their review.
- The PR description ends with `Reviewed: <none | quick | careful>`, and for a careful review `, <n> must-fix fixed, <n> declined (reasons above)`.

Deck content (decks/) also follows the proofreader process in docs/decks.md.

Then merge when CI is green: `scripts/merge-when-green.sh <pr>` in the background (add `--git` for PRs that touch .github/workflows). Do not watch CI in the foreground.

## Every week: a cleanup sweep

Per-PR reviews catch local problems, not slow drift across files. Once a week, open a P2 issue "Cleanup sweep <date>" and run it. Agents split the code by directory and look for duplication, dead code, needless fallbacks and tangled modules. These are refactors with no behaviour change, in small PRs.

## Product rules that code reviews also check

- **Simple English** in all UI text and docs: short sentences, common words. Many learners do not speak English as a first language.
- **Choices predict their outcome.** For side-by-side buttons or options, the labels alone must tell a first-time user how the results differ.
- **Whimsy is quiet.** Small, discoverable details. Never streaks, shaming or confetti, and never in the way of learning.
- **Privacy:** logs and analytics carry ids, counts and short values. Never emails, sign-in codes, request bodies or the learner's text.

## Workflow

- Work in the main checkout on a branch from an up-to-date `main`. Use separate worktrees only for agents that run in parallel.
- Every substantial piece of work has a GitHub issue with a priority label (P0–P3). The PR says `Closes #n`.
