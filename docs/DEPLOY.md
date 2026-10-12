# Deploying Perennial

This runbook deploys Perennial on **Railway** with a **PlanetScale Postgres** database. Follow the steps in order the first time. Later sections cover rollback, secret rotation, backups and monitoring.

## Overview

```
                 https://perennial.example
                            │
                ┌───────────▼────────────┐      private network      ┌──────────────────────┐
  browser ────▶ │ web (Dockerfile)       │ ───────────────────────▶ │ electric             │
                │ app + /api + /health   │  ELECTRIC_URL (port 3000) │ electricsql/electric │
                └───────────┬────────────┘                           │ volume: shape logs   │
                            │ SQL (5432, TLS)                        └──────────┬───────────┘
                            ▼                                                   │ logical replication
                ┌────────────────────────┐ ◀────────────────────────────────────┘
                │ PlanetScale Postgres   │ ◀──── housekeeping (cron, daily, same image)
                └────────────────────────┘
```

| Railway service | Source | Job |
|---|---|---|
| `web` (service name `perennial`) | This repo, `Dockerfile`, defined in `.railway/railway.ts` | Serves the web app, the API, auth, and the Electric proxy (`/api/shape`). Runs migrations before each deploy. |
| `electric` | Docker image `electricsql/electric:1.8.1` | Reads changes from Postgres (logical replication) and serves shapes to `web`. Private only. |
| `housekeeping` | This repo, `Dockerfile`, defined in `.railway/railway.ts` | Runs `bun --preload ./instrument.ts src/housekeeping.ts` once a day (errors go to Sentry), then exits. |

Third-party services: Resend (sign-in email), Anthropic (Perennial AI), Sentry (server and browser errors, optional), PostHog (a few product events, optional).

## 1. Accounts and secrets the owner must create

Create these before you start. Keep every secret in a password manager.

| Account | What to create | Used as |
|---|---|---|
| Domain registrar | A domain, e.g. `perennial.example`. Access to its DNS. | Custom domain, email domain |
| PlanetScale | A Postgres database (PS-5 or larger), a role with `REPLICATION` | `DATABASE_URL` |
| Railway | A project (paid plan) connected to the GitHub repo | Hosting |
| Resend | A verified sending domain and an API key ("Sending access" only) | `RESEND_API_KEY`, `MAIL_FROM` |
| Anthropic | An API key in a workspace with a monthly spend limit | `ANTHROPIC_API_KEY` |
| Sentry (optional) | One project for the server (platform "Bun") and one for the browser (platform "React"). In each project's security settings, turn on **Prevent storing of IP addresses**. Use the EU region if your users are mostly in the EU. | `SENTRY_DSN`, `VITE_SENTRY_DSN` |
| PostHog (optional) | A project (EU or US cloud) | `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` |

Generate these yourself:

```sh
openssl rand -base64 48   # BETTER_AUTH_SECRET (signs session cookies)
openssl rand -hex 32      # ELECTRIC_SECRET (shared by web and electric)
```

## 2. PlanetScale Postgres

### 2.1 Create the database

1. Create a **Postgres** database. Pick the region nearest to the Railway region that you will use (for example AWS `us-east-1` with Railway "US East").
2. Size: **PS-5** is enough to start (512 MB RAM, 10 GB storage). PS-5 single-node has no standby. For automatic failover, use the 3-node (HA) option.

### 2.2 Set cluster parameters for logical replication

Electric reads changes through logical replication. In the PlanetScale dashboard, go to **Settings → Cluster configuration → Parameters** and check or set:

| Parameter | Value | Why |
|---|---|---|
| `wal_level` | `logical` | Required by Electric. Check with `show wal_level;`. |
| `max_replication_slots` | `10` or more | Electric uses one slot. |
| `max_wal_senders` | `10` or more | Not less than `max_replication_slots`. |
| `max_slot_wal_keep_size` | `4096` (MB) | Limits the WAL that a stopped Electric can hold back. Without a limit, the disk can fill up. |
| `sync_replication_slots` | `on` | The slot survives a failover (HA clusters). Electric creates its slot with `failover = true`. |
| `hot_standby_feedback` | `on` | Required with `sync_replication_slots`. |
| `max_connections` | 60 or more if possible | See the connection budget below. |

PlanetScale warns you if it finds a logical slot without failover support. Electric's slot has failover support when `sync_replication_slots` is on.

