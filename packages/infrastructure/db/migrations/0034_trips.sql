-- The owners being away (spec §5.10).
--
-- The care guide says how the place is run; this says when somebody is coming
-- back. Nothing else in the farm's records knows a trip is happening, so unlike
-- the guide's pen sections this is stored rather than composed.
--
-- `legs` is jsonb rather than a `trip_legs` table for the reason `care_guides`
-- keeps `includes` as text[]: the sync engine patches *fields* (§4.2), and a
-- child table has no representation in a field-level patch. It is the same
-- shape `contacts.phones` already uses for the same reason.
--
-- The leg times inside that jsonb are wall clocks with an IANA zone beside
-- them, not instants — a departure is a clock face in a place, read aloud to a
-- sitter. `start_date`/`end_date` are real timestamps because those two *are*
-- compared against today, on every kiosk render.
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"destination" text,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"who_is_away" text NOT NULL,
	"reachable_at" text,
	"notes" text,
	"legs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	-- `manual` or `wander`. Which app owns the row: a `wander` trip is
	-- overwritten by the next pull, so the admin form makes it read-only.
	"source" text DEFAULT 'manual' NOT NULL,
	-- Wander's own `trips/{id}`, so a pull updates the row it wrote last time
	-- rather than adding a second copy of the same trip.
	"external_id" text
);
--> statement-breakpoint
CREATE INDEX "trips_property_idx" ON "trips" ("property_id");--> statement-breakpoint
CREATE INDEX "trips_sync_cursor_idx" ON "trips" ("updated_at");--> statement-breakpoint
CREATE INDEX "trips_live_idx" ON "trips" ("property_id") WHERE "deleted_at" is null;--> statement-breakpoint
-- The read every sitter-facing surface makes: which trip is on right now.
CREATE INDEX "trips_window_idx" ON "trips" ("property_id", "end_date") WHERE "deleted_at" is null;--> statement-breakpoint
-- One row per Wander trip. Partial, so the many hand-entered trips (which have
-- no external id) are unaffected by it.
CREATE UNIQUE INDEX "trips_external_idx" ON "trips" ("property_id", "external_id") WHERE "external_id" is not null;
