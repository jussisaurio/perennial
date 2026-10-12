# Data model

## Principles

- **Decks are content, not user data.** They are versioned JSON files in the repo, shipped as static assets and cached offline. Sync never touches them.
- **Words and sentences have stable, opaque ids** (`es.w.k7m2q9xd4f`: 10 base32 characters, drawn at random and recorded in a manifest). An id is never reused, and user data refers to words only by id.
- **Reviews are events.** Memory, unlocks, the garden and the active course are derived on the client from reviews.
- **The server stamps `user_id` from the session** and scopes every write to it. Clients never send `user_id`.

## Deck changes

| Change | How | Effect on user data |
|---|---|---|
| Fix a typo | Edit in place, same id | None |
| Add words | New ids | None |
| Bad word or sentence | `retired: true`, kept in the file | Hidden; reviews stay |
| Duplicate | `aliasOf: <id>` (no chains) | Both ids count as one word: reviews are unioned, and the target's `word_state` wins |
| Split a sense | Main sense keeps the id, the other sense gets a new id | New sense starts fresh |

A committed manifest (`(lemma, pos, sense) → id`) keeps ids stable when content is regenerated.

**Decks ship with app releases, and a deck change can't break the app.** It passes the same CI as code:

1. **Schema validation:** required fields, sane lengths, and every cloze is a substring of its sentence.
2. **Compatibility with the last released deck:**
   - No id is removed or reused.
   - Alias targets exist, with no alias chains.
   - Retired entries are kept.
   - The PR gets a diff report (added, edited, retired). Large changes, for example more than 5% of words retired, fail unless explicitly approved.
3. **Replay test:** review logs written against the previous deck version replay against the new one with no crash and no orphaned progress.
4. **Defensive client:** the client validates the deck on load and skips invalid entries instead of crashing. If the deck fails to load as a whole, the client keeps the last good version that the service worker cached.

```jsonc
// decks/es/deck.json → { lang, native, version, words: [...], sentences: [...] }
{ "id": "es.w.k7m2q9xd4f", "lemma": "casa", "gloss": "house", "pos": "noun", "rank": 112, "forms": ["casa", "casas"], "notes": "" }
{ "id": "es.s.p3v8n2c6wq", "wordId": "es.w.k7m2q9xd4f", "text": "Mi casa es pequeña.", "translation": "My house is small.", "cloze": "casa" }
```

**Deck words are not in Postgres.** The files are the source of truth, and the server reads the same files. **Learner-made words are in Postgres.** A `word_id` is a deck id, a `user_word` id, or `form:<lang>:<form>` (a surface form the learner chose to ignore, such as a name).

## Postgres

**Auth:** Better Auth's tables `user` (with `"isAnonymous"`; Better Auth's own camelCase column names are kept), `account`, `session` and `verification`. User ids are `uuid`. `account` has one row per sign-in method (`provider_id`, `account_id`), so social login is config, not a schema change.

**Synced per user** with ElectricSQL (Postgres to client over HTTP "shapes", always filtered `where user_id = $session` by our proxy) into TanStack DB collections on the client. Writes go through our own endpoints, queued offline by TanStack DB's offline transactions. Composite keys keep their Postgres primary key; the client keys rows by the non-user part (`lang`, `word_id`), so linking an account doesn't make every local row resync.

```sql
create table course (            -- one per language; settings edited per column
  user_id uuid not null references "user" on delete cascade,
  lang text not null, minutes smallint not null default 7, retention real not null default 0.9,
  primary key (user_id, lang));

create table review (
  id uuid primary key,           -- made on the client: idempotent retries and merges
  user_id uuid not null references "user" on delete cascade,
  lang text not null, word_id text not null,
  skill text not null check (skill in ('read', 'listen', 'write')),
  grade smallint not null check (grade between 1 and 4),
  kind text not null default 'review' check (kind in ('review', 'known')),  -- 'known' = "I knew it"
  reviewed_at timestamptz not null, duration_ms int not null, sentence_id text);
create index on review (user_id, word_id);

create table word_state (        -- newest updated_at wins
  user_id uuid not null references "user" on delete cascade, word_id text not null,
  status text not null check (status in ('queued', 'paused', 'ignored')),
  queued_at timestamptz,         -- queued words come before frequency words
  updated_at timestamptz not null, primary key (user_id, word_id));

create table user_word (         -- words from the learner's own texts
  id uuid primary key, user_id uuid not null references "user" on delete cascade,
  lang text not null, lemma text not null, gloss text not null, pos text,
  forms jsonb not null default '[]', notes text,
  deck_id text);                 -- set when a deck version adds the same word: one plant, not two
create index on user_word (user_id);

create table user_sentence (     -- from own texts, or AI-written for any word
  id uuid primary key, user_id uuid not null references "user" on delete cascade,
  word_id text not null, text text not null, translation text not null, cloze text not null,
  origin text not null check (origin in ('own-text', 'ai')), model text);
create index on user_sentence (user_id, word_id);
```

Theme and sound are per-device preferences (localStorage), so they don't sync. Deletes are real deletes (Electric syncs them): Undo deletes the review, and deleting a word or sentence removes it.

**Server only:** `ai_usage (user_id, period, used)`, `ai_spend (period, usd)`, and `ai_request` (model, prompt version, tokens, cost, latency). Rows that reference a user cascade when the user is deleted.

**Removed from today's server:** the op log, our own login code and session tables, the course batch cache, and the Stripe columns.

## Upload endpoint rules

- **Scope:** every write is scoped `where user_id = $session`.
- **Reviews:** insert with `on conflict (id) do nothing`. A review is never updated; Undo is a delete.
- **Course:** a PATCH updates only the columns sent, in arrival order.
- **Word state:** upsert only if the incoming `updated_at` is newer.
- **Clocks:** `updated_at = least(client, now())`. Reject `reviewed_at` more than 1 day in the future.
- **Old clients:** below a minimum version, the client gets "please reload". Schema changes go expand, then contract.

## Accounts and merging

- **Before the first write:** the app is local-only. The first write creates an anonymous user and session, then the shapes connect.
- **Signing in** links the account in Better Auth's `onLinkAccount`, all in one transaction:
  - reviews, user words and sentences: their ids are globally unique, so they just change owner (`update … set user_id`);
  - word state and course: newer row wins;
  - then the anonymous user is deleted.
- **During the link:** the client keeps its local DB and upload queue, reconnects with the new token, and replays. The server stamps the new `user_id`.
- **Anonymous users** inactive for 60 days are deleted by a daily job. The cascade removes their rows.
- **The client tolerates unknown ids:** reviews for words from a newer deck (synced from another device) are kept and hidden, never dropped.

## Open questions

1. Audio: device speech for now. Pre-generated audio per sentence would become an `audio` field on sentences.
