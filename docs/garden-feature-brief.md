# Shared brief for garden feature agents (Perennial, 2026-10-17)

The user's goal now: **"focus heavily on implementing a lot of fun features, that's the primary goal… ramp up the velocity."** The app is pre-alpha. Ship fast and well.

## Read first
- Repo CLAUDE.md (code standard; **the new lighter review rule**). DESIGN.md "Garden code" (Part = rendering technique; the host owns every order table: TAP_PRIORITY, LABEL_PRIORITY, reportReach; tick allocates nothing; behaviour gets time only from the frame/conditions; seeded hashes, never Math.random/Date in behaviour).
- GitHub #335: the roadmap, the verbs, the cut and its rules. Also #324 (kinds as data), #334 (one action button, no instruction text), #351/#353 (Leave it out, the latest feature: copy its patterns for reach, action button, garden_action, art, e2e).
- web/src/garden/* and web/src/ui/GardenWalk.tsx, useGardenScene.ts.

## Product rules
- **Fun to *do*:** hands-on verbs, surprise, a payoff, a reason to do it twice.
- **Quiet whimsy:** no streaks, scores, FOMO, confetti, nags, timers or currency. Nothing withers or is lost.
- **Never asks the learner to practise.** More words make more material to play with; never gate a verb behind a word count.
- **No instruction text in the walk (#334).** The world shows what can be done. The one action button is icon-only, but its accessible name says the action.
- **Phones:** one thumb, sound off. Anything that relies on sound has a visual half.
- **Screen readers:** each verb works through the action button with a name, plus a short status line.
- **Simple English** for any text. Course-language words get `lang` and are never quizzed.
- **Privacy:** `garden_action` counts verbs by name only.
- **Art:** match the retro pixel style in visitorArt.ts / leaveArt.ts / textures.ts. Use shared atlases where they fit.

## Process (velocity)
1. File your own GitHub issue (labels `garden` + P2) with a short design and why it's fun. Branch from up-to-date main.
2. Build it in small commits. Tests: unit tests for pure logic with a pinned `now`; one e2e for the main moment (import `test` from "./test"; pin the clock and viewport; pin `garden-quality` to low). Garden specs keep passing on desktop and iPhone.
3. Open a PR with "Closes #n". End the body with `Reviewed: none` (the orchestrator may start a non-blocking quick review) and `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
4. **Merge it yourself:** run `scripts/merge-when-green.sh <pr>` from the main checkout (/Users/jussi/projects/ankee) as a background command and wait for its result.
   - If it says the PR conflicts: rebase onto origin/main, resolve, re-run the checks, force-push with lease, and run the script again. Other agents merge in parallel, so expect this.
   - If CI fails: find the cause; never just re-run.
   - **Careful-review exception:** if your change touches a migration, the data model or sync merge rules, auth or security, do not merge. Report to the orchestrator for a careful review.
5. **Shared infra:** Postgres + Electric are shared (`docker compose up -d` from the main checkout). Use your own `E2E_PORT_OFFSET`: multiply the number given in your prompt by 10 (e.g. 401 → 4010). Offsets one apart clash, because the e2e setup uses consecutive ports per offset. Run only the specs you need, not the whole suite.
6. **Report back** when merged: the PR number, what a learner can now do, and anything for later.

## Machine load (many agents run at once)
About 9 feature agents share one machine. An e2e timeout under load is usually load, not your code. Before you chase it:
1. Run `uptime`.
2. Rerun only that spec with `--workers=1`.
3. If it passes alone and fails only under load, note that in the PR and move on. If it fails alone, it's real: fix it.

CI is the judge. A test that times out in CI gets a real fix (a wait on the right condition, not a longer timeout).

## Scratch files
The scratchpad folder is shared by every agent. Put your temporary files under a subfolder named after your feature (e.g. `scratchpad/<feature>/`), never at the top level, so agents don't overwrite each other's files.
