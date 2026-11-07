-- The gardener's notes (#654): the ids of the notes the learner has read, per
-- course, on every device. The list only grows: the server merges each write
-- with what is stored (sync.ts). Expand only: older app versions never send it
-- and keep working.
alter table course add column notes_read jsonb not null default '[]';
