-- The last write the server applied from each tab (#817, #818). A tab numbers
-- its writes and may send one again (its answer was lost, or the page closed
-- while it was on the way); the server applies each number once, in order
-- (sync.ts). Expand only: older app versions send no numbers and keep working.
create table write_tab (
  user_id uuid not null references "user" on delete cascade,
  tab uuid not null,
  applied integer not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, tab)
);
