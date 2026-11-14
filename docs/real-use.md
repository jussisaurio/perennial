# Real use

Two of our checks only check themselves (#984). The simulated learner remembers a word with the chance that FSRS gives (web/src/sim/learner.ts), so FSRS always looks right in the sim. The story's readers are agents. `bun run real-use` gives numbers from real practice instead, from the database, with one command.

## Run it

- `REAL_USE_DATABASE_URL=<url> bun run real-use` prints a short text. Add `--json` for JSON.
- Locally, the url is `postgres://perennial:perennial@localhost:25432/perennial` (the dev and server-test database, full of test learners), or a worktree's e2e database (`web/e2e/worktree.ts`).
- For production, the owner puts a read-only url in `REAL_USE_DATABASE_URL` (see "Production" below). If it is not set, the command says so and stops. Never print the url, and never put it in a commit, an issue or a comment: the repo is public.
- `bun run real-use:sim` prints the same report for the simulated learner (seed 1, 5 minutes every day, one year per course). That is the baseline: see "The sim's own numbers".
- Days are local days in the time zone of the process (the report prints it). Run it with `TZ=` set to the learner's time zone.

The report reads ids, times, grades and counts only. It never reads an email, a sign-in code or the learner's text.

## What it reports

Every rate has its count next to it. With one learner, the counts are small. Under 100 answers, the text says "thin": one more answer can move the rate a lot.

- **Calibration.** Before each answer, the report replays the learner's earlier answers through the app's own memory code (core/memory.ts) and takes FSRS's predicted recall. Then it compares that with the answer: remembered (grade 2 or more) or forgotten. A word's first answer has no prediction, and "Already know it" is no test of memory. It prints the mean predicted recall, the share remembered and the difference, for all answers, for answers under a day after the word's last answer, for a day or more, per skill, and per band of predicted recall. The expected calibration error is the mean gap between predicted and remembered over the bands, weighted by their counts.
- **Practice days.** Days with at least one answer, visits (a new visit starts after 30 minutes with no answer), the days from one practice day to the next, and how long ago the last practice was.
- **Minutes a day,** counted as Today counts them (data/practice.ts `countedMs`): a new word counts at least its planned time. The report says on how many days the learner reached the day's 5 minutes and on how many they stopped short. The reviews do not store where a session ended, so a day that stopped short is the closest we have to a session left in the middle.
- **Notes.** How many notes came (the known count reached the note's mark), how many were read, and for reads with a time: how many on the day the note came, and the median days from coming to reading.
- **Courses left out.** A demo (`/?demo=`, server/src/demo.ts) writes a whole made-up history at once. So a course where most answers reached the server over a day after they were made is left out, and the report says how many.

## What is stored

- Already there: every answer (`review`: word, skill, grade, kind, when it was made, how long it took, when the server got it), the notes read (`course.notes_read`, ids only) and the learner's own words linked to deck words (`user_word.deck_id`). Calibration, practice days, minutes and visits come from these alone.
- Added in #984: `use_event`, one row with the time of each note's first read. The server writes it when a write adds a note to `course.notes_read` (server/src/sync.ts), so the app sends nothing more. Notes read before this have no time: they count as read, but not in the lag.
- Not yet: whether the learner walks in the garden after practice (#1030).

## The sim's own numbers

`bun run real-use:sim` on 2026-11-14 (es and de together):

```
Expected calibration error 0.003.
  all            n=24886  predicted 0.895  remembered 0.895  (+0.001)
  a day or more  n=18380  predicted 0.880  remembered 0.882  (+0.002)
```

This is right by construction: the sim remembers with the very chance that the report compares against. The only gap is chance itself. So a good calibration in the sim says nothing about real learners.

A real learner will differ, and the report shows how. These are guesses until we have the numbers:

- FSRS starts with default parameters, fit on Anki users who review flashcards. Our answers are cards in sentences, listening and typing. Typos and sound make some answers harder than the memory behind them.
- A real learner forgets less after a short gap and more after a long break than the default curve says, or the other way round. The "under a day" and "a day or more" lines show which.
- A real learner presses "Already know it", skips days and practises more on some days. The sim does none of this.

## How to use the numbers

### For the planner (FSRS, retention, pacing)

- Look at "a day or more" first. Those answers test memory after a real wait, which is what the schedule decides. "Under a day" answers are repeats in the same session, predicted near 1.
- Remembered below predicted by more than about 0.03, with at least a few hundred answers: FSRS is too hopeful for this learner. Words come back too late. Remembered above predicted: words come back too early, and the learner does more reviews than needed. Then it is time to fit FSRS's parameters to the stored answers, or to change the retention. Either change must keep the progress of a learner in the middle of a course.
- Under a few hundred answers, do not change the schedule because of these numbers. Write what you saw in the issue and wait for more data.
- Compare a band's gap with the sim's for the same band, not with zero. The sim shows how far chance alone moves a band of that size.

### For the story loop

- The story loop's projector assumes a note is read on the day it comes (docs/story-loop.md). The notes line checks this: "N of them on the day the note came" out of the reads with a time. If most reads come days later, the story comes later than the projector says.
- The days between practice days say which sim pattern is closest to the real learner: `daily` (gaps all 1), `weekdays` (gaps of 1 and 3) or `break`. Judge pacing on that pattern too, not only on `daily`.
- Minutes a day above 5 mean the learner uses "Practice more". They then meet the story sooner than the `daily` learner. The `more` pattern is closer.

## Production

Agents never connect to production with the app's own role. The owner makes a read-only role once, which can read only the columns above:

1. Make a role with no rights: `pscale role create <db> main real_use --format json`. It prints the role's url once.
2. Connected as the app's role (`perennial`, which owns the tables), give it only these columns:
   ```sql
   grant usage on schema public to real_use;
   grant select (id, user_id, lang, word_id, skill, grade, kind, reviewed_at, duration_ms, received_at) on review to real_use;
   grant select (user_id, lang, retention, notes_read) on course to real_use;
   grant select (id, user_id, lang, deck_id) on user_word to real_use;
   grant select on use_event to real_use;
   ```
3. Put the url in `REAL_USE_DATABASE_URL`: in the shell profile of the machine where agents run, and as a GitHub Actions secret of the same name for autorun (`.github/workflows/autorun.yml` passes it to the agent).

The role cannot read emails, sign-in codes, sessions or the learner's own words and sentences.
