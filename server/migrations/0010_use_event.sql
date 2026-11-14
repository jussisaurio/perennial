-- What the learner did that the learner tables do not keep a time for (#984):
-- for now, the first read of each gardener's note. `bun run real-use` reads
-- it with the reviews (docs/real-use.md). Server only: never synced to the
-- app. Ids and short values only, never the learner's text.
create table use_event (
  user_id uuid not null references "user" on delete cascade,
  lang text not null,
  kind text not null check (kind in ('note_read')),
  at timestamptz not null default now(),
  note text
);
create index use_event_user on use_event (user_id, lang, at);
