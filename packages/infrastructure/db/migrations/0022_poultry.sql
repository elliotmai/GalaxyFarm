-- The flock, and what it lays (§5.4).
--
-- Four tables and no bird: eighteen hens are one `flocks` row with a headcount,
-- and quail is a value in `species` rather than a second set of everything.
--
-- `opening_count` is the count when the flock was first written down, not the
-- count now. Now derives from it plus `flock_adjustments`, per §4.5's rule for
-- a running total: the log entries carry the CRUD and the total re-derives. A
-- stored headcount answers "how many birds" and nothing else, and it is wrong
-- the first time somebody corrects last Tuesday.
CREATE TABLE "flocks" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"species" text NOT NULL,
	"zone_id" text,
	"breed_mix" text,
	"opening_count" integer NOT NULL,
	"active" boolean NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "flock_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"flock_id" text NOT NULL,
	"reason" text NOT NULL,
	"quantity" integer NOT NULL,
	"occurred_on" timestamp with time zone NOT NULL,
	"notes" text
);
--> statement-breakpoint
-- The breakdown is a jsonb array rather than a child table, for the reason §4.2
-- gives: sync patches *fields*, and a morning's colour-and-size rows change as
-- a unit. A child table has no representation in a field-level patch at all.
CREATE TABLE "egg_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"flock_id" text,
	"zone_id" text,
	"collected_on" timestamp with time zone NOT NULL,
	"total" integer NOT NULL,
	"breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "egg_dispositions" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"disposed_on" timestamp with time zone NOT NULL,
	"quantity" integer NOT NULL,
	"kind" text NOT NULL,
	"contact_id" text,
	"price" jsonb,
	"notes" text
);
--> statement-breakpoint
CREATE INDEX "flocks_property_idx" ON "flocks" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "flocks_sync_cursor_idx" ON "flocks" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "flocks_live_idx" ON "flocks" USING btree ("property_id") WHERE "flocks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "flock_adjustments_property_idx" ON "flock_adjustments" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "flock_adjustments_sync_cursor_idx" ON "flock_adjustments" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "flock_adjustments_live_idx" ON "flock_adjustments" USING btree ("property_id") WHERE "flock_adjustments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "egg_logs_property_idx" ON "egg_logs" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "egg_logs_sync_cursor_idx" ON "egg_logs" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "egg_logs_live_idx" ON "egg_logs" USING btree ("property_id") WHERE "egg_logs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "egg_dispositions_property_idx" ON "egg_dispositions" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "egg_dispositions_sync_cursor_idx" ON "egg_dispositions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "egg_dispositions_live_idx" ON "egg_dispositions" USING btree ("property_id") WHERE "egg_dispositions"."deleted_at" is null;
