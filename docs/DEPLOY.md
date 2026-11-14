# Deploying Perennial

This runbook deploys Perennial on **Railway** with a **PlanetScale Postgres** database. Follow the steps in order the first time. Later sections cover rollback, secret rotation, backups and monitoring.

## Overview

```
                 https://perennial.example
                            │
                ┌───────────▼────────────┐
  browser ────▶ │ web (Dockerfile)       │
                │ app + /api + /health   │
                └───────────┬────────────┘
                            │ SQL (5432, TLS)
                            ▼
                ┌────────────────────────┐ ◀──── housekeeping (cron, daily, same image)
                │ PlanetScale Postgres   │
                └────────────────────────┘
```

| Railway service | Source | Job |
|---|---|---|
| `web` (service name `perennial`) | This repo, `Dockerfile`, defined in `.railway/railway.ts` | Serves the web app, the API and auth. Runs migrations before each deploy. |
| `housekeeping` | This repo, `Dockerfile`, defined in `.railway/railway.ts` | Runs `bun --preload ./instrument.ts src/housekeeping.ts` once a day (errors go to Sentry), then exits. |

Third-party services: Resend (sign-in email), Anthropic (Perennial AI), Sentry (server and browser errors, optional), PostHog (a few product events, optional).

## 1. Accounts and secrets the owner must create

Create these before you start. Keep every secret in a password manager.

| Account | What to create | Used as |
|---|---|---|
| Domain registrar | A domain, e.g. `perennial.example`. Access to its DNS. | Custom domain, email domain |
| PlanetScale | A Postgres database (PS-5 or larger), a role for the app | `DATABASE_URL` |
| Railway | A project (paid plan) connected to the GitHub repo | Hosting |
| Resend | A verified sending domain and an API key ("Sending access" only) | `RESEND_API_KEY`, `MAIL_FROM` |
| Anthropic | An API key in a workspace with a monthly spend limit | `ANTHROPIC_API_KEY` |
| Sentry (optional) | One project for the server (platform "Bun") and one for the browser (platform "React"). In each project's security settings, turn on **Prevent storing of IP addresses**. Use the EU region if your users are mostly in the EU. | `SENTRY_DSN`, `VITE_SENTRY_DSN` |
| PostHog (optional) | A project (EU or US cloud) | `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` |
| Google Cloud (optional) | An OAuth client for "Continue with Google" (section 3.4) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

Generate this yourself:

```sh
openssl rand -base64 48   # BETTER_AUTH_SECRET (signs session cookies)
```

## 2. PlanetScale Postgres

### 2.1 Create the database

1. Create a **Postgres** database. Pick the region nearest to the Railway region that you will use (for example AWS `us-east-1` with Railway "US East").
2. Size: **PS-5** is enough to start (512 MB RAM, 10 GB storage). PS-5 single-node has no standby. For automatic failover, use the 3-node (HA) option.

### 2.2 Create the database role

With the CLI (`brew install planetscale/tap/pscale`, `pscale auth login`): `pscale role create <db> main perennial --inherited-roles postgres --format json` prints the role's `database_url` once (direct port 5432, `sslmode=verify-full`).

In the dashboard instead:

1. In **Settings → Roles**, click **New role**. Name it `perennial`.
2. Give it the inherited role `postgres` (so it can create tables).
3. Copy the password. You see it only once.

Use this one role for `web` and `housekeeping`. (The default `postgres` role also works. A separate role is better because you can reset its password without touching the default role.)

Connection string. Use the **direct** port **5432**, not PgBouncer (6432): the server uses session-level advisory locks and prepared statements.

```
postgresql://perennial.<id>:<password>@<host>.psdb.cloud:5432/postgres?sslmode=verify-full
```

Use `sslmode=verify-full`: it checks the certificate and the host name. Production uses it.

Copy the exact host, user and database name from the PlanetScale **Connect** page.

**Connection budget** (direct connections, one `web` replica):

