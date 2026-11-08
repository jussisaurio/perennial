# The story loop

How we tune the story's pacing and text with simulated learners and fresh readers, without a browser (#928). What the story is and what it must do is in [direction.md](direction.md), section 3. This file is the procedure.

The idea: a simulated learner gives the day each part of the story arrives. Fresh reader agents read the story the way that learner would see it, one part at a time, with the words the learner does not know yet hidden. A grader compares what they understood with what we meant. An author agent proposes changes. Judges compare old and new side by side. We keep what wins, and we write down what we learned.

## The tools

All in `web/`.

- `bun run story:sim <lang> <pattern>` prints the story as one simulated learner meets it: each event's day, the learner's known words that day, its kind, the share of its words the learner can read, and the pacing numbers below. `<lang>` is `es` or `de`. `<pattern>` is `daily` (5 minutes a day: the one we tune for), `weekdays`, `break` (two weeks off at day 40) or `more` (10 minutes a day).
- `--json` prints the same as JSON, for an agent to read.
- `--script <dir>` writes the reader's script: one file per note, `01-n01.md` and on, in day order. Each part ends on its note.
- The learner traces are in `web/src/sim/traces/`. Rebuild them with `bun run sim:learners` only when the planner, FSRS, the deck or the door's count changes: each trace stops at the door. A change to the story text or to another note's count needs no rebuild.
- What each note should leave the reader with is in `web/src/sim/intended.ts`. Change an entry only when the story changes, never to match what readers said.

The projector (`web/src/sim/timeline.ts`) knows only the learner's words, so it assumes:
- a note is read on the day it comes;
- a thing with a new thought is tapped that day (the stool's thoughts wait for the walk after the hill's note);
- the frog's lines are heard on the day they come, once the frog lives in the garden.

The reader's script says the first two to the reader.

### The numbers

For the daily learner:

