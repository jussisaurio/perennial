# Perennial — design notes

Perennial is a spaced-repetition app for going from zero to fluent in a language, in
5 minutes a day. It takes Anki's core idea (retrieval practice, scheduled
by a memory model) and drops most of what grew around it.

## What's wrong with Anki (and what we do instead)

| Anki problem | Source of pain | Perennial |
|---|---|---|
| **Backlog after missed days.** A wall of "437 due" after a week off makes people quit. | Due-count queue. You "owe" the app reviews. | **Time-boxed sessions.** Every day is 5 minutes, and "Practice 5 more minutes" is always there. The app spends each 5 minutes on the highest-value items. There is no wall of due cards: Today only says how many plants still need water. Overdue items are sorted so the cheapest saves come first, and new words slow down by themselves when there's a backlog. |
| **Boring, grindy reviews.** The same static card 40 times. People memorize the card layout, not the word. | One card = one fixed front/back. | **Memory is per word × skill, not per card.** Each review shows a *different* example sentence for the word (from the static deck, or AI-written on request). Exercises rotate between reading, listening and typing. |
| **Card creation friction.** Note types, HTML templates, fields, finding sentences, recording audio. | Anki is a generic flashcard engine. Language learning is bolted on through add-ons. | **No card creation for the common case.** Pick a language, and the course is built from a real frequency list (OpenSubtitles). The sentences ship in static decks, drafted with a model and reviewed, using earlier (more frequent) words where possible. Or paste any text and tap the words you don't know. Audio comes from the browser's speech synthesis. |
| **Recognition-only decks.** Research (Nakata) shows receptive retrieval mostly builds receptive knowledge. | Default "Basic" note type is L2→L1. | **Three skills per word:** *read* (L2 sentence → meaning), *listen* (audio only → meaning), *write* (L1 meaning + cloze → type the word). Writing unlocks once reading is stable. Each skill has its own memory state. |
| **SM-2 and "ease hell".** Pressing Again repeatedly locks ease at 130%. Learning steps, graduating intervals and easy bonuses confuse people. | 1987 algorithm, with options layered on for 20 years. | **FSRS-6 only.** One setting: desired retention. No learning steps — FSRS models same-day reviews itself. |
| **4 grading buttons.** Users press Hard when they actually forgot, which breaks FSRS. | | **2 buttons: Forgot / Got it.** Typed exercises are graded automatically. |
| **Too many options.** Presets, deck hierarchy, filtered decks, burying toggles, gather/sort orders. | | **One course per language, 5 minutes a day, nothing to set up.** Siblings are never shown in the same session. |
| **Sync: forced one-way "full sync", media that won't sync, last-writer-wins on whole objects.** | Schema-level change counter. Mutable card state is synced as rows. | **Event-sourced sync.** Reviews are an append-only log, so they merge without conflict, and scheduling state is *recomputed* from the log. Other rows have simple, per-table merge rules (newest `updated_at` wins; settings change per column). There is no "full sync". |
| **Dated Qt UI, AnkiMobile costs $25, AnkiDroid differs.** | Three separate clients. | **One web app.** It runs in the browser, and you can add it to the home screen on phone and desktop. |
| **No sense of progress.** Stats are dense graphs. | | **A garden that grows.** Every word you study is a plant: it sprouts, buds and blooms once you know it. Today counts the words you know and the words you are learning. |

## Research we lean on

- **FSRS-6** (open-spaced-repetition). Its DSR model beats SM-2 by a wide margin
  on the srs-benchmark. Formulas are in `web/src/core/fsrs.ts`.
- **Frequency-first vocabulary.** A small number of words covers most running
  text: the top ~1,000 lemmas cover ~80–85% of spoken text, and ~3,000 cover
  ~90–95%.
- **Retrieval direction matters** (Nakata 2011, 2016). Productive and receptive
  practice build different knowledge, so we train both.
- **Context over isolated words.** We always show the word in a sentence and
  vary the sentence (against the "static card" problem).
- **Comprehensible input / i+1.** Deck sentences favour words from earlier in
  the frequency list; AI sentences for a learner are constrained to their
  known words plus the target word.
