-- Reptiles, and the kind within a species (spec §5.4).
--
-- `species` is text, so "reptile" needs no change to the column. What it does
-- need is the kind: a gecko and a snake share the word "reptile" and almost
-- nothing about how they are fed or housed, so a reptile always says which it
-- is. Nullable with no default, because every animal written before this is a
-- species with no kinds, and NULL is exactly what those carry. Idempotent
-- (IF NOT EXISTS) so a database that took this by hand takes the runner's
-- pass without complaint.
ALTER TABLE "animals" ADD COLUMN IF NOT EXISTS "kind" text;
