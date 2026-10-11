# Perennial

A spaced-repetition language app: zero to fluent in 5–10 minutes a day. It's a
from-scratch rethink of Anki. See [DESIGN.md](DESIGN.md) for what we changed
and why.

- **Time-boxed sessions, no due counts.** After a week off, you still do your 7 minutes.
- **MVP scope:** English speakers learning **Spanish** or **German**.
- **Frequency-first course.** Words come from OpenSubtitles frequency lists. An LLM writes the sentences, using only words you already know.
- **Memory per word × skill** (read / listen / write). Each review shows a different sentence.
- **FSRS-6** scheduling, with two buttons.
- **Mining:** paste any text and tap the unknown words. Each one keeps its original sentence.
- **Any LLM:** OpenAI-compatible APIs (OpenAI, OpenRouter, Groq, Ollama…) or Anthropic.
- **Offline-first PWA** with an event-sourced sync server. There is no "full sync".
- **Anki `.apkg` import** (content only).

## Hosted mode

The server can also run Perennial as a service. Learners sign in with an email code and get **Perennial AI** with no keys or setup. Their words sync with the account.

- **Free plan:** the shared course plus a small monthly allowance of AI words (personal words from your own texts, fresh sentences).
- **Pro plan** (Stripe subscription): a large allowance, plus fresh sentences generated automatically in the background.
- **Shared course content** is generated once per language pair and position in the frequency list, then cached for every learner. It costs learners no credits.
- **Safety limits:** a global monthly spend limit, per-user rate limits, and a daily limit on new shared batches. Together they stop runaway costs.
- **Your own key or a local model** still works, with or without an account.

| Variable | Purpose | Default |
|---|---|---|
| `APP_URL` | Public URL of the app (emails, Stripe redirects) | `http://localhost:5173` |
| `PERENNIAL_SECRET` | Hashes login codes and sessions. **Set in production.** | dev value |
| `ANTHROPIC_API_KEY` | Enables Perennial AI | off |
| `PERENNIAL_MODEL` | Model for hosted AI | `claude-haiku-4-5` |
| `MONTHLY_BUDGET_USD` | AI pauses for everyone past this monthly spend | `200` |
| `FREE_CREDITS` / `PRO_CREDITS` | Monthly AI words per plan | `25` / `2000` |
| `RESEND_API_KEY`, `MAIL_FROM` | Sends sign-in codes. Without a key, codes go to a dev outbox. | dev outbox |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Billing | off |
| `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` | Stripe price IDs | — |
| `PRICE_LABEL_MONTHLY`, `PRICE_LABEL_YEARLY` | Prices shown in the app | `$6 / month`, `$48 / year` |

Point the Stripe webhook at `/api/billing/webhook` and subscribe to `checkout.session.completed` and `customer.subscription.*`.

## Run

```sh
cd server && bun install && bun index.ts     # sync server on :8787
cd web && bun install && bun dev             # app on :5173 (proxies /sync)
```

Production: `cd web && bun run build`, then `bun server/index.ts` serves `web/dist` and `/sync` on one port.

Offline development without any keys: run `bun server/mock-llm.ts`. To use your own key, set the AI base URL to `http://localhost:8788/v1`. For hosted AI, start the server with `ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://localhost:8788`. Sign-in codes appear in the server log.

## Demo data (dev mode)

To see the garden and the progress views without weeks of practice, open the dev server with a `demo` switch:

- `http://localhost:5173/?demo=es#/garden`: a Spanish course with every demo word studied (about 330)
- `http://localhost:5173/?demo=de:120#/garden`: a German course with 120 words studied
- `http://localhost:5173/?demo=off`: remove the demo courses

The same options are in Settings → Developer tools. A demo course has a made-up review history of 90 days. It stays in the browser and does not sync. These options are not in production builds.

## Try it locally with mocks

One command runs hosted mode with no real keys or accounts:

```sh
./scripts/dev-hosted.sh          # needs Bun; Docker for billing
```

It starts a mock AI model, Stripe's official API mock, the server, and the app on http://localhost:5173.

1. **Sign in.** The 6-digit code appears in the terminal as `[mail] sign-in code for you@example.com: 123456`.
2. **Learn.** Words come from the mock model, and every gloss starts with `[mock]`.
3. **Run out of AI words faster** with `FREE_CREDITS=3 ./scripts/dev-hosted.sh`. Then add words from a text.
4. **Upgrade.** The button opens a fake Stripe Checkout address that does not load. Come back, then make the account Pro the way Stripe would, with a signed webhook:
   ```sh
   bun server/scripts/simulate-subscription.ts you@example.com active     # or past_due / canceled
   ```
   Open http://localhost:5173/?billing=success to see the "Pro is on" confirmation.
5. **Start over:** `rm /tmp/perennial-dev.db*`.

## Test

```sh
cd web && bun test src      # FSRS (checked against ts-fsrs), planner, answer checking, text
cd server && bun test       # sync, accounts, hosted AI limits, billing (Stripe SDK against stripe-mock in Docker)
cd web && bun run e2e       # Playwright: own-key and hosted flows, including checkout and webhooks
```
