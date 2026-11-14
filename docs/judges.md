# How good are the agent judges?

A back-test from 2026-11-14 (#976, part of #987). The first part covers UI look and garden feel. Two more tests are at the end: the story judges in [Story](#story), and a judge that compares two versions of a screen in ["Which of two is better?"](#which-of-two-is-better-1004). Audio is not tested.

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

## Story

The same day, the same question for the story loop ([story-loop.md](story-loop.md), step 6): when an agent judge compares two versions of a line, does it pick the side the owner picked?

**The short answer.** The numbers are from the held-out half: 8 verdicts and 10 controls, 2 runs each.

| | C: rules only | a1: the old judge | a2: the owner's rules | b: a2, forgetful |
| --- | --- | --- | --- | --- |
| Cost per pair | none | 1 agent | 1 agent | 1 agent, plus 2 memory writers when a part changes |
| Picked the owner's or the record's side | 0 of 8 (decided none) | 11 of 16 | 9 of 16 | 10 of 16 |
| ...on lines the owner chose (3) | decided none | 4 of 6 | 3 of 6 | 2 of 6 |
| ...on lines a rule or readers decided (5) | decided none | 7 of 10 | 6 of 10 | 8 of 10 |
| Said "same" for two equal texts | 2 of 2 | 4 of 4 | 4 of 4 | 4 of 4 |
| Caught a line we made worse | 6 of 8 | 16 of 16 | 16 of 16 | 16 of 16 |
| Same pick in both runs | always | 15 of 18 | 17 of 18 | 18 of 18 |
| Tuning half: picked the record's side | 1 of 5 (decided 1) | 5 of 10 | 9 of 10 | not run |

So: **no judge stands in for the owner's taste.** On the held-out verdicts the three agent judges are at 9 to 11 of 16, and they differ by 1 or 2 runs, which is noise at this size. They fail on jokes: the owner asked for the frog's two prince lines (#902), and the judges kept them in 3 of 12 runs. All judges kept the owner's "Water both sides" (6 of 6).

What they do well is the owner's written rules. Every agent judge said "same" for equal texts and caught every line we made worse, in both halves. On lines that a commit cut for a rule, a1 chose the side that breaks the rule in 6 of 16 runs (a plain fact, a line that explains the story, a line aimed at the learner's study). a2 did so in 3 of 16, and b in 2 of 8. 4 of those 5 a2 and b runs are on one item, `R-sunflower-face`, where the record itself is in doubt (see below).

### Method

1. **Cases.** [judges/story/cases.json](judges/story/cases.json) has 33 items. Each is one place in the story and two versions of one part, with the evidence for the owner's side.
   - **owner** (3): a line the owner chose. The frog's "No kisses, please" and "I'm not a prince" (#902, #920), and "Water both sides" in the last note (#918). These are all the line-level owner choices we found. #936 holds agent drafts, not owner rewrites, and agents cannot read the owner's chats.
   - **rule** (8): a line that a commit cut or changed, with an owner rule as the reason (#886: a thought is never a plain fact; #901: it explains the story again; #639: never aimed at the learner's practice). Both sides are real lines from git history, in our English. The owner wrote the rules. The record does not show who named each line: for #886, an agent did (commit 37368f1).
   - **reader** (2): a line changed because agent readers misread it (story-loop.md, "Lessons").
   - **control** (20): planted. 4 pairs of one text twice, and 4 lines each made wordier, jokey, explaining, or in hard words.
2. **The story.** [judges/story/story-en.md](judges/story/story-en.md) is the English text of every note and diary page, with the thoughts that unlock after each. Judges read English, with no hidden words.
3. **Blind judges.** Each judge was a fresh Opus agent with one folder of at most 9 items, numbered 01 to 09, in story order. An item has the story so far, then version 1 and version 2 in a seeded random order. The judge reads one file and answers before it reads the next, so it never sees later parts of the story. The case ids never reach the judge.
4. **Designs.**
   - **C** needs no agent. A side breaks a rule when a thought is longer than 8 words (#936), a sentence is longer than 14 words, or more than 1 in 8 of its words are long and hard. C picks a side only when exactly one side breaks a rule.
   - **a1** is the judge prompt that story-loop.md used before this test: 4 questions, then a pick.
   - **a2** is the owner's written rules as a list. The judge says what a reader now believes or feels, which rule each side breaks, and then picks. "Same" is allowed.
   - **b** is a2, but the judge sees each earlier part only as one remembered line ([judges/story/memory.json](judges/story/memory.json), written by 2 agents that read the parts one at a time), and today's part in full. This is like a learner who reads a note every few weeks.
5. **Split.** We fixed the split before any judge ran: 15 tuning items, 18 held-out. We did not change a2 after its tuning run. b ran on the held-out half only.
6. **Runs.** 2 per design and half: 22 judge agents and 2 memory writers.

The harness is [scripts/story-judge.ts](../scripts/story-judge.ts) (`folders`, `parts`, `ingest`, `score`, `rules`, `lint`). Every answer, with the judge's words, is in [judges/story/results.json](judges/story/results.json).

### Reasons to trust the numbers less

- **The owner's own choices are few.** 3, and 2 of them are jokes. Most items stand on a rule the owner wrote, not on a line he picked.
- **One case is weak, and one record is in doubt.** We saw both after the answers came in. In `X-p4` readers misread the German line (#967), and the English line does not have that problem. In `R-sunflower-face` an agent cut "Its face looks at the path" as a plain fact (#886, commit 37368f1). 5 of 6 runs said it is a hint, not a fact, and that the new line, "She looked at it every morning", comes close to saying she is gone. They may be right. Without `X-p4`, the lines a rule or readers decided are a1 5 of 8, a2 6 of 8, b 6 of 8. Without both, a1 4 of 6, a2 6 of 6, b 6 of 6.
- **The controls are too easy.** Every agent judge caught every planted control. They do not tell the designs apart.
- **C's one tuning hit** was the only verdict it decided in 13. It is a check, not a judge.
- **English, not the course.** In the loop, judges read the es or de text with hidden words. These judges read English.
- **18 held-out items.** Read the numbers as a rough size.

### What follows

- The loop's judge is now a2 (story-loop.md, "Judge"). a1 had 2 more held-out runs on the owner's side, but they came from `X-p4`, `R-sunflower-face` and one frog-joke run. a2 broke the written rules less (3 of 16 runs against 6 of 16), was right more in the tuning half (9 of 10 against 5 of 10), and was steadier (17 of 18 against 15 of 18). The loop's copy says "Simple words" where the test said "Simple English", because its judges read es and de with hidden words. The harness reads the rules from there.
- C runs on each English draft before the judges: `bun scripts/story-judge.ts lint thought "<line>"`. It is free and it catches wordy and hard lines (11 of 16 planted ones).
- b is dropped. It costs 2 more agents each time an earlier part changes, and it did no better than a2.
- The judges are not the owner's taste in jokes. A judge vote against a joke is weak evidence.
- To measure taste, we need more of the owner's own choices between two lines (#1069).

## Which of two is better? (#1004)

A second back-test, also from 2026-11-14. The open-ended judge above raises too many false alarms to stop a merge. So this test asks a narrower question. A fresh judge sees two versions of one screen, before and after a change, in random order and with no labels. It says which one the owner would rather ship, or "same", in one line.

**The short answer.**

| | Runs |
| --- | --- |
| Owner's fixes, held-out half: picked the fixed version | 45 of 56 (80%) |
| ...the same, without the `stileshut` case (below) | 45 of 48 (94%) |
| Owner's fixes, tuning half (final prompt) | 9 of 10 |
| Identical pictures: said "same" | 12 of 12 |
| Planted regressions: picked the version without it | 16 of 16 |
| Pairs where every run gave the same answer | 26 of 28 |
| Runs that picked the version shown as A | 39 of 72 |

We set the bar before the test: 85% on the held-out half, with low variance. **80% does not pass, so this judge is not the UI check.** Nearly all of the misses are one garden case, where still pictures show the wrong thing (below). On app screens and on text in the world, it agreed with the owner in 45 of 48 runs. It never called two identical pictures different, and it caught every planted regression.

### Method

1. **Pairs.** [judges/pairs.json](judges/pairs.json) lists 24 real pairs from 10 issues: the 8 cases above, #1009 (contrast) and #625 (polish on 6 screens; an agent found these, and the owner merged the fix). Each pair is one screen or garden spot, at the commit before the fix and at the merge commit, on a phone or a desktop.
2. **Controls.** 6 identical pairs (one capture twice), and 8 regressions we planted on today's `main` with CSS or a text change: a date line 10 px out of line, pale body text, spacing cut to 2 px, a jokey main button, two sibling buttons of different shapes, a serif font on the card, the open tab shown by colour alone, and word rows drawn over each other. They are `PLANTS` in [judges/capture.spec.ts.txt](judges/capture.spec.ts.txt).
3. **Folders.** `bun e2e/pairwise.ts build` (in web/) makes one folder per judge run, with a random name. It holds A and B (the order alternates from run to run), `steps.txt` and the rules. Where the pixels differ in a small part, it also holds that part enlarged, so the judge can read small text. Identical pairs get an enlarged middle, so that a missing zoom does not give the answer.
4. **Judges.** Each run is one fresh Opus agent with [judges/pairwise-prompt.md](judges/pairwise-prompt.md). It sees one pair only.
5. **Split.** We fixed it before any judge ran. Tuning: #650, #678, #711, #770, #1009. Held-out: #677, #710, #749, #779, #625. The final round ran each held-out pair 4 times (2 in each order) and each control 2 times.
6. **Tuning.** The first prompt got 18 of 20 on the tuning half. Both misses were the sign case on a phone: the judge said "same", because it could not read the sign text. The final prompt adds the zooms and asks the judge to list every difference first. It got 9 of 10: on the phone the judge now saw the sign text, but it took the old English sign for Spanish. The pictures are at 1x pixel ratio, so the sign text is about 10 px high, and a zoom adds no detail. We stopped tuning there.
7. **Scoring.** `bun e2e/pairwise.ts score <folder>` prints the numbers. Every verdict and its reason is in [judges/pairwise-results.json](judges/pairwise-results.json). There were 114 judge runs in all.

### Where it went wrong

- **`stileshut` (#749): 0 of 8.** Every judge picked the old version. The owner's problem was that the stile goes nowhere. Still pictures cannot show that: from the top board, the old path looks like a way up the hill. And in the fixed version, holding W puts the camera inside the brambles (#999). That is a real defect, and every judge named it. The same capture mistake as in the first test is here too: `steps.txt` says "steps" where there are none. So the judges were right that the fixed version shows a bug, and wrong by the owner's verdict.
- **`polish-card` (#625): 2 of 4.** The fix lined the plant picture up with the column and made "Show answer" a wider box. Two runs chose the lined-up plant. Two chose the old round "Show answer", which matched the Undo button. This is a matter of taste, and the owner did not raise it.
- **`quality` on desktop (#677): 3 of 4.** One run wanted to keep the "Normal quality" button. This is the product call that no judge made in the first test either.

### Reasons to trust the numbers less

- **We made the planted regressions, and they are plain.** A real regression is often smaller.
- **Today's rules know some answers**, as in the first test (`nextplant`, and in-world language for `door`).
- **1x pixel ratio.** `bun run shots` takes a phone at 2.625x. The judges saw less detail than the real shots give.
- **The judges compare by eye.** A change of a few pixels can look "same" to them. The pixel diff (below) does not miss it.
- **5 issues in the held-out half.** Read 80% and 94% as a rough size.

### What would make it pass

- Capture at the real pixel ratio, so in-world text can be read.
- For a case about movement, frames that show the result of the move, or a short video, and a `steps.txt` that is checked against the frames.
- More held-out cases, most of all in the garden.
- Then run the held-out half again with the same prompt. If it passes, add the judge to `bun run compare`, as the UI check.

### What shipped

`bun run compare <folder> [-g "today|settings"]` (web/e2e/compare.ts) takes the shots on the main commit your branch started from (its merge base with `origin/main`) and on your branch, and lists the screens whose pixels changed, with the share of changed pixels and the box around them. `<folder>/diff/` marks the changed pixels in red. Use it to see every screen your change touched, then look at those screens yourself (docs/agents.md, "UI changes").
