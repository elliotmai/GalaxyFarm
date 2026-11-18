-- The garden knows when (spec §5.5, decision 50).
--
-- Crops carry the timing every planting date is worked out from: how much
-- cold the plant takes, days to germinate, weeks before the last frost to
-- start it indoors, weeks from the last frost to plant it out, weeks before
-- the first fall frost for a fall-planted crop (garlic), how long the harvest
-- lasts and the days between successive sowings. All nullable: NULL is "use
-- the built-in table", which is what every crop written before this means.
--
-- A planting started indoors no longer needs a bed: a tray on the windowsill
-- has none. `hardened_off_on` records the week outside before transplanting.
--
-- A property can say its own frost dates ("MM-DD") over its zone's averages.
--
-- Idempotent (IF NOT EXISTS / DROP NOT NULL) so a database that took this by
-- hand takes the runner's pass without complaint.
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "frost_tolerance" text;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "germination_days" integer;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "start_indoors_weeks" double precision;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "plant_out_weeks" double precision;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "fall_plant_weeks" double precision;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "harvest_weeks" double precision;
--> statement-breakpoint
ALTER TABLE "crops" ADD COLUMN IF NOT EXISTS "succession_days" integer;
--> statement-breakpoint
ALTER TABLE "plantings" ALTER COLUMN "bed_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "plantings" ADD COLUMN IF NOT EXISTS "hardened_off_on" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "last_frost" text;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "first_frost" text;
