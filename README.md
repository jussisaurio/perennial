# Perennial

A spaced-repetition language app with a garden: every word you learn grows
into a plant. Zero to fluent in 5–10 minutes a day. It started as a rethink of
Anki; see [DESIGN.md](DESIGN.md) for what we changed and why.

- **Time-boxed sessions, no due counts.** After a week off, you still do your 7 minutes.
- **MVP scope:** English speakers learning **Spanish** or **German**.
- **Frequency-first course.** Words come from OpenSubtitles frequency lists. The sentences are drafted with a model ahead of time, reviewed, and shipped as static decks.
- **Memory per word × skill** (read / listen / write). Each review shows a different sentence.
- **FSRS-6** scheduling, with two buttons.
- **The garden:** a plant per word, grown from the word itself. A strip on Today, and a retro 3D garden you can walk through.
- **Words from your own texts:** paste any text and tap the unknown words (Perennial AI, needs an email account).
- **Offline-first PWA.** Start without an account. Add your email to keep your progress and use it on every device.

## Architecture

```
decks/<lang>/deck.json      the shared course: static JSON, built into the app, cached offline
web/  (Vite + React PWA)    TanStack DB collections fed by Electric shapes; offline write queue
server/  (Bun)              Better Auth, Electric shape proxy, /api/write, Perennial AI, serves web/dist
Postgres + Electric         learner data; Electric streams each learner's rows to their devices
```