**Connection budget** (direct connections, one `web` replica):

| User | Connections |
|---|---|
| `web`: Bun SQL pool | up to 10 |
| `web`: Better Auth `pg` pool | up to 4 |
| `electric`: query pool (`ELECTRIC_DB_POOL_SIZE`) | 10 (we set it; the default is 20) |
| `electric`: replication | 1 |
| `housekeeping`, migrations | 1 each, short |

That is about 27. Add 14 for each extra `web` replica. Check the limit with `show max_connections;`.

### 2.3 Create the database role

With the CLI (`brew install planetscale/tap/pscale`, `pscale auth login`): `pscale role create <db> main perennial --inherited-roles postgres --with-replication --format json` prints the role's `database_url` once (direct port 5432, `sslmode=verify-full`). Use it as is for `web` and `housekeeping`; for `electric`, change `sslmode` to `require` and set the CA file (3.2). Cluster parameters: `pscale branch resize <db> main --parameters pgconf.max_connections=50 --parameters pgconf.max_slot_wal_keep_size=4096 --parameters pgconf.sync_replication_slots=on --parameters pgconf.hot_standby_feedback=on --wait` (`wal_level`, slots and senders are already right by default; check with `pscale branch parameters list <db> main --namespace pgconf`).

In the dashboard instead:

**Rule: Electric must connect as the role that owns the tables.** Electric creates its publication and adds tables to it. Postgres allows this only for the table owner. PlanetScale does not let you change table ownership later. So the role that runs the migrations must be the same role that Electric uses.

Do this:

1. In **Settings → Roles**, click **New role**. Name it `perennial`.
2. Give it the inherited role `postgres` (so it can create tables and a publication).
3. Turn on the **REPLICATION** attribute.
4. Copy the password. You see it only once.

Use this one role for `web`, `housekeeping` and `electric`. (The default `postgres` role also has `REPLICATION` and also works. A separate role is better because you can reset its password without touching the default role.)

Connection string. Use the **direct** port **5432**, not PgBouncer (6432). Electric needs a replication connection, and the server uses session-level advisory locks and prepared statements:

```
postgresql://perennial.<id>:<password>@<host>.psdb.cloud:5432/postgres?sslmode=require
```

Copy the exact host, user and database name from the PlanetScale **Connect** page.

### 2.4 Check (after the first deploy)

After every deploy, run the live security check: `bun scripts/live-check.ts <APP_URL>` (headers, closed dev and unused auth endpoints, no file leaks, cross-user isolation, CSRF, limits; it cleans up after itself).


```sql
show wal_level;                                         -- logical
select rolname, rolreplication from pg_roles where rolname like 'perennial%';   -- t
select tablename, tableowner from pg_tables where schemaname = 'public';        -- your role
select * from pg_publication_tables;                    -- Electric adds tables when shapes are first used
select slot_name, active, failover from pg_replication_slots;                   -- electric_slot_default, t, t
```

**Alternative (manual publication).** If you must run migrations as a different role, run Electric in manual mode. Set `ELECTRIC_MANUAL_TABLE_PUBLISHING=true` on `electric` and, as the table owner:

```sql
create publication electric_publication_default
  for table course, review, word_state, user_word, user_sentence;
alter publication electric_publication_default owner to <electric role>;
grant select on course, review, word_state, user_word, user_sentence to <electric role>;
```

The migrations already set `replica identity full` on these tables. Every future synced table must be added to the publication by hand.

## 3. Railway project

Create one Railway project with a `production` environment. Put all services in the same region, near PlanetScale.

### 3.1 Shared variables

In **Project Settings → Shared Variables** (environment `production`), add:

| Name | Value |
|---|---|
| `DATABASE_URL` | The PlanetScale direct URL from 2.3 |
| `ELECTRIC_SECRET` | The value from `openssl rand -hex 32` |

Services refer to them as `${{shared.DATABASE_URL}}` and `${{shared.ELECTRIC_SECRET}}`.

### 3.2 Service `electric`

