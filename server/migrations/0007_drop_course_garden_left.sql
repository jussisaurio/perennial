-- The garden's bowl and shelf are gone (#640), so the value that kept them
-- goes too.
alter table course drop column garden_left;
