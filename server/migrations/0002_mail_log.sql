-- Sign-in codes sent, per email (hashed), for a per-address cap that holds
-- whatever IP the requests come from (email bombing). Housekeeping prunes it.
create table mail_log (
  email_hash text not null,
  sent_at timestamptz not null default now()
);
create index mail_log_email_idx on mail_log (email_hash, sent_at);