1. **New → Docker Image** → `electricsql/electric:1.8.1`. Name the service `electric`.
2. **Add a volume.** Mount path: `/var/lib/electric`. Size: 5 GB to start.
3. **Do not** add a public domain. Only `web` talks to Electric, over the private network.
4. **Healthcheck path:** `/v1/health`.
5. Variables:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | the role's URL with **`sslmode=require`** | Direct port 5432, the table-owner role. Electric rejects `sslmode=verify-full`; it verifies the server with the CA file below instead. |
| `ELECTRIC_DATABASE_CA_CERTIFICATE_FILE` | `/etc/ssl/certs/ca-certificates.crt` | The image's system CA bundle (PlanetScale uses a public CA), so `require` still checks the server's identity. |
| `ELECTRIC_SECRET` | `${{shared.ELECTRIC_SECRET}}` | Electric rejects shape requests without it |
| `ELECTRIC_STORAGE_DIR` | `/var/lib/electric/persistent` | On the volume, so shapes survive restarts |
| `ELECTRIC_PORT` | `3000` | `web` connects to this port |
| `PORT` | `3000` | Electric ignores it. Railway uses it for the healthcheck. |
| `ELECTRIC_LISTEN_ON_IPV6` | `true` | Railway's private network uses IPv6 (needed in legacy environments, harmless in new ones) |
| `ELECTRIC_DB_POOL_SIZE` | `10` | Smaller than the default (20) for PS-5 |
| `ELECTRIC_LOG_LEVEL` | `info` (optional) | `debug` while you debug |

If Electric cannot write to the volume (permission error in the log), add `RAILWAY_RUN_UID=0`.

Upgrade Electric only on purpose: change the image tag, read the Electric release notes first, and keep the client packages (`@electric-sql/client`, `@tanstack/electric-db-collection`) compatible.

### 3.3 Service `web`

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
| `ELECTRIC_URL` | `http://${{electric.RAILWAY_PRIVATE_DOMAIN}}:3000` | Private URL of `electric` |
| `ELECTRIC_SECRET` | `${{shared.ELECTRIC_SECRET}}` | Must match `electric` |
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
| `CLIENT_IP_HEADERS` | `x-real-ip,x-forwarded-for` | Headers our proxy sets with the client IP, for rate limits. Railway sets `X-Real-IP`. Behind Cloudflare, use `cf-connecting-ip`. If no header gives an IP, all clients share one rate-limit bucket: check the logs for Better Auth's warning after the first deploy. |
| `CODES_PER_EMAIL_15MIN`, `CODES_PER_EMAIL_DAY` | `3`, `10` | Sign-in codes one address can receive, whatever the IP (email bombing). Extra requests get the normal answer but no email. |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | |
| `POSTHOG_HOST` | not set | Optional. An extra origin for the CSP `connect-src`, for example a PostHog reverse proxy. Normally not needed: see `VITE_POSTHOG_HOST`. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent` |

**Build arguments** (Railway passes service variables with these names to the Docker build; changing one needs a rebuild)

| Variable | Default | Notes |
|---|---|---|
| `VITE_SENTRY_DSN` | empty (off) | Browser error reports (`@sentry/react`). The server reads the same variable at runtime and allows its ingest host (any region) in the CSP `connect-src`. |
| `VITE_TURNSTILE_SITE_KEY` | empty (off) | Cloudflare Turnstile bot check before a new anonymous user and before a sign-in code. Set together with `TURNSTILE_SECRET_KEY` (the server refuses to start with only one). The server then allows `challenges.cloudflare.com` in the CSP.
| `VITE_POSTHOG_KEY` | empty (off) | Turns on PostHog: no cookies, no autocapture, no session replay, Do Not Track respected, five named events. |
| `VITE_POSTHOG_HOST` | `https://eu.i.posthog.com` | The PostHog host. When `VITE_POSTHOG_KEY` is set, the server allows this host in the CSP `connect-src`. |
| `VITE_RELEASE` | `dev` | Release name in browser error reports. Set it to `${{RAILWAY_GIT_COMMIT_SHA}}` so that it matches the server's release. |

These values end up in the public JavaScript. That is expected: a Sentry DSN and a PostHog project key are not secrets.

**Do not set in production:** `PERENNIAL_DEV` (turns on dev mode), `ANTHROPIC_BASE_URL` (for the mock model only), `LOG_PRETTY`. `NODE_ENV` and `PERENNIAL_STATIC` come from the Dockerfile. The release name comes from `RAILWAY_GIT_COMMIT_SHA`, which Railway sets.

### 3.4 Service `housekeeping`

