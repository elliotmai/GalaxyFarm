-- The garden stops asking for what nobody knows (spec §5.5).
--
-- Two changes, both about the forms asking for less:
--
-- * Amounts become optional. A picking nobody weighed is still a picking — the
--   date is what says how long a variety kept giving — and a seed packet whose
--   count nobody knows is still in the box. Pantry batches may also reach
--   zero now, which is what "edit the count down as jars are eaten" always
--   meant; NOT NULL is lifted here, and the schema allows 0. The unit stays
--   required: it has a default on every form, and a number without one is the
--   thing that cannot be read.
--
-- * A crop's botanical family is inferred from its name, so `family` becomes
--   nullable: NULL means "work it out from the built-in table", which is what
--   the rotation guard now does (`cropFamily` in the garden module). A family
--   somebody typed, or one the plant search supplied, is still stored and
--   still wins. `scientific_name` is new, filled in when a crop is picked from
--   the plant search, and is the second thing the inference reads.
--
-- Idempotent on purpose (IF NOT EXISTS; DROP NOT NULL is a no-op when already
-- dropped), so a database that had this applied by hand during development
-- takes the runner's pass without complaint.
ALTER TABLE "seed_inventory" ALTER COLUMN "quantity" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "harvest_logs" ALTER COLUMN "quantity" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "preservation_logs" ALTER COLUMN "quantity" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "crops" ALTER COLUMN "family" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "scientific_name" text;
--> statement-breakpoint

-- `updated_at` is deliberately NOT touched, for the same reason as 0033: it
-- carries the sync cursors (§4.2). No existing row changes meaning — every
-- quantity and family already present stays exactly as it was.