- **Decks are content, not user data.** The course is static JSON in `decks/`, built into the app. There is no AI at runtime for the course. Format and rules: [docs/schema.md](docs/schema.md).
- **Server** (`server/`): Bun, Postgres through `Bun.sql`, plain SQL migrations in `server/migrations/`.
  - **Accounts:** [Better Auth](https://better-auth.com). The first write ("Start learning") creates an anonymous user. Signing in with an email code moves the progress into the real account. Anonymous learners with no activity for 60 days are deleted by a daily job (`server/src/housekeeping.ts`).
  - **Reads:** `/api/shape` is an auth proxy in front of [Electric](https://electric-sql.com). The shape is always the server's own (`where user_id = <session user>`), never the client's.
  - **Writes:** `POST /api/write` takes a batch of mutations, checks them, scopes them to the session user, and applies them in one transaction. It returns the Postgres transaction id.
  - **Perennial AI:** task endpoints (`/api/ai/mine`, `/api/ai/examples`) through the Anthropic SDK. Each word costs one AI word from a monthly allowance (`FREE_CREDITS`). A global monthly budget (`MONTHLY_BUDGET_USD`) pauses AI for everyone when it is reached.
  - Also: `/health`, account deletion, structured JSON logs with request ids, Sentry (`server/instrument.ts`). All settings: `server/src/config.ts`.
- **Observability in the browser** (`web/src/observability.ts`): Sentry error reports and privacy-first PostHog events (no cookies, no autocapture, no session replay). Both are off unless their keys are set at build time.
- **Client** (`web/src/data/`): each synced table is a TanStack DB collection fed by an Electric shape, kept in SQLite (OPFS) on the device where the browser allows it. `@journeyapps/wa-sqlite` is pinned to 1.7.2 because `@tanstack/browser-db-sqlite-persistence` declares (and tests against) `^1.4.1`; move to 2.x only when that peer range does. Writes apply on the device at once, wait in an offline queue (IndexedDB), and go to `/api/write` when there is a connection. Memory (FSRS), unlocks and the garden are derived from the review log on the device; nothing derived is synced.

License: the code is [MIT](LICENSE). The course content in `decks/` is not ([decks/LICENSE](decks/LICENSE)). The order of the words is based on word frequencies from [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave (OpenSubtitles 2018, CC BY-SA 4.0).

Deploying: [docs/DEPLOY.md](docs/DEPLOY.md) (Railway + PlanetScale Postgres). Data model: [docs/schema.md](docs/schema.md). Deck content process: [docs/decks.md](docs/decks.md). Design and research: [DESIGN.md](DESIGN.md).

## Run locally

Needs [Bun](https://bun.sh) and Docker. One command:

```sh
bun run dev          # Postgres + Electric, migrations, API (:8787) and app (http://localhost:5173)
bun run dev:ai       # the same, plus a mock model so Perennial AI works without a key
```

It installs dependencies on first run. `web`, `server` and `scripts` are Bun workspaces with one lockfile (`bun.lock`), so `bun install` at the repo root installs all of them; package scripts still run from each folder (`cd web && bun run build`). Ctrl-C stops the API and the app; `docker compose down` stops the database.

No keys are needed. Without `RESEND_API_KEY`, the server is in dev mode: sign-in codes are printed in the output as `[mail] sign-in code for you@example.com: 123456`.

**Perennial AI without a key:** `bun run dev:ai`. The mock returns placeholder words, not real language.

**Start over:** `docker compose down -v`, then migrate again. Also clear the site data in the browser.

## Demo data (dev mode)

To see the garden and the progress views without weeks of practice, open the dev server with a `demo` switch. It makes a new anonymous learner with a made-up review history of 90 days, uploaded through the normal write API:

- `http://localhost:5173/?demo=es:30`: a Spanish learner with 30 words studied
- `http://localhost:5173/?demo=de`: a German learner with every deck word studied
- `http://localhost:5173/?demo=off`: remove the demo learner

The same options are in Settings → Developer tools. They are not in production builds.

## Test

```sh
cd web && bun run lint                 # oxlint --deny-warnings (CI fails on any warning)
cd web && bun test src                 # unit: FSRS (checked against ts-fsrs), planner, answer checking, text, deck schema
bun test scripts/deck web/src/deck     # decks: build, invariants, compatibility, replay
docker compose up -d                   # needed by the next two
cd server && bun test                  # sync, accounts and merging, AI limits, housekeeping (real Postgres + Electric, mock model)
cd web && bun run e2e                  # Playwright: starts its own server, mock model and Vite on other ports
```

## Decks

The shared course is static JSON in `decks/<lang>/`. The format and the rules are in [docs/schema.md](docs/schema.md). **Every source file needs a proofreader who is not its author:** the process, the checklist and the approval records (`reviews/NNNN.json`, enforced by CI) are in [docs/decks.md](docs/decks.md).

- `source/0001.json`, `0002.json`, …: the words, written by people or drafted by a model. No ids. At most 100 words per file. The order is the frequency rank.
- `ids.json`: the id manifest: `(lemma, pos, sense)` → word id, and `(word id, sentence)` → sentence id. Committed. Edit it by hand only to keep an id when you fix a typo in a lemma.
- `aliases.json` (optional): `{ "<duplicate word id>": "<target word id>" }`.
- `deck.json`: the published deck. Generated and committed.

```sh
bun install                                    # once, at the repo root (all workspaces)
bun scripts/deck/build.ts es                   # after you edit the source: assign ids, write deck.json and ids.json
bun scripts/deck/review.ts es 0001 --author … --reviewer …   # proofreader approves a source file (see docs/decks.md)
bun scripts/deck/check.ts --base origin/main   # what CI runs: schema, approvals, up to date, compatibility, diff report
```

A word removed from the source stays in `deck.json` with `retired: true`, so its reviews are kept. A sentence whose text changes gets a new id, and the old one is retired. CI fails when more than 5% of a deck's words are retired. To approve, add the `deck-big-change` label to the PR (locally: `DECK_ALLOW_BIG_CHANGE=1`).

**Drafting words with a model** (costs money, never runs in CI):

```sh
ANTHROPIC_API_KEY=… bun scripts/deck/generate.ts es --count 200    # model: DECK_MODEL, default claude-sonnet-4-5
bun server/mock-llm.ts & bun scripts/deck/generate.ts es --count 20 --mock   # plumbing only: placeholder words
```

It takes the next lemmas from the OpenSubtitles frequency list ([hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)), writes the entries through the Message Batches API, validates them, and appends them to the source. Read the diff before you run `build.ts`. Model drafts still need a proofreader.