- **Desirable difficulty.** Typed recall beats recognition for long-term
  retention. Interleave skills rather than blocking them.
- **Habit formation** (Lally 2010). A small, fixed daily dose with no
  punishment for missed days. No streak guilt.

## Architecture

```
decks/<lang>/         static decks (JSON): the shared course, versioned with the code, checked by CI
web/ (Vite + React + TS)
  core/      pure, tested logic: FSRS, memory from reviews, session planner, answer checking, days
  data/      TanStack DB collections + Electric shapes, write queue, auth, learner model
  deck/      deck schema and id resolution (shared with scripts/deck)
  content/   course languages, tokenizer, course order, Perennial's lines
  garden/    the walk-in 3D garden
  ui/        screens
server/ (Bun + Postgres via Bun.sql)
  auth           Better Auth: email codes, anonymous users, account linking
  sync           GET /api/shape (Electric proxy), POST /api/write
  ai             Perennial AI task endpoints, credits and the spend budget
  housekeeping   daily cron: old anonymous users, old AI logs, expired codes and sessions
```

Production runs on Railway (one image for the app and API, Electric beside it, a daily cron) with PlanetScale Postgres. See [docs/DEPLOY.md](docs/DEPLOY.md).

### Data model

The full model is in [docs/schema.md](docs/schema.md). In short:

