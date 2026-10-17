-- Two seeds, one pot (#387): the seeds in the garden's clay pot and the
-- creatures that hatched from it, per course, on every device. Ids and day
-- numbers only (contract/garden.ts). It only moves forward: the server keeps
-- the value with more done (src/garden.ts mergePot).
-- Expand only: older app versions never send it and keep working.
alter table course add column garden_pot jsonb not null default '{"sown": 0, "out": 0, "seeds": [], "day": null, "hatched": []}';