| User | Connections |
|---|---|
| `web`: app pool (`@effect/sql-pg`) | up to 10 |
| `web`: Better Auth `pg` pool | up to 4 |
| `housekeeping`, migrations | 1 each, short |

That is about 16. Add 14 for each extra `web` replica. Check the limit with `show max_connections;`.

### 2.3 Check (after the first deploy)

The live security check is `bun scripts/live-check.ts <APP_URL>` (headers, closed dev and unused auth endpoints, no file leaks, cross-user isolation, CSRF, limits; it cleans up after itself). The alarm runs it after every deploy ("The alarm", below).

## 3. Railway project

Create one Railway project with a `production` environment. Put all services in the same region, near PlanetScale.

### 3.1 Shared variables

In **Project Settings → Shared Variables** (environment `production`), add:

| Name | Value |
|---|---|
| `DATABASE_URL` | The PlanetScale direct URL from 2.2 |

Services refer to it as `${{shared.DATABASE_URL}}`.

### 3.2 Service `web`

1. **New → GitHub Repo** → this repo. Name the service `web`. Branch: `main`.
2. `.railway/railway.ts` (Railway Infrastructure as Code) defines the build and deploy settings: Dockerfile build, pre-deploy migration (`bun src/migrate.ts`), healthcheck `/health` (it also checks the database), restart on failure, and Wait for CI. Apply changes with `railway config plan` then `railway config apply`. Variables are not in the file: set them in Railway.
3. Wait for CI is on (`checkSuites: true` in `.railway/railway.ts`), so a red build on `main` does not deploy.
4. **Networking:** generate a Railway domain for a first test. Target port: `8080`.
5. Variables:

**Required**

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `${{shared.DATABASE_URL}}` | Used by the app and by the pre-deploy migration |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` | Signs session cookies. The code falls back to a public dev value, so **never leave it empty**. |
| `APP_URL` | `https://perennial.example` | The public URL, no trailing slash. Better Auth accepts requests only from this origin. Use the Railway domain until the custom domain works. |
| `RESEND_API_KEY` | `re_…` | **Required.** Without it the server runs in **dev mode**: sign-in codes go to `/api/dev/outbox`, where anyone can read them, and auth rate limits are off. |
| `MAIL_FROM` | `Perennial <hello@perennial.example>` | Must use the domain that you verified in Resend |
| `PORT` | `8080` | The Dockerfile sets it too. Keep it equal to the domain's target port. |

**Perennial AI** (AI is off when `ANTHROPIC_API_KEY` is not set)

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | not set (AI off) | |
| `PERENNIAL_MODEL` | `claude-haiku-4-5` | If you change it, add its price to `PRICES` in `server/src/config.ts`. Unknown models are costed at $5/$25 per million tokens. |
| `FREE_CREDITS` | `25` | AI words per learner per month |
| `MONTHLY_BUDGET_USD` | `200` | AI stops for everyone when this month's spend reaches this value. Also set a limit in the Anthropic console. |
| `AI_RPM` | `20` | AI requests per user per minute, per instance |

**Other runtime settings**

| Variable | Default | Notes |
|---|---|---|
| `MIN_CLIENT_VERSION` | `0.0.0` | Clients with an older `web/package.json` version get "please reload" instead of writing. Raise it only when the write format changes. |
| `ANONYMOUS_RETENTION_DAYS` | `60` | Used by housekeeping. Keep the value equal on both services. |
| `SENTRY_DSN` | not set | Server error reports (web and housekeeping). |
| `TURNSTILE_SECRET_KEY` | not set | Server half of the bot check (see `VITE_TURNSTILE_SITE_KEY`). Recommended before launch. |
| `CLIENT_IP_HEADERS` | `x-real-ip,x-forwarded-for` | Headers our proxy sets with the client IP, for rate limits. Railway sets `X-Real-IP`. Behind Cloudflare, use `cf-connecting-ip`: the server trusts it only when `X-Real-IP` is one of Cloudflare's IP ranges (server/src/clientIp.ts), and otherwise uses `X-Real-IP`, so a request that skips Cloudflare can't choose its own IP. If no header gives an IP, all clients share one rate-limit bucket: check the logs for Better Auth's warning after the first deploy. |
| `CODES_PER_EMAIL_15MIN`, `CODES_PER_EMAIL_DAY` | `3`, `10` | Sign-in codes one address can receive, whatever the IP (email bombing). Extra requests get the normal answer but no email. |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | |
| `POSTHOG_HOST` | not set | Optional. An extra origin for the CSP `connect-src`, for example a PostHog reverse proxy. Normally not needed: see `VITE_POSTHOG_HOST`. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | not set (no Google button) | "Continue with Google" (section 3.4). Set both or neither: production does not start with only one. |

**Build arguments** (Railway passes service variables with these names to the Docker build; changing one needs a rebuild)

| Variable | Default | Notes |
|---|---|---|
| `VITE_SENTRY_DSN` | empty (off) | Browser error reports (`@sentry/react`). The server reads the same variable at runtime and allows its ingest host (any region) in the CSP `connect-src`. |
| `VITE_TURNSTILE_SITE_KEY` | empty (off) | Cloudflare Turnstile bot check before a new anonymous user and before a sign-in code. Set together with `TURNSTILE_SECRET_KEY` (the server refuses to start with only one). The server then allows `challenges.cloudflare.com` in the CSP.
| `VITE_POSTHOG_KEY` | empty (off) | Turns on PostHog: no cookies, no autocapture, no session replay, Do Not Track respected, a few named events. |
| `VITE_POSTHOG_HOST` | `https://eu.i.posthog.com` | The PostHog host. When `VITE_POSTHOG_KEY` is set, the server allows this host in the CSP `connect-src`. |
| `VITE_AUDIO_BASE_URL` | empty (browser speech) | Recorded audio (#306): the public URL of the R2 bucket `perennial-audio`, `https://audio.playperennial.com`. Set it only once the clips are uploaded (`bun scripts/tts/render.ts`). The bucket needs a CORS rule that allows `GET` from the app's origin. The server reads the same variable at runtime and allows it in the CSP `connect-src`. Words with no clip still use browser speech. |
| `VITE_RELEASE` | `dev` | Release name in browser error reports. Set it to `${{RAILWAY_GIT_COMMIT_SHA}}` so that it matches the server's release. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | empty (off) | Uploads the browser source maps to Sentry, so browser errors have readable stacks. The token is a Sentry **organization auth token** (Settings → Auth Tokens) and is a secret: it stays in the build stage, not in the final image or the JavaScript. `SENTRY_PROJECT` is the browser project's slug. With a token set, a failed upload or a missing org or project fails the build, so the deploy stops (#328). |

The `VITE_*` values end up in the public JavaScript. That is expected: a Sentry DSN and a PostHog project key are not secrets.

**Do not set in production:** `PERENNIAL_DEV` (turns on dev mode), `ANTHROPIC_BASE_URL` (for the mock model only), `LOG_PRETTY`. `NODE_ENV` and `PERENNIAL_STATIC` come from the Dockerfile. The release name comes from `RAILWAY_GIT_COMMIT_SHA`, which Railway sets.

### 3.3 Service `housekeeping`

1. **New → GitHub Repo** → this repo again. Name the service `housekeeping`.
2. `.railway/railway.ts` sets the start command `bun --preload ./instrument.ts src/housekeeping.ts`, the cron schedule `17 3 * * *` (daily, 03:17 UTC) and no healthcheck (the job does not serve HTTP). Nothing to set in the dashboard.
3. No domain.
4. Variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{shared.DATABASE_URL}}` |
| `ANONYMOUS_RETENTION_DAYS` | Same as on `web` (default `60`) |

The job deletes anonymous learners with no activity for that many days (their data cascades), AI request logs older than 180 days, and expired sign-in codes and sessions. An advisory lock stops two runs at the same time. It prints one JSON log line with the counts.

### 3.4 Sign-in with Google (optional)

Without these steps the app shows only email codes. Google and email codes reach the same account: a learner who signed in with a code and then uses Google (or the other way round) keeps their progress. Google joins an existing account only when Google says the email is verified.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and pick or create a project, e.g. `Perennial`.
2. **APIs & Services → OAuth consent screen** (also called **Google Auth Platform**):
   - App name `Perennial`, a support email, and your domain under **Authorized domains**.
   - Audience: **External**.
   - Data access (scopes): only `openid`, `email` and `profile`. These need no review by Google.
   - Press **Publish app** to move it from **Testing** to **In production**. In Testing, only the test users you list can sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs**: `https://<your domain>/api/auth/callback/google`. For local testing, also add `http://localhost:5173/api/auth/callback/google`.
   - **Authorized JavaScript origins**: not needed.
4. Copy the client ID and the client secret. On the Railway service `web`, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then deploy.
5. Check: `https://<your domain>/api/server` shows `"google": true`, and the sign-in screen shows **Continue with Google**.

Do not add Google to Better Auth's `trustedProviders` (server/src/auth.ts). A trusted provider joins accounts even when the email is not verified.

To rotate the secret: in the OAuth client, add a new secret, update `GOOGLE_CLIENT_SECRET`, redeploy, then delete the old secret.

## 4. Custom domain and email

### 4.1 Domain for the app

Production uses `playperennial.com`, with DNS and the CDN at Cloudflare (Free plan).

1. Add the domain and `www` on Railway: `railway domain playperennial.com --service perennial`, and the same for `www.playperennial.com`. Each one prints a `CNAME` and a `TXT` record.
2. In Cloudflare, add these records as **DNS only** (grey cloud). Cloudflare flattens the `CNAME` at the apex.
3. Wait until `railway domain status <domain> --service perennial` shows `CERTIFICATE_STATUS_TYPE_VALID`. Railway cannot get its certificate while the record is proxied.
4. In Cloudflare, set **SSL/TLS** to **Full (strict)** and turn on **Always Use HTTPS**. Then set the two `CNAME` records to **Proxied** (orange cloud).
5. On `web`, set `APP_URL=https://playperennial.com` and `CLIENT_IP_HEADERS=cf-connecting-ip`. Behind Cloudflare, `X-Real-IP` is the IP of Cloudflare, not of the learner.
6. In Cloudflare, under **Caching → Configuration**, set **Browser Cache TTL** to **Respect Existing Headers**. With any other value Cloudflare replaces our `no-cache` with its own max-age (4 hours by default), so browsers keep an old `/sw.js` and `index.html` after a deploy. Check: `curl -sI https://playperennial.com/sw.js | grep -i cache-control` shows `no-cache`.

Better Auth accepts requests only from `APP_URL`. So the server redirects `www` and the Railway domain to `APP_URL` (308, path kept).

The CDN caches the hashed files in `/assets/` for one year. `index.html`, `/sw.js` and other top-level files revalidate on each load (`no-cache`). `/api` answers are `no-store`. A deploy therefore needs no cache purge.

When `APP_URL` starts with `https://`, the server sends HSTS.

### 4.2 Sending domain in Resend

1. Resend → **Domains → Add domain**. Use the app domain (or a subdomain such as `mail.perennial.example`).
2. Add the DNS records that Resend shows:
   - **DKIM:** a `TXT` record at `resend._domainkey`.
   - **SPF:** an `MX` record and a `TXT` record (`v=spf1 include:amazonses.com ~all`) on the `send` subdomain. This is the return path, so it does not change the SPF record of your main domain.
3. Add **DMARC** yourself: a `TXT` record at `_dmarc.perennial.example`:
   ```
   v=DMARC1; p=none; rua=mailto:dmarc@perennial.example
   ```
   After two to four weeks of clean reports, change `p=none` to `p=quarantine`.
4. Wait until Resend shows the domain as **Verified**.
5. Create an API key with **Sending access** for this domain only. Put it in `RESEND_API_KEY`. Set `MAIL_FROM` to an address on this domain.
6. Send yourself a code. In Gmail, "Show original" must show `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.

## 5. First deploy checklist

Do these in order. Tick each one.

- [ ] PlanetScale: role `perennial` created; direct URL (port 5432, `sslmode=verify-full`) saved in the shared variable.
- [ ] `web` variables set, including `RESEND_API_KEY` and a new `BETTER_AUTH_SECRET`.
- [ ] `web` deployed. The pre-deploy log shows `applied 0001_init.sql` (later: `up to date`).
- [ ] The startup log line `perennial server started` shows `"mail":"resend"` and the expected `"ai"` model.
- [ ] `curl https://<domain>/health` returns `{"ok":true,"release":"<git sha>"}`.
- [ ] `curl https://<domain>/api/dev/outbox?email=x` returns **404** `{"error":"not_found"}`. If it returns anything else, the server is in dev mode: stop and fix `RESEND_API_KEY` / `PERENNIAL_DEV`.
- [ ] `curl -I https://<domain>/` shows `content-security-policy` and `strict-transport-security`.
- [ ] Browser, private window: start learning (anonymous), do a few reviews, reload. The progress stays.
- [ ] Add your email, enter the code from the email. The progress stays.
- [ ] Second browser: sign in with the same email. The progress is there.
- [ ] Lose the connection during a session (DevTools → Network → Offline), do reviews, go online. The reviews reach the server (check `/api/rows` on the second device, or reload it).
- [ ] Perennial AI: add words from a short text. The credit count goes down. `select task, ok, usd from ai_request order by id desc limit 5;` shows the call.
- [ ] `housekeeping`: run it once by hand (**Deployments → Run now**, or redeploy). The log shows a `housekeeping` line with counts.
- [ ] Settings → Delete my account works for a test account. Its rows are gone from `review`, `course` and `"user"`.
- [ ] `/privacy.html` and `/terms.html` are reviewed and the placeholders are filled in.
- [ ] Sentry (if used): the server and browser projects receive events. The browser console shows no CSP errors (`Refused to connect`).
- [ ] PostHog (if used): a `course_started` event arrives after you start a course in a private window (with Do Not Track off).
- [ ] Anthropic console: monthly spend limit set. Railway: usage alert set.
- [ ] PlanetScale: backup retention set (see 7).

## 6. Deploys and rollback

**Normal deploy:** merge to `main`. Railway builds the image, runs `bun src/migrate.ts` in it, starts the new container, waits for `/health`, and then switches traffic. If the migration or the healthcheck fails, the old deployment stays live.

**Migrations rule: expand, then contract.** A migration must keep the previous app version working: add tables and columns; drop or rename only in a later release, after no deployed code uses them. Because of this rule, you can roll back code without rolling back the schema. There are no down migrations.

**Roll back the code:**

1. `web` → **Deployments** → find the last good deployment → **⋯ → Rollback**.
2. Do the same for `housekeeping` if its code changed.
3. Rollback does not undo migrations. If a migration is wrong, write a new migration that fixes it, and deploy forward.
4. If the bad release raised `MIN_CLIENT_VERSION`, set it back first. Otherwise the old clients cannot write.

**Releases that change the write format:** bump `version` in `web/package.json`, deploy, and then raise `MIN_CLIENT_VERSION` to that version. Older clients keep their queued writes and ask the learner to reload.

## 7. Backups and restore

### 7.1 What PlanetScale does

- Automatic backups every 12 hours. The default retention is **2 days**. Increase it in **Backups → Backup policy** (for example 14 or 30 days), and write the value into the privacy policy.
- Point-in-time recovery: you can restore to any time between the oldest backup and about 5 minutes ago.
- Before a risky migration or an import, make a manual backup: **Backups → Create new backup**.

### 7.2 Extra logical backup (optional)

From a trusted machine:

```sh
pg_dump "$DATABASE_URL" --format=custom --no-owner --file perennial-$(date +%F).dump
```

Store the file encrypted. It contains email addresses.

### 7.3 Restore

A restore always creates a **new branch**. It does not overwrite the current one.

1. **Backups** → choose a backup (or a point in time) → **Restore to new branch**. Use the same cluster size.
2. On the new branch: reset the password of the `perennial` role (roles are copied, passwords are not).
3. Update the shared `DATABASE_URL` in Railway to the new branch. Or promote the new branch to production in PlanetScale, if you want to keep the old host name.
4. Redeploy `web` and `housekeeping`.
5. Check with `bun scripts/live-check.ts` (2.3) and the browser checks in 5.

Learners' devices then read the restored data on their next read (start, or the tab coming back). Writes that an open tab has not sent yet are sent after it. Reviews made after the restore point that are only on the server are lost.

## 8. Rotate secrets

After you change a variable, Railway asks you to deploy the change. Deploy all services that use it.

| Secret | How | Effect |
|---|---|---|
| Database password | PlanetScale → **Roles** → `perennial` → **Reset credentials**. Update the shared `DATABASE_URL`. Redeploy `web`, `housekeeping`. | Errors for about one or two minutes, between the reset and the redeploy. For no downtime: create a second role first, update `DATABASE_URL` to it, then redeploy, then retire the old role. |
| `BETTER_AUTH_SECRET` | New value on `web`, redeploy. **Only when it leaked.** | **Every learner is signed out.** Learners with an email sign in again. **Anonymous learners lose access to their progress** (it stays on the server until housekeeping deletes it). The per-email sign-in code limits start again for up to a day (the code log is keyed with this secret). |
| `RESEND_API_KEY` | Create a new key in Resend, update `web`, redeploy, then delete the old key. | None, if you do it in this order. |
| `ANTHROPIC_API_KEY` | Same order as Resend. | None. |
| `SENTRY_DSN`, `VITE_SENTRY_DSN` | Sentry → project → **Client Keys (DSN)** → create a new key. Update the variable (`SENTRY_DSN` on `web` and `housekeeping`; `VITE_SENTRY_DSN` on `web`, which rebuilds the app), redeploy, then disable the old key. A DSN only lets someone send reports, so rotate it when it is abused. | None, if you do it in this order. |

Also rotate a secret when a person with access leaves.

## 9. After launch: what to watch

**Every day in the first week, then weekly:**

- **Railway logs** (`web`): search for `@level:error`. Each line has `reqId`, and `userId` when the user is known. The same id is in the `X-Request-Id` header and in Sentry. See "Reading the request log" below.
- **Sentry:** new issues on the server and in the browser.
- **PostHog:** the funnel `course_started` → `session_finished` → `email_added`.
- **Railway metrics:** memory and CPU of `web`.
- **PlanetScale:** storage used (PS-5 includes 10 GB), connections, CPU.
- **AI spend:**
  ```sql
  select period, usd from ai_spend order by period desc limit 3;
  select date_trunc('day', created_at) d, count(*), sum(usd), avg(ms)::int, sum((not ok)::int) failed
  from ai_request group by 1 order by 1 desc limit 14;
  ```
  When spend comes near `MONTHLY_BUDGET_USD`, AI pauses for everyone. Decide in advance whether to raise the budget.
- **Sign-ups and email:** Resend dashboard for bounces and complaints. Many sends to one address can mean abuse (the server allows 3 codes per 5 minutes per client).
- **Housekeeping:** one `housekeeping` log line each day. If it is missing, the cron did not run.
- **Health:** add an external uptime check on `https://<domain>/health` (for example Better Stack or UptimeRobot).

### Reading the request log

Each request writes **one** JSON line when it ends (`"msg":"request"`, or `"slow request"` over 1 s). What happened during the request is on that line, not on lines of its own ("wide events", `server/src/log.ts`). Lines carry ids, counts and short values only: never emails, codes or request bodies.

| Field | On | Meaning |
|---|---|---|
| `reqId`, `traceId` | every line | The request; `traceId` opens the same request in Sentry (Performance → search by trace id). Only sampled requests have a full trace there (10 %), but any error from the request has the same id. |
| `method`, `path`, `status`, `ms` | every request | |
| `userId` | known users | Set by the session, or by the sign-in itself |
| `signup` | new user | `anonymous` (Start learning) or `email` (first email sign-in) |
| `signin` | new session | `anonymous` or `email` |
| `linkedFrom` | email sign-in from an anonymous learner | The anonymous user whose data moved to `userId` |
| `otp` | code request | `sent`, or `capped` (per-email limit; also a warning line) |
| `courseStarted` | `/api/write` | Language(s) of a course this write created |
| `writes`, `writeTypes`, `writeChanged` | `/api/write` | Batch size, e.g. `review.insert:3 course.upsert:1`, and whether anything changed |
| `aiTask`, `aiModel`, `aiOk`, `aiUsd`, `aiTokensIn`, `aiTokensOut`, `aiMs` | `/api/ai/*` | The model call (the same is in the `ai_request` table) |
| `accountDeleted` | `/api/account/delete` | `true` |

Railway search examples: `@signup:email`, `@courseStarted:de`, `@otp:capped`, `@userId:<id>` (one learner's story), `@status:500`. The same fields are attributes on the request's Sentry trace. The housekeeping job writes one `housekeeping` line with its counts and `ms`.

**Set alerts:** Railway usage limit and alert, Anthropic spend limit, PlanetScale storage, Sentry issue alerts to email.

## 10. Local copy of production settings

Never copy production secrets to a laptop. For local work, use `docker compose up -d` (see the README). The local server uses dev defaults for everything.

## Removing Electric (once)

The code no longer uses Electric: sync is `GET /api/rows` (the learner's rows, read at start and when the tab comes back) and `POST /api/write`. Production still has the old `electric` Railway service and its Postgres replication slot from before this change. Remove them by hand, once:

1. Railway: stop and delete the `electric` service and its volume.
2. Postgres: `select pg_drop_replication_slot('electric_slot_default');` then `drop publication electric_publication_default;`.
3. Shared variables: delete `ELECTRIC_SECRET`. On `web`, delete `ELECTRIC_URL`.
4. The `perennial` role no longer needs the `REPLICATION` attribute. Remove it in **Settings → Roles**, if you want.

## Continuous deployment and rollback

Every merge to `main` deploys to production by itself: Railway builds `main` after CI passes (`checkSuites: true` in `.railway/railway.ts`), runs the migrations before the switch (pre-deploy command), and only moves traffic once `/health` (which checks the database) answers. A red CI run on `main` never deploys. After each deploy, the alarm (below) runs `bun scripts/live-check.ts` against production.

### The alarm

`.github/workflows/alarm.yml` keeps one P0 issue, titled "Alarm: main is red or production is behind". The logic is in `scripts/alarm/`. It runs after each CI run on `main`, once an hour, and after each deploy that Railway reports. The issue is open while any of these is true:

- **Main is red:** the latest finished CI run on `main` failed (cancelled runs do not count). The issue lists the failing jobs and tests, the last green commit, and the commits that landed after it.
- **Production is behind:** the release in `/health` does not have a commit that was on `main` an hour ago.
- **The live check failed** after a deploy. This stays until production runs another release.
- The alarm could not read `/health`.

When the state changes, the alarm edits the issue and adds a comment. When none is true, it closes the issue. To see what it would say, without changing anything: `GITHUB_REPOSITORY=jussisaurio/perennial bun scripts/alarm/run.ts --print`. If the alarm's own run fails, GitHub emails the owner.

Rollback:
- **Fastest:** Railway dashboard → service `perennial` → Deployments → the last good one → **Redeploy**. (The CLI's `railway redeploy` only repeats the latest deployment.)
- **In git:** revert the bad merge on `main` (`git revert -m 1 <merge sha>`); CI and the deploy follow as usual.
- **Migrations are expand-then-contract** (server/src/migrate.ts): a deploy never drops what the previous version needs, so rolling back the app never needs a database rollback.
- Open tabs from the newer version get the gentle "new version" banner and reload into the rolled-back one.