1. **New → GitHub Repo** → this repo again. Name the service `housekeeping`.
2. `.railway/railway.ts` sets the start command `bun --preload ./instrument.ts src/housekeeping.ts`, the cron schedule `17 3 * * *` (daily, 03:17 UTC) and no healthcheck (the job does not serve HTTP). Nothing to set in the dashboard.
3. No domain.
4. Variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{shared.DATABASE_URL}}` |
| `ANONYMOUS_RETENTION_DAYS` | Same as on `web` (default `60`) |

The job deletes anonymous learners with no activity for that many days (their data cascades), AI request logs older than 180 days, and expired sign-in codes and sessions. An advisory lock stops two runs at the same time. It prints one JSON log line with the counts.

## 4. Custom domain and email

### 4.1 Domain for the app

1. `web` → **Settings → Networking → Custom Domain** → `perennial.example`. Target port `8080`.
2. At your DNS provider, add the records that Railway shows (a `CNAME`, and a `TXT` record for verification). For the apex domain, use a `CNAME`-flattening or `ALIAS` record, or use `www` or `app` instead.
3. Wait until Railway shows the certificate as active.
4. Set `APP_URL=https://perennial.example` on `web` and redeploy.
5. Open the app only on this domain. Better Auth rejects requests from other origins, so the Railway domain stops working for sign-in. You can remove it.

When `APP_URL` starts with `https://`, the server sends HSTS. Before launch, change `og:image` and `twitter:image` in `web/index.html` to absolute URLs (`https://perennial.example/og.png`).

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

- [ ] PlanetScale: parameters from 2.2 set; `show wal_level` returns `logical`.
- [ ] PlanetScale: role `perennial` with `REPLICATION` created; direct URL (port 5432, `sslmode=require`) saved in the shared variable.
- [ ] `electric` deployed with its volume; the log shows that it connected to Postgres; the healthcheck is green.
- [ ] `web` variables set, including `RESEND_API_KEY` and a new `BETTER_AUTH_SECRET`.
- [ ] `web` deployed. The pre-deploy log shows `applied 0001_init.sql` (later: `up to date`).
- [ ] The startup log line `perennial server started` shows `"mail":"resend"`, the expected `"ai"` model, and the private `"electric"` URL.
- [ ] `curl https://<domain>/health` returns `{"ok":true,"release":"<git sha>"}`.
- [ ] `curl https://<domain>/api/dev/outbox?email=x` returns **404** `{"error":"not_found"}`. If it returns anything else, the server is in dev mode: stop and fix `RESEND_API_KEY` / `PERENNIAL_DEV`.
- [ ] `curl -I https://<domain>/` shows `content-security-policy` and `strict-transport-security`.
- [ ] Browser, private window: start learning (anonymous), do a few reviews, reload. The progress stays.
- [ ] Add your email, enter the code from the email. The progress stays.
- [ ] Second browser: sign in with the same email. The same progress appears within a few seconds.
- [ ] Go offline (DevTools → Network → Offline), do reviews, go online. The reviews arrive (check on the second device).
- [ ] Perennial AI: add words from a short text. The credit count goes down. `select task, ok, usd from ai_request order by id desc limit 5;` shows the call.
- [ ] `select slot_name, active from pg_replication_slots;` shows an active `electric_slot_default`.
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

**Roll back Electric:** change the image tag back to the previous version. If shapes look wrong after a change, clear the volume (see 7.3, step 4). Clients then load their data again.

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
2. On the new branch: set the cluster parameters from 2.2 again (check `show wal_level;`). Reset the password of the `perennial` role (roles are copied, passwords are not).
3. Update the shared `DATABASE_URL` in Railway to the new branch. Or promote the new branch to production in PlanetScale, if you want to keep the old host name.
4. Clear Electric's state, because its shapes and its replication position belong to the old database: stop `electric`, delete and re-create its volume (same mount path), then start it. Electric creates a new slot and publication on the new branch.
5. Redeploy `web` and `housekeeping`.
6. Check with the queries in 2.4 and the browser checks in 5.
7. On the old branch, drop the replication slot (`select pg_drop_replication_slot('electric_slot_default');`) or delete the branch. An unused slot holds WAL and uses disk.

Learners' devices then sync again from the restored data. Writes that devices still have in their offline queue are sent again. Reviews made after the restore point that are only on the server are lost.

## 8. Rotate secrets

After you change a variable, Railway asks you to deploy the change. Deploy all services that use it.

| Secret | How | Effect |
|---|---|---|
| Database password | PlanetScale → **Roles** → `perennial` → **Reset credentials**. Update the shared `DATABASE_URL`. Redeploy `electric`, `web`, `housekeeping`. | Errors for about one or two minutes, between the reset and the redeploy. Electric reconnects to the same slot. For no downtime: create a second role first. But the new role does not own the tables, so Electric must keep the old role (or use manual publication, see 2.4). |
| `ELECTRIC_SECRET` | Generate a new value. Update the shared variable. Redeploy `electric` and `web` together. | Sync pauses for a short time. Clients retry by themselves. |
| `BETTER_AUTH_SECRET` | New value on `web`, redeploy. **Only when it leaked.** | **Every learner is signed out.** Learners with an email sign in again. **Anonymous learners lose access to their progress** (it stays on the server until housekeeping deletes it). |
| `RESEND_API_KEY` | Create a new key in Resend, update `web`, redeploy, then delete the old key. | None, if you do it in this order. |
| `ANTHROPIC_API_KEY` | Same order as Resend. | None. |
| `SENTRY_DSN`, `VITE_SENTRY_DSN` | Sentry → project → **Client Keys (DSN)** → create a new key. Update the variable (`SENTRY_DSN` on `web` and `housekeeping`; `VITE_SENTRY_DSN` on `web`, which rebuilds the app), redeploy, then disable the old key. A DSN only lets someone send reports, so rotate it when it is abused. | None, if you do it in this order. |

Also rotate a secret when a person with access leaves.

## 9. After launch: what to watch

**Every day in the first week, then weekly:**

- **Railway logs** (`web`): search for `"level":"error"`. Each line has `reqId`, and `userId` when the user is known. The same id is in the `X-Request-Id` header and in Sentry.
- **Sentry:** new issues on the server and in the browser.
- **PostHog:** the funnel `course_started` → `session_finished` → `email_added`.
- **Railway metrics:** memory and CPU of `web` and `electric`. Electric's memory grows with the number of active shapes (five per learner).
- **Electric volume usage** (Railway → `electric` → volume).
- **Replication lag and WAL held by the slot:**
  ```sql
  select slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) as behind
  from pg_replication_slots;
  ```
  If `active` is false or `behind` keeps growing, Electric is down or stuck. Fix it soon: the held WAL fills the disk up to `max_slot_wal_keep_size`. If the slot passes that limit, Postgres invalidates it, and Electric must rebuild every shape.
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

**Set alerts:** Railway usage limit and alert, Anthropic spend limit, PlanetScale storage, Sentry issue alerts to email.

## 10. Local copy of production settings

Never copy production secrets to a laptop. For local work, use `docker compose up -d` (see the README). The local server uses dev defaults for everything.

## Known gaps (as of this writing)

These are not problems in this runbook, but you should know them:

- **Dev mode depends on `RESEND_API_KEY`.** If the key is missing, the server turns on dev mode silently. Step 5 has a check for it.
- **`BETTER_AUTH_SECRET` has a public default.** The server starts without it. Always set it.
- **Sentry US-region DSNs are blocked by the CSP.** The server allows `*.ingest.sentry.io` and `*.ingest.de.sentry.io`. A DSN host like `o123.ingest.us.sentry.io` matches neither, so browser reports fail. Use an EU-region Sentry org, or fix `server/src/app.ts` first.
- **Housekeeping does not load Sentry** (it does not use `--preload ./instrument.ts`). Its errors appear only in the Railway log and as a failed cron run.

## Continuous deployment and rollback

Every merge to `main` deploys to production by itself: Railway builds `main` after CI passes (`checkSuites: true` in `.railway/railway.ts`), runs the migrations before the switch (pre-deploy command), and only moves traffic once `/health` (which checks the database) answers. A red CI run on `main` never deploys. After a deploy, run `bun scripts/live-check.ts <APP_URL>`.

Rollback:
- **Fastest:** Railway dashboard → service `perennial` → Deployments → the last good one → **Redeploy**. (The CLI's `railway redeploy` only repeats the latest deployment.)
- **In git:** revert the bad merge on `main` (`git revert -m 1 <merge sha>`); CI and the deploy follow as usual.
- **Migrations are expand-then-contract** (server/src/migrate.ts): a deploy never drops what the previous version needs, so rolling back the app never needs a database rollback.
- Open tabs from the newer version get the gentle "new version" banner and reload into the rolled-back one.
