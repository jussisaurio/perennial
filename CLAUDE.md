# Working on Perennial

How we write and merge code here. It applies to every session and every agent. The product, architecture and deploy steps are in README.md, DESIGN.md and docs/.

## Code standard

- **Fix the cause, not the symptom.** If you don't know why something fails, find out before you change code. Reproduce it first, in the user's real setup: the same browser, timezone, clock and data.
- **No silent fallbacks.** A default, `??`, `||`, `catch {}`, retry or timeout must have a reason, written in a short comment. Do not hide a case that "should not happen": let it fail loudly, or handle it on purpose. Remember that `"" ?? x` is `""`.
- **No speculative code.** Handle only the cases that exist. No options, flags, layers or "just in case" timers for situations nobody has seen.
- **One way to do each thing.** Before you add a helper, search for one that already exists. A constant or rule lives in one place.
- **Delete, don't keep.** No commented-out code, unused exports, or dead branches. Git keeps the history.
- **Match the surrounding code**: its naming, comment density and idioms. Comments say *why*, in short, plain English.
- **Small diffs.** One PR does one thing. A refactor is not mixed with a behaviour change.

## Tests

- A test for a fix must **fail without the fix**. Run it against the old code once to check.
- Test behaviour, not the code's own structure. A test that passes whether or not the bug exists is deleted, not kept as "coverage".
- **A failing CI test is never just re-run.** Find the cause (read the log, check whether the retry failed the same way, reproduce locally) and fix it in its own PR.
- Tests that depend on time pin the clock (`page.clock.setFixedTime`); tests that depend on layout pin the viewport.

## Before merge: an independent review

Every PR gets a review from a fresh agent that did not write the code. It gets the diff (`gh pr diff <n>`) and this file. It reports must-fix and optional findings with file:line and a failing scenario. The author fixes each finding, or writes in the PR why not.

How deep, by risk:

| PR touches | Review |
|---|---|
| Docs or tests only | One quick pass |
| App code (web/, server/) | A normal review: correctness, then the code standard above |
| Auth, sync, writes, data model, migrations, security, money (AI spend) | A deep review, and a second agent checks each finding before it is acted on |

Then merge when CI is green: `scripts/merge-when-green.sh <pr>` in the background (add `--git` for PRs that touch .github/workflows). Do not watch CI in the foreground.

## Every week or so: a cleanup sweep

Per-PR reviews catch local problems, not slow drift across files. Once a week, or after a busy run of features, agents sweep the code (split by directory) for duplication, dead code, needless fallbacks and tangled modules. These are refactors with no behaviour change, in small PRs, reviewed like any other.

## Product rules that code reviews also check

- **Simple English** in all UI text and docs: short sentences, common words. Many learners do not speak English as a first language.
- **Choices predict their outcome.** For side-by-side buttons or options, the labels alone must tell a first-time user how the results differ.
- **Whimsy is quiet.** Small, discoverable details. Never streaks, shaming or confetti, and never in the way of learning.
- **Privacy:** logs and analytics carry ids, counts and short values. Never emails, sign-in codes, request bodies or the learner's text.

## Workflow

- Work in the main checkout on a branch from an up-to-date `main`. Use separate worktrees only for agents that run in parallel.
- Every substantial piece of work has a GitHub issue with a priority label (P0–P3). The PR says `Closes #n`.
