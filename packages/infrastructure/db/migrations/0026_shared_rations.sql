-- One bowl, several animals (spec §5.1, §5.3).
--
-- Two barn cats eat a combined amount, and the model had no way to say so.
-- Every plan was read per-head — §5.3's demand deliberately "counts heads", so
-- a pen of forty runs the barn down forty times as fast — which is right for
-- hay and wrong for the one bowl the cats share. Written as a per-head plan it
-- doubled: two cups a day of demand against one cup actually put out, and a
-- reorder alert firing a week early every week.
--
-- `portion` says which reading applies. `also_feeds` is how one animal-targeted
-- plan names the others eating from it — an array column rather than a join
-- table, because §4.2 patches *fields* and a join table has no representation
-- in a field-level patch at all.

-- Defaulted, and the defaults are the whole safety of this migration: every
-- row already in the table was written meaning per-head, for exactly one
-- animal. NOT NULL so nothing downstream has to decide what a NULL means —
-- and a NULL read as "shared" would divide a pen's hay by its headcount, which
-- is the failure that empties a barn quietly.
ALTER TABLE "feeding_plans"
  ADD COLUMN "also_feeds" text[] DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "feeding_plans"
  ADD COLUMN "portion" text DEFAULT 'per_head' NOT NULL;
--> statement-breakpoint

-- `updated_at` is deliberately NOT touched.
--
-- It carries the sync cursors (§4.2), so moving it here would re-send every
-- feeding plan on the property to every device for a change none of them can
-- see: the columns arrive at their defaults, which is what those devices
-- already believe. The rows travel on their next real edit, and until then the
-- domain reads a missing `alsoFeeds` as empty and a missing `portion` as
-- per-head — which is the same answer this migration just wrote down.