| number | target |
|---|---|
| Days between notes | 21–28 (a note every 3–4 weeks) |
| New things a week (any kind) | about 1 |
| Weeks with nothing new | as few as we can; no run of 4 weeks |
| Clumps (more than 2 notes on one day) | none |
| Stale thoughts (one line shown through 2+ notes and 8+ weeks) | few, and none on a thing the story is about |
| The door | reported, not tuned here (#882) |

Each event has one of three kinds (direction.md, "Density"), read from the fact ledger (`web/src/garden/facts.ts`):
- **big**: a note;
- **small**: a thought or frog line that needs a fact from the notes (it has `assumes`);
- **texture**: everything else: a thought with no `assumes`, a visitor, the key.

The "read" share counts the words the simulated learner really knows that day. The simulated learner often knows less than a word's place in the course suggests, so `notes.test.ts` and `thoughts.test.ts` check both: by course place, and for the daily learner on the day it comes (#938).

### The reader's script

A part shows the days since the last note, then the note:
- Each day with something new: the day, the known-word count, and one line for each new thing: a thought, a frog line, a visitor, the key, or a place that opens.
- A run of 7 or more days with nothing new is one line: "Days 120–166: nothing new in the garden."
- A word the learner does not know shows as ▢▢▢. A crossed-out word shows as ~~struck~~.
- The gardener's own words (in no deck, never known) are masked in the first note they appear in and shown from the next note on. By then the note and the garden have shown what they name: the tiny door, the brambles, the stile, the far light, the mouse.
- Part 1 starts with a frame from docs/garden-play.md: the garden on day 1, and how to read the script. It tells nothing of the story.

## The hard gates

No change is kept unless these pass (`bun test src/garden` in web/):
- `facts.test.ts`: no line needs a fact before a note tells it, and both courses tell the same facts in the same beats.
- `notes.test.ts`: each note's words are deck words, the gardener's, or things the garden names (the hedge); a note unlocks when 55% of its words are known, both by course place and for the daily learner, and an early or stile note at most 75% for the daily learner; notes stay in story order.
- `thoughts.test.ts`: a thought or frog line uses only words known when it unlocks, both by course place and for the daily learner (by place alone after the door, where the trace stops); lines on a thing stay in order.
- `story.test.ts`: for the daily learner, the door opens on days 335–396 and a note comes at least every 35 days.

## One iteration

There are two sizes.

- **A line iteration** changes 1–3 things: a threshold, a word, or a line. Only the parts it changes are judged, side by side. It needs no new readers.
- **An arc iteration** reads the whole story with new readers, in both courses. Run one after about 5 line iterations, after a note or beat moves, and before a story change ships to friends.

The steps:

1. **Simulate.** `bun run story:sim es daily` and `de daily`. Write the scripts with `--script` into your scratch folder.
2. **Read** (arc iterations). Start 3 fresh reader agents for each course, each with a different persona (below). Give a reader part 1 with the reader prompt. When it answers, send the next part to the same agent (SendMessage). Never give a reader a part before it has answered the one before. Never give it a file path: paste the part's text. A reader who has read the story once is never used again. With the last part, ask the reader to write all its answers, word for word, to a file in your scratch folder: the grader reads those files.
3. **Grade.** One fresh grader gets every reader's answers, the parts, and `intended.ts`. It writes the gaps. The grader and the author hand back their reports as text (the harness stops a subagent from writing a report file): save them in your scratch folder.
4. **Propose.** One fresh author agent gets the grader's report, the numbers, and the aim of this iteration. It proposes at most 3 changes.
5. **Apply.** A mechanical change (a threshold, a word swap that keeps the meaning) goes on a branch. New writing goes to the owner first ("Writing with the owner", below); the loop does other work while it waits.
6. **Judge.** Write the scripts again with the change. Give 3 fresh judges the changed part, old and new, in random order, with the part before it for context. For a threshold change, also compare the numbers.
7. **Keep and learn.** Keep a change when at least 2 of 3 judges prefer it, no part reads worse in the grade, and the hard gates pass. Open a PR (`Refs #928`) and merge it. Add one line to "Lessons", below, whether the change was kept or not.

All agents in the loop run on Opus.

### Not gaming the numbers

The numbers find the gaps; readers and judges decide.
- Never add a line only to fill a week. A new line must win against "nothing" side by side: give the judges the part with the line and the part without it.
- Readers never see the numbers, `intended.ts`, the facts or this file.
- Tune on the daily learner. At each arc iteration, also run `weekdays` and `break` and check that they did not get worse. If a change helps daily and hurts another pattern, write it in Lessons.
- If the grade gets better but the readers' "want to read on" scores fall, the change is not kept.

## The prompts

Fill in the `{...}` parts. Give each agent nothing else: not your reasoning, not the other agents' answers (except the grader).

### Reader

```
You are reading a story that a language learner meets, a few minutes a day, in a garden inside a language app. {persona}

I will give you the story one part at a time. After each part, answer the questions below, then stop. I will send the next part after you answer.

Rules:
- Do not translate with a tool or look anything up. A ▢▢▢ is a word you can't read: do not guess it from the letters around it.
- Answer as your persona, in plain English, in at most 150 words in all.

After each part:
1. What happened in this part, in one or two sentences?
2. Who writes the notes, and who else is in them? What do you believe about them now?
3. What do you think is going on that the notes do not say?
4. What do you want to know next?
5. How much do you want to read the next part, from 1 (not at all) to 5 (very much)? Why, in one line?
6. Did anything confuse you or feel off?

Part 1:
{part}
```

When a part has a run of 4 weeks or more with nothing new, add this question to that part (the long-stretch probe):

```
7. In this part, {n} days passed with nothing new in the garden, though you came every day. Would you still look round the garden after your practice? Why, in one line?
```

An agent remembers every part, and a person does not. So the grader weighs question 7 and the scores, not what the reader still remembers.

**Personas.** Use 3 different ones in each course:
- "You do your 5 minutes on the bus. You read a note once, quickly, and skip what is hard. You never go back to old notes."
- "You love stories. You read each note twice and notice small details and things that come back."
- "You think stories in apps are cheesy. You have little patience, and you say so when a line is cute, obvious or sentimental."
- "English is not your first language. You read the English parts slowly, and you say when the English itself is hard to follow."

### Grader

```
You grade how well readers understood a story at each point, against what the author meant. The story is told in short notes that a language learner finds in a garden in a language app, with the words the learner does not know yet hidden as ▢▢▢.

You get:
- the parts, as the readers saw them;
- what the author meant each note to leave the reader with, by note id;
- each reader's answers, part by part.

For each part and each reader, give:
- understood: yes, partly or no. Did they take what was meant, by this point? Their own words are fine.
- wrong: a belief that is wrong and that the text led them to. An open guess that the story leaves open is not wrong.
- ahead: did they guess something the story tells only later? Say what gave it away.
- want: their 1–5 score.

Then, for the whole story: the 3 biggest problems, each tied to a part and a line, with a short quote from the answers as evidence. Count a problem only when at least 2 readers show it. Do not suggest fixes. Do not grade the writing, only what readers took from it and how much they wanted to go on.

{parts}

{intended}

{answers}
```

### Author

```
You are the author agent of a story loop (docs/story-loop.md). The story is told in notes, thoughts and frog lines that a language learner finds in a garden.

First read: docs/direction.md, section 3 (the story, the density, the thoughts); web/src/garden/facts.ts; the notes (web/src/garden/notes/es.ts, de.ts); the thoughts (web/src/garden/thoughts/es.ts, de.ts); web/src/garden/frogLines.ts; and the Lessons in docs/story-loop.md.

You get the grader's report, the numbers from `bun run story:sim es daily` and `de daily`, and the aim of this iteration: {aim}.

Propose at most 3 changes. Each is one of:
- Mechanical: a threshold (`unlockAt`), or a word swap in es or de that keeps the meaning and makes a line readable. Give the exact edit.
- New writing: a new line, or a rewrite that changes what a line says. Write it in English only, never in Spanish or German. Give: where it goes (a note id, or the thing and the two notes it falls between), its kind (big beat, small beat or texture), the facts it needs (facts.ts), and a short note on its point: the device, the feeling, what it sets up or pays off.

For each change, say which problem in the report or the numbers it answers.

Rules:
- For the daily learner, aim at about one new thing a week, and a note every 3–4 weeks. Fill a gap with a thought first: it is the cheap way. Texture never takes the place of a beat that is due.
- A thought is at most 6 words in the course language. It never explains the story and never uses the gardener's own words. It needs no fact before a note tells it.
- Texture is deadpan and a little strange, in the same dry voice. It is not plot.
- Never add a line only to fill a week. Each line must be worth reading by itself.
- A line marked as the owner's: you may only propose a change to it, as new writing.
- Keep the theme: love is kept by small daily tending, shown, never said, and never aimed at the learner's own practice.
```

### Judge

```
You compare two versions of one part of a story. A language learner meets it a few minutes a day, in a garden inside a language app. Words the learner does not know yet are hidden as ▢▢▢. The story is quiet and dry, and it never explains itself.

You get the part before, for context, then version 1 and version 2 of the next part. They are in random order.

For each question, answer "1", "2" or "same", and one line why:
1. Which makes you want to come back tomorrow?
2. In which is it clearer what happened, from the words you can read?
3. Which fits the voice better: dry, quiet, never sentimental, never explaining?
4. Is every line worth reading by itself, or does one feel like filler?

Then give your overall pick: "1", "2" or "same". Do not try to guess which version is new.

The part before:
{before}

Version 1:
{one}

Version 2:
{two}
```

## Writing with the owner

The owner writes the story's English. They write English very well but know Spanish and German only a little. So the loop never writes new creative lines straight into es or de.

1. **Drafts, in English.** For any new writing, the author agent writes an English draft. Each draft has an id, where it goes, its kind, and a short note on its point: the device, the feeling, what it sets up or pays off.
2. **A writing batch.** The drafts go into one open GitHub issue named "Writing batch N" (the first is #936). The owner rewrites each draft in English, or keeps it (`ok`), cuts it (`cut`) or asks (`?`), in a comment.
3. **Adapt.** An adaptation agent writes each of the owner's lines in es and de, within the words the learner knows at that line's threshold: it passes the readability test, uses only deck words (or the gardener's own), and gives `forms` for each word whose form differs from its lemma. It writes in each language, not word for word, and keeps the tone.
4. **Back-translate.** A separate fresh agent, who has not seen the owner's English, writes a literal English back-translation of each es and de line. Post it in the batch issue beside the owner's English, and flag each shift in meaning or tone. The owner can't check the es or de directly, so this is how they check it.
5. **Proofread.** A different agent proofreads the es and de, as in [decks.md](decks.md): it writes findings and never fixes silently. The adaptation agent applies them.
6. **Mark the owner's lines.** In the source, put a comment above each line the owner wrote: `// The owner's line (#<batch issue>).` The loop only proposes changes to these lines, as drafts in the next batch. It never makes them itself, even a word swap. It may still move their thresholds.

Mechanical changes stay with the loop: thresholds, and word swaps for readability in lines that are not the owner's.

## Lessons

One line per iteration, newest last: the date, what changed, what we learned.

- 2026-11-08, arc 1 (6 readers, daily learner after #943): no story change yet. 3 proposals went to the owner as drafts (#936, Part C). The diary refrain (d1–d3) works once d3 lands (want 5 from 5 of 6), but the months of nothing around it bring want down to 3 at d2, and every long-stretch answer says the reader stops looking round within 1–2 weeks. Readers took n05's "now, brambles" as her death, so the present tense of n06–n07 read as a broken timeline (6 of 6). They took n02 as memory loss (5 of 6). The run itself had 3 flaws, now fixed: Q2 named "she" before the story does (fixed in #944); the German frame showed the Spanish tag (fixed in #944); the frame did not mention Today's pinned paper, so "I could have missed d3" partly came from the script, not the game.
