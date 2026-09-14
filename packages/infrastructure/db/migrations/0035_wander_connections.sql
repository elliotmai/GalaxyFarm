-- The link to Wander, where the owner plans travel (spec §5.10).
--
-- One row per property: the integration token the owner minted in Wander's
-- Account → Connected Apps, and which of their trips this farm follows.
--
-- **Deliberately outside `allTables`**, the same exception `kiosk_pins` and
-- `push_subscriptions` document and for the same reason. Sync copies rows to
-- every device on the property (§4.2), and this token reads the owner's whole
-- itinerary — every trip they are on, not just the one the farm follows. A
-- barn screen in an unlocked feed room must never hold it. `wander-store.ts`
-- is its only reader and writer, and nothing returns `token` to a browser.
--
-- A §4.5 system-owned row: created by pasting a token, deleted by
-- disconnecting, never tombstoned — a tombstone exists so a deletion can
-- replicate, and this row does not replicate anywhere.
CREATE TABLE "wander_connections" (
	"property_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	-- Where the Cloud Functions live. Stored rather than compiled in so a
	-- redeploy to another Firebase project is a row edit, not a release.
	"functions_base_url" text NOT NULL,
	-- Wander's own `trips/{id}`. Null between connecting and picking a trip.
	"trip_id" text,
	"trip_name" text,
	"connected_at" timestamp with time zone NOT NULL,
	"last_pulled_at" timestamp with time zone,
	-- Why the last pull failed, for the screen to show. Null when it worked.
	"last_error" text
);
