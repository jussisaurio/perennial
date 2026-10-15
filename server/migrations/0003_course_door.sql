-- The garden's door to the orchard (#315): once the learner opens it with the
-- key, it stays open, per course, on every device. Only ever set to true
-- (sync.ts). Expand only: older app versions never send it and keep working.
alter table course add column door_open boolean not null default false;
