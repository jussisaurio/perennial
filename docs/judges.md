# How good are the agent judges?

A back-test from 2026-11-14 (#976, part of #987). It covers UI look and garden feel only. Story and audio are not tested here.

**The question:** when an agent judge looks at screenshots of this app, how often does it find the problems the owner found? And how often does it raise an alarm on a version that is fixed?

**The short answer.** The numbers below are from the 4 held-out cases, 2 runs each (8 runs).

| | Rubric A (today's wording) | Rubric B (checklist) |
| --- | --- | --- |
| Runs that named the owner's problem | 4 of 8 | 6 of 8 |
| Cases found in both runs | 2 of 4 | 3 of 4 |
| Fixed versions the judge would still stop | 5 of 8 runs | 7 of 8 runs |
| "Serious" findings on fixed versions | 9 | 11 |
| ...true, and a real defect | 5 | 4 |
| ...made by our own capture | 3 | 3 |
| ...true in the picture, but nobody thinks it stops a merge | 1 | 4 |

So: a screenshot judge finds about half to three quarters of what the owner found, **when we point it at the right screen**. It cannot be a merge gate yet, because it also stops most fixed versions. This is 4 cases. Read the numbers as a rough size, not as a measurement.

## Method

1. **Cases.** We read every closed issue that reports an owner finding about look or feel, and kept the ones where a still picture or a short row of pictures can show the problem. The list is [judges/cases.json](judges/cases.json): issue, fix PR, commit before the fix, merge commit, screen, the steps of each picture, and what the owner saw.
2. **Captures.** For each case we checked out the commit before the fix and the merge commit, ran the app with demo data (`?demo=es:<n>`) and a fixed clock, and took pictures at 1280x720 and 390x844. The Playwright spec is [judges/capture.spec.ts.txt](judges/capture.spec.ts.txt). It is a `.txt` file because it runs only on old commits, so today's typecheck and knip must not read it. To run it, copy it to `web/e2e/bt.spec.ts` on the old commit, start from an empty e2e database, and set `BT_CASE` and `BT_OUT`.
3. **Blind judges.** Each judge was a fresh Opus agent. It got one folder with a random name. The folder held the pictures of one version of one case, `steps.txt` (what each picture shows and which input came before it), the product rules from CLAUDE.md ([judges/rules.md](judges/rules.md)) and a rubric. It did not know which version it had, or that a known problem existed. Each version was judged 2 times per rubric.
4. **Rubrics.** Rubric A ([judges/rubric-a.md](judges/rubric-a.md)) uses the words our docs use today: "nothing misaligned or cheap-looking… premium". Rubric B ([judges/rubric-b.md](judges/rubric-b.md)) is a checklist. We wrote it from the owner's complaints in the tuning half only.
5. **Split.** We fixed the split before any judge ran. Tuning: #650, #678, #711, #770. Held-out: #677, #710, #749, #779. Rubric B ran on the held-out half only.
6. **Scoring.** A run *named* the problem when its list has a line about the same thing the owner saw, at any severity. A line about the same control for a different reason does not count. For fixed versions, we checked each "serious" line against the picture by eye.

Every judge's full list is in [judges/results.json](judges/results.json).

## Cases

| Case | Issue | What the owner saw | Half | A named it | B named it |
| --- | --- | --- | --- | --- | --- |
| signs | #650 | Signs in the world are in English | tuning | 2 of 2, only as minor | not run |
| settings | #678 | You can't tell which option is on | tuning | 2 of 2 | not run |
| card | #711 | A jokey line on the plant card | tuning | 2 of 2, only as minor | not run |
| climb | #770 | A button walks you over the stile; your first move snaps you back | tuning | 2 of 2 | not run |
| quality | #677 | A "Normal quality" button should not be there | held-out | 0 of 2 | 0 of 2 |
| nextplant | #710 | "Next plant" buttons jump you from plant to plant | held-out | 2 of 2 | 2 of 2 |
| stileshut | #749 | The stile goes nowhere, and nothing shows it is shut | held-out | 2 of 2 | 2 of 2 |
| door | #779 | The door's line "Locked." is in English | held-out | 0 of 2 | 2 of 2 |

Rubric A on all 8 cases: 12 of 16 runs named the problem, and 8 of 16 called it serious.

The 2 runs of one version nearly always agreed on the owner's problem. They agreed less on the other findings: for example, one run of `nextplant` after the fix had 2 serious lines and the other had none.

### Words from the judges

- door, rubric B: "The 'Locked.' speech bubble drawn over the door in the 3D world is in English, but this is a Spanish course."
- door, rubric A: nothing about language. Only remarks on fonts and spacing.
- stileshut, rubric A: "The stile looks climbable but…" the learner "has not gone over the stile onto the hill".
- quality, rubric B: "'Normal quality' is a setting (a state) drawn as a normal action button." True, but it is not the owner's point. The owner's point was that the button should not exist.
- card, rubric A: "'A good word. Very sure of itself.' is an idiom" (minor).

## What no judge found

- **A control that should not exist** (#677). Both rubrics looked at the button and judged its shape. Neither asked if the learner should have this choice at all. This is a product call, and the judges had no rule for it.
- **Tone, as a reason to stop** (#711). The judges saw the jokey line and called it minor.
- **In-world language, unless told** (#650, #779). With rubric A the English text was missed (door) or minor (signs). With rubric B's question 3 it was found both times. The judge sees it only when the rubric asks.

## What this test could not see

We rejected 26 issues. The big groups:

- **Motion and timing** (#647, #682, #689, #761, #764, #911): a flash, a slow load, a jerky move. Still pictures do not show them.
- **State over many days** (#802), and **audio or behaviour with nothing to see** (#716, #739, #762, #774, #776).
- **Old infrastructure** (#245, #310, #419, #500): the old commit does not run without services we removed.
- **Not found by the owner** (#625, #636, #673, #726, #753, #838, #861, #869): an agent found them.
- **Capture failed or no time** (#858, #862). For #858 the picture did not show the lantern's floating head.

So the test covers the easy kind: a problem you can see in one picture. The owner's motion and timing findings are untested.

## Reasons to trust the numbers less

- **We pointed the judge at the right screen.** A real review must also choose where to look. Real recall is lower than these numbers.
- **Today's rules know the answer for some cases.** The rules say "no button that moves you" and that Next plant is for screen readers only. Both were written after #710 and #770. This helps the judge on `nextplant` and `climb`, and it makes every judge flag "Next plant" on every older picture.
- **Only screenshots.** We did not test the live playtest agent (docs/agents.md, "Playtest").
- **The tuning half taught the held-out half.** #650 (tuning) and #779 (held-out) are the same kind of problem. Rubric B's win on `door` is partly this.
- **One capture mistake.** In the fixed `stileshut` version the stile is gone, but `steps.txt` still said "steps". All 4 runs reported "no steps visible". We left it in and counted it as capture-made.
- **8 cases, not the 10 to 15 we aimed for.**

## The best rubric so far

Rubric B. Use it when the screen is known and the question is "what did we miss here". Do not use its "serious" lines as a merge gate.

```text
You are checking screenshots of one screen or spot of an app before a change is merged. You stand in for the app's owner, who is its only tester and is hard to please.

Folder: {DIR}
It holds PNG screenshots, `steps.txt` (what each PNG shows and which input was given before it) and `rules.md` (the product's rules). Read `rules.md` and `steps.txt`, then look at every PNG yourself with the Read tool. Use nothing else: do not read any other file on this machine, do not run git, do not search the web, do not start other agents. You are judging only what is in this folder.

Do not ask "does this look fine at a glance". Be a first-time learner who meets this screen with no help, and go through these questions one by one. Each comes from a problem the owner found after agents had said the screen was fine.

1. **Every control.** For each button, switch and option: can you tell from looking what it will do? For a setting: can you tell which option is on now, without relying on colour, and can you tell a choice (a state) from an action (a thing a tap does)?
2. **Every line of text in the UI.** Does it say one plain, useful thing? Flag any line that is a joke, an aside or a mood, or that a learner could not act on or might misread.
3. **Every piece of text drawn inside the 3D world** (signs, plaques, speech or thought lines over things). It must be in the language the learner is studying, not English. English is only for the UI around the world (buttons, cards, hints).
4. **Every object in the 3D world.** Does it rest on what it should rest on? Flag anything that floats, is detached from its support, sinks, or cuts through another thing.
5. **Every action** (when steps.txt says a button was pressed). Is there a clear, visible result that makes sense for that thing? Flag an action that seems to do nothing, or whose result looks broken.
6. **Movement** (when there are several frames). Compare where the player stands from frame to frame with the inputs in steps.txt. Did the player move while no walk key was held? Did a button carry the player somewhere? Did the player jump to another place, or get put back? Any of these breaks "the garden is physical".
7. Only then: alignment, spacing, contrast, clipping, overlap, and anything that looks cheap.

Report the problems you find, most serious first. It is fine to report none: do not invent problems to fill the list. Reply with only this list, one line per problem:

`<serious|minor> | <file name(s)> | <the problem, in one or two sentences>`

Mark a problem `serious` only if you would stop the merge for it. If you see no problem, reply `none`.
```

## What follows from this

- A checklist built from past owner findings beats "look for anything cheap". Each new owner finding should add a question.
- The judge's "serious" is not the owner's "serious". On fixed versions, rubric B called an icon-only button serious in 4 of 8 runs. Use the list as input for a person or a second agent, not as a gate.
- The judges also found true things the owner had not reported. The clearest: holding W into the brambles puts the camera inside them (6 of 6 runs on 2 cases). These are in #999.
- Product calls ("this should not exist") have no judge. Either the rule is written down, as "no button that moves you" now is, or the owner still decides.
