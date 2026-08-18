-- The garden gets somewhere to live (spec §5.5, issue #32).
--
-- The domain has been complete and tested since Phase 0 — beds, crops,
-- varieties, seed, plantings, care, harvest, preservation, and the season plan
-- that drives the notifications — computing over data with nowhere to persist.
-- These ten tables are that gap and nothing else; no domain rule moved.
--
-- Three shapes worth reading before the SQL:
--
-- * `crops.family` is what the rotation guard runs on, not `crops.name`.
--   Tomatoes following peppers is the mistake rotation exists to prevent, and
--   the two share nothing but a family.
-- * `plantings` has no expected-harvest column. It derives from the planting
--   date and the variety's days to maturity (§2, "derive, don't duplicate"), and
--   a stored copy is the one that would stay at the old date when somebody
--   corrected when they actually planted.
-- * `beds` carries `x`/`y` in screen space rather than a polygon in degrees.
--   A raised bed is drawn on a grid; a pasture is surveyed. The layout designer
--   (#33) is not built yet — the columns are here so it finds its geometry
--   waiting rather than a migration in front of it.
--
-- No foreign keys, like every other reference in this schema. Rows arrive from
-- devices in whatever order the outbox drains (§4.2), and a constraint would
-- reject a planting whose bed has not landed yet. The delete behaviours §4.5
-- requires are declared and enforced in the application layer, where they can
-- name the dependents in a confirmation instead of raising a 23503.
CREATE TABLE "beds" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"zone_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"length_ft" double precision,
	"width_ft" double precision,
	"x" double precision,
	"y" double precision,
	"soil_notes" text,
	"active" boolean NOT NULL
);--> statement-breakpoint
CREATE TABLE "crops" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"family" text NOT NULL,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "varieties" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"crop_id" text NOT NULL,
	"name" text NOT NULL,
	"days_to_maturity" integer,
	"spacing_inches" double precision,
	"source" text,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "seed_inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"variety_id" text NOT NULL,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"packed_for_year" integer,
	"source" text,
	"germination_notes" text
);--> statement-breakpoint
CREATE TABLE "plantings" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"bed_id" text NOT NULL,
	"variety_id" text NOT NULL,
	"method" text NOT NULL,
	"indoor_started_on" timestamp with time zone,
	"planted_on" timestamp with time zone,
	"status" text NOT NULL,
	"quantity" double precision,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "garden_care_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"bed_id" text,
	"planting_id" text,
	"action" text NOT NULL,
	"performed_on" timestamp with time zone NOT NULL,
	"product" text,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "harvest_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"planting_id" text NOT NULL,
	"harvested_on" timestamp with time zone NOT NULL,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "preservation_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"harvest_log_id" text,
	"label" text NOT NULL,
	"method" text NOT NULL,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"preserved_on" timestamp with time zone NOT NULL,
	"storage_location" text,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "season_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"notes" text,
	"active" boolean NOT NULL
);--> statement-breakpoint
CREATE TABLE "planned_plantings" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"season_plan_id" text NOT NULL,
	"variety_id" text NOT NULL,
	"method" text NOT NULL,
	"bed_id" text,
	"window_from" timestamp with time zone NOT NULL,
	"window_to" timestamp with time zone NOT NULL,
	"quantity" double precision,
	"plan_status" text NOT NULL,
	"realised_as" text,
	"realised_at" timestamp with time zone,
	"abandoned_reason" text,
	"notes" text
);--> statement-breakpoint
CREATE INDEX "beds_property_idx" ON "beds" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "beds_sync_cursor_idx" ON "beds" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "beds_live_idx" ON "beds" USING btree ("property_id") WHERE "beds"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "crops_property_idx" ON "crops" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "crops_sync_cursor_idx" ON "crops" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "crops_live_idx" ON "crops" USING btree ("property_id") WHERE "crops"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "varieties_property_idx" ON "varieties" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "varieties_sync_cursor_idx" ON "varieties" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "varieties_live_idx" ON "varieties" USING btree ("property_id") WHERE "varieties"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "seed_inventory_property_idx" ON "seed_inventory" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "seed_inventory_sync_cursor_idx" ON "seed_inventory" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "seed_inventory_live_idx" ON "seed_inventory" USING btree ("property_id") WHERE "seed_inventory"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "plantings_property_idx" ON "plantings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "plantings_sync_cursor_idx" ON "plantings" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "plantings_live_idx" ON "plantings" USING btree ("property_id") WHERE "plantings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "garden_care_logs_property_idx" ON "garden_care_logs" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "garden_care_logs_sync_cursor_idx" ON "garden_care_logs" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "garden_care_logs_live_idx" ON "garden_care_logs" USING btree ("property_id") WHERE "garden_care_logs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "harvest_logs_property_idx" ON "harvest_logs" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "harvest_logs_sync_cursor_idx" ON "harvest_logs" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "harvest_logs_live_idx" ON "harvest_logs" USING btree ("property_id") WHERE "harvest_logs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "preservation_logs_property_idx" ON "preservation_logs" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "preservation_logs_sync_cursor_idx" ON "preservation_logs" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "preservation_logs_live_idx" ON "preservation_logs" USING btree ("property_id") WHERE "preservation_logs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "season_plans_property_idx" ON "season_plans" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "season_plans_sync_cursor_idx" ON "season_plans" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "season_plans_live_idx" ON "season_plans" USING btree ("property_id") WHERE "season_plans"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "planned_plantings_property_idx" ON "planned_plantings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "planned_plantings_sync_cursor_idx" ON "planned_plantings" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "planned_plantings_live_idx" ON "planned_plantings" USING btree ("property_id") WHERE "planned_plantings"."deleted_at" is null;
