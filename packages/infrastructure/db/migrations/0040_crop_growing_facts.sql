-- A crop carries how it is grown (spec §5.5).
--
-- Picking a plant from the search filled its name, scientific name and family
-- and left everything somebody plants by blank. These columns hold the rest:
-- typical days to maturity and spacing (what a new variety starts from before
-- its own packet says otherwise), cool or warm season, sun, how it is sown,
-- annual / biennial / perennial, and how deep the seed goes. Filled from the
-- built-in table or Growstuff when a plant is picked, and editable.
--
-- All nullable, no defaults: NULL is "not recorded", which is exactly what
-- every crop written before this meant. Idempotent (IF NOT EXISTS) so a
-- database that took this by hand takes the runner's pass without complaint.
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "days_to_maturity" integer;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "spacing_inches" double precision;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "season" text;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "lifecycle" text;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "sun" text;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "sowing" text;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "depth_inches" double precision;
--> statement-breakpoint

-- `updated_at` is deliberately NOT touched, for the same reason as 0033: it
-- carries the sync cursors (§4.2), and the columns arrive NULL, which is what
-- every device already believes.