- **Deck words and sentences** are static content with stable, opaque ids. They are not in Postgres.
- **Learner rows** (Postgres, synced): `course` (settings per language), `review` (immutable events), `word_state` (queued / paused / ignored), `user_word` and `user_sentence` (from the learner's own texts or from AI).
- **Memory** (FSRS stability, difficulty, due dates, unlocks) is *derived* on the device by replaying reviews. It is never stored or synced.

### Sync

- **Reads:** Electric streams Postgres changes over HTTP "shapes". The server proxies `/api/shape` and always sets the shape itself: one table, `where user_id = <session user>`. On the client each table is a TanStack DB collection in memory, synced again on each start.
- **Writes:** a change applies on the device at once and goes into a queue (IndexedDB). The queue sends batches to `POST /api/write`. The server validates each mutation, stamps the session's `user_id`, and applies the batch in one transaction. It returns the transaction id; the client keeps its optimistic rows until Electric streams that transaction back.
- **Merge rules:** reviews are insert-only (`on conflict do nothing`; Undo is a delete); `word_state` changes only when `updated_at` is newer; `course` changes only the columns sent. Times from the future are clamped to the server's time.
- **Old clients:** writes carry the app version. Below `MIN_CLIENT_VERSION` the server answers "please reload", and the queued writes are kept. Schema changes go expand, then contract.
- **Accounts:** the first write creates an anonymous user. Signing in with an email code links it to the real account: the server moves the rows in one transaction (newer state wins), then Better Auth deletes the anonymous user.

### AI

Only the server talks to a model (Perennial AI, via the Anthropic SDK with
structured outputs). The prompts live in `server/src/prompts.ts`. There are two
task endpoints: words from the learner's text (`/api/ai/mine`) and new
sentences (`/api/ai/examples`). Both need an email account and cost one AI word
per word from a monthly allowance. A global monthly budget pauses AI for
everyone when it is reached, and every call is logged in `ai_request`. Decks are
drafted offline with `scripts/deck/generate.ts`; the course itself uses no AI
at runtime.

## The garden

Progress is shown as a garden, not as streaks or points. Each word has its own plant, generated from a seed (the word itself). The plant grows with memory stability, flowers once the word is known, and leans a little when recall drops below 90%. Nothing ever dies.

- **Small garden (Today):** an SVG strip of the plants.
- **Walk-in garden (`#/garden`):** a retro 3D world in `web/src/garden/`.
  - `world.ts` has the pure layout: raised beds per kind of word, collision, viewpoints.
  - `textures.ts` draws pixel-art textures procedurally and rasterises the SVG plants into atlases.
  - `scene.ts` hosts the three.js scene (see Garden code, below). It renders billboard sprites into a low-resolution framebuffer, which CSS scales up with `image-rendering: pixelated`.
  - The scene is a snapshot taken when the garden opens.
  - three.js loads only on this route.

### Garden code

`GardenScene` (`scene.ts`) is a small host: the renderer and camera, the frame
loop, movement, and the rendering subsystems that tick or react to the time of
day behind the `Part` interface (`scenePart.ts`) — the sky and pond, the door
and key, the critters (fireflies, butterflies...), and the plants (beds,
culling, texture streaming). These are the rules a change to the garden's
rendering code should follow, and the places it still does not (yet):

- **A new Part is for a new rendering technique, never one per thing.** There
  is one critters part for every small animated effect, not one per creature.
  Reach for a Part when something draws itself a genuinely different way
  (instanced clumps, a streamed texture pool, a point sprite shader); never to
  give one more object its own file.
- **The host owns every order, each in one table.** Build order (the parts
  share one random sequence, drawn in a fixed sequence — never reshuffle it);
  the order `parts` is ticked, disposed and given `Conditions` in; pick
  priority (`TAP_PRIORITY`, `pickAny`); and label priority (`LABEL_PRIORITY`:
  say, then the one active tag — the door's line, a find's word, scenery or
  tree — then a visitor's); and what the one action button acts on
  (`reportReach`: stand up, the key, a find at your feet, the door, the
  bowl, shelf and basket, the bench, then the plant ahead). A Part never reaches into another
  Part's build or pick order.
- **`tick` allocates nothing.** It runs every frame; a `Part.tick(f: Frame)`
  mutates existing buffers and uniforms, never creates one.
- **Behaviour gets time only from the `Frame` it is ticked with, or from
  `Conditions`** (`{ time, dark }`, what `setTime` broadcasts — weather and
  the hour will join it later), **never from `Date`, `performance.now()` or
  `Math.random()` directly.** Build-time placement may still use the seeded
  `rand()` passed through `BuildCtx`, or the calendar-day helpers in
  `core/day.ts` (which visitors already used before this): those pick *what*
  is in the garden today, not how it moves from frame to frame.

Known exceptions, not yet brought in line:
- **The hedge, the orchard and leave it out's bowl and shed (`sceneLeave.ts`,
  #351) are not Parts.** They build geometry once and never tick, react to
  `Conditions` or need disposing beyond the scene's own sweep, so there was
  nothing to gain by giving them the interface. What came for the bowl is
  worked out from calendar days the page passes in (`garden/leave.ts`
  `resolve`), never from the clock in the scene.
- **Visitors (`sceneVisitors.ts`) predate this interface** and were not
  reshaped to fit it: a planned redesign of how the garden describes its
  creatures and visitors may replace both at once, so this PR left it alone.
- **The ground, fence, outer trees, lanterns, bench, signs and the sunflower
  stayed host methods**, each still read directly by `setTime`/`tint` rather
  than through `onConditions` (the lanterns' lit/unlit swap and glow, and the
  sunflower's dusk droop, in particular). The keyhole's glow, once part of
  this list, moved to `Door.onConditions` in review.
- **Two calls still read real time or randomness directly, not from a Frame:**
  `GardenScene.openDoor` reads `new Date()` once, when the door opens, to
  place a visitor in a newly-built orchard tree — a one-off placement, not a
  per-frame behaviour; `whimsy.ts`'s `neighbourPerks` defaults to
  `Math.random`, and `Plants.nod` (the plant perking up when it hears its
  name) calls it without passing a seeded `rand()` in its place.
- **Build order and tick/dispose/condition order are documented but not
  verified by any check:** nothing stops a future edit from reordering
  `GardenScene.build()`'s calls (breaking the shared random sequence) or the
  `parts` array (harmless today, since none of `tick`/`onConditions`/
  `dispose` currently depends on order, but that could change silently).
- **Named build-time anchors (a `Spots` object parts return instead of
  fields another part reads later, e.g. the pond's pads, the lantern spots,
  the orchard's bird perch) are not in this PR:** #324 carries that.

## Not yet / later

- AnkiConnect-compatible local API, so Yomitan/asbplayer can mine into Perennial.
- FSRS parameter optimization from your own review log. Default parameters are
  used until then.
- Speech recognition for speaking practice.
- FSRS-7 (fractional intervals). We already store ms timestamps.
