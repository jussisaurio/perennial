-- Leave it out (#351): what the learner last left in the garden's bowl and on
-- which calendar days, and what they keep on the shed's shelf, per course, on
-- every device. Ids and day numbers only (contract/garden.ts). It only moves
-- forward: the server merges each write with what is stored (src/garden.ts).
-- Expand only: older app versions never send it and keep working.
alter table course add column garden_left jsonb not null default '{"n": 0, "bowl": null, "kept": [], "hooks": [null, null, null], "arranged": 0}';
