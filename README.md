# Perennial

A spaced-repetition language app with a garden: every word you learn grows
into a plant. Zero to fluent in 5–10 minutes a day. It started as a rethink of
Anki; see [DESIGN.md](DESIGN.md) for what we changed and why.

- **Time-boxed sessions, no due counts.** After a week off, you still do your 7 minutes.
- **MVP scope:** English speakers learning **Spanish** or **German**.
- **Frequency-first course.** Words come from OpenSubtitles frequency lists. An LLM writes the sentences, using only words you already know.
- **Memory per word × skill** (read / listen / write). Each review shows a different sentence.
- **FSRS-6** scheduling, with two buttons.
- **The garden:** a plant per word, grown from the word itself. A strip on Today, and a retro 3D garden you can walk through.
- **Words from your own texts:** paste any text and tap the unknown words (Perennial AI, signed in).
- **Offline-first PWA.** Signing in is the sync: progress follows your account to every device.

## Server

Learners sign in with an email code. Everyone is on the free tier: the shared course, plus a small monthly allowance of AI words for personal extras (words from your own texts, fresh sentences).

- **Shared course content** is generated once per language pair and position in the frequency list, then cached for every learner. It costs learners nothing. (Planned: pre-made static decks.)
- **Safety limits:** a global monthly spend limit, per-user rate limits, and a daily limit on new shared batches. Together they stop runaway costs.
- **Billing code** (Stripe) exists but is dormant and not shown in the app; it is off unless the Stripe variables are set.

| Variable | Purpose | Default |
|---|---|---|
| `APP_URL` | Public URL of the app (emails, Stripe redirects) | `http://localhost:5173` |
| `PERENNIAL_SECRET` | Hashes login codes and sessions. **Set in production.** | dev value |
| `ANTHROPIC_API_KEY` | Enables Perennial AI | off |
| `PERENNIAL_MODEL` | Model for hosted AI | `claude-haiku-4-5` |
| `MONTHLY_BUDGET_USD` | AI pauses for everyone past this monthly spend | `200` |
| `FREE_CREDITS` | Monthly AI words per learner | `25` |
| `RESEND_API_KEY`, `MAIL_FROM` | Sends sign-in codes. Without a key, codes go to a dev outbox. | dev outbox |
| `STRIPE_*` | Dormant billing (not shown in the app) | off |

## Run

```sh
cd server && bun install && bun index.ts     # sync server on :8787
cd web && bun install && bun dev             # app on :5173 (proxies /sync)
```

Production: `cd web && bun run build`, then `bun server/index.ts` serves `web/dist` and `/sync` on one port.

Offline development without any keys: run `bun server/mock-llm.ts`, then start the server with `ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://localhost:8788`. Sign-in codes appear in the server log.

## Demo data (dev mode)

To see the garden and the progress views without weeks of practice, open the dev server with a `demo` switch:

- `http://localhost:5173/?demo=es#/garden`: a Spanish course with every demo word studied (about 330)
- `http://localhost:5173/?demo=de:120#/garden`: a German course with 120 words studied
- `http://localhost:5173/?demo=off`: remove the demo courses

The same options are in Settings → Developer tools. A demo course has a made-up review history of 90 days. It stays in the browser and does not sync. These options are not in production builds.

## Try it locally with mocks

One command runs hosted mode with no real keys or accounts:

```sh
./scripts/dev-hosted.sh          # needs Bun (and Docker for the dormant billing mock)
```

It starts a mock AI model, Stripe's official API mock, the server, and the app on http://localhost:5173.

1. **Sign in.** The 6-digit code appears in the terminal as `[mail] sign-in code for you@example.com: 123456`.
2. **Learn.** Words come from the mock model, and every gloss starts with `[mock]`.
3. **Run out of AI words faster** with `FREE_CREDITS=3 ./scripts/dev-hosted.sh`. Then add words from a text.
4. **Start over:** `rm /tmp/perennial-dev.db*`.

## Test

```sh
cd web && bun test src      # FSRS (checked against ts-fsrs), planner, answer checking, text
cd server && bun test       # sync, accounts, hosted AI limits, billing (Stripe SDK against stripe-mock in Docker)
cd web && bun run e2e       # Playwright: sign-in, sessions, garden, sync between devices
bun test scripts/deck web/src/deck   # decks: build, invariants, compatibility, replay
```

## Decks

The shared course is static JSON in `decks/<lang>/`. The format and the rules are in [docs/schema.md](docs/schema.md).

- `source/0001.json`, `0002.json`, …: the words, written by people or drafted by a model. No ids. At most 100 words per file. The order is the frequency rank.
- `ids.json`: the id manifest: `(lemma, pos, sense)` → word id, and `(word id, sentence)` → sentence id. Committed. Edit it by hand only to keep an id when you fix a typo in a lemma.
- `aliases.json` (optional): `{ "<duplicate word id>": "<target word id>" }`.
- `deck.json`: the published deck. Generated and committed.

```sh
cd scripts && bun install && cd ..
bun scripts/deck/build.ts es                   # after you edit the source: assign ids, write deck.json and ids.json
bun scripts/deck/check.ts --base origin/main   # what CI runs: schema, up to date, compatibility, diff report
```

A word removed from the source stays in `deck.json` with `retired: true`, so its reviews are kept. A sentence whose text changes gets a new id, and the old one is retired. CI fails when more than 5% of a deck's words are retired. To approve, add the `deck-big-change` label to the PR (locally: `DECK_ALLOW_BIG_CHANGE=1`).

**Drafting words with a model** (costs money, never runs in CI):

```sh
ANTHROPIC_API_KEY=… bun scripts/deck/generate.ts es --count 200    # model: DECK_MODEL, default claude-sonnet-4-5
bun server/mock-llm.ts & bun scripts/deck/generate.ts es --count 20 --mock   # plumbing only: placeholder words
```

It takes the next lemmas from the OpenSubtitles frequency list ([hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)), writes the entries through the Message Batches API, validates them, and appends them to the source. Read the diff before you run `build.ts`.
