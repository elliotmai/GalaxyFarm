-- Coordinates were `text` against a `number` field, so latitude arrived back
-- from Postgres as a string and no arithmetic on it was safe. The cast needs
-- an explicit USING: Postgres will not silently reinterpret text as a number.
CREATE TABLE "calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"title" text NOT NULL,
	"detail" text,
	"at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"all_day" boolean NOT NULL,
	"zone_id" text,
	"animal_id" text
);
--> statement-breakpoint
CREATE TABLE "feeding_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"target" text NOT NULL,
	"target_id" text NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean NOT NULL,
	"special_notes" text
);
--> statement-breakpoint
CREATE TABLE "pasture_care_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"zone_id" text NOT NULL,
	"action" text NOT NULL,
	"performed_on" timestamp with time zone NOT NULL,
	"product" text,
	"rate_per_acre" jsonb,
	"acres" double precision,
	"cost" jsonb,
	"supply_item_id" text,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "latitude" SET DATA TYPE double precision USING "latitude"::double precision;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "longitude" SET DATA TYPE double precision USING "longitude"::double precision;--> statement-breakpoint
ALTER TABLE "purchase_candidates" ALTER COLUMN "distance_miles" SET DATA TYPE double precision USING "distance_miles"::double precision;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "safety_level_labels" jsonb;--> statement-breakpoint
CREATE INDEX "calendar_events_property_idx" ON "calendar_events" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "calendar_events_sync_cursor_idx" ON "calendar_events" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "calendar_events_live_idx" ON "calendar_events" USING btree ("property_id") WHERE "calendar_events"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "feeding_plans_property_idx" ON "feeding_plans" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "feeding_plans_sync_cursor_idx" ON "feeding_plans" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "feeding_plans_live_idx" ON "feeding_plans" USING btree ("property_id") WHERE "feeding_plans"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "pasture_care_logs_property_idx" ON "pasture_care_logs" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "pasture_care_logs_sync_cursor_idx" ON "pasture_care_logs" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "pasture_care_logs_live_idx" ON "pasture_care_logs" USING btree ("property_id") WHERE "pasture_care_logs"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "purchase_candidates" DROP COLUMN "asking_price_cents";--> statement-breakpoint
ALTER TABLE "roadmap_items" DROP COLUMN "budget_estimate_cents";