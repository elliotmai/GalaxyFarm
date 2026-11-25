-- Eggs to the kitchen (spec §4.3 "Connected apps", Eggs to the kitchen).
--
-- Egg logs and dispositions are sent to KitchenHub after they commit, so the
-- eggs collected here turn up in the kitchen's stock without being typed
-- twice. These two tables are the server's bookkeeping for that, and nothing
-- more: the farm's own records are the outbox. A record is waiting while its
-- `updated_at` is newer than the version KitchenHub last acknowledged, so a
-- send that fails — KitchenHub down, the function cut short — leaves it
-- waiting, and the next write retries it. Nothing about the farm write
-- depends on the send.
--
-- **Deliberately outside `allTables`**, with `api_tokens`: system-owned rows
-- the server reads and writes, never synced to a device.
--
-- `kitchen_egg_links.started_at` is when this property first fed the kitchen.
-- Records created before it are never sent, so switching the link on does not
-- pour the whole egg history into the fridge at once.
CREATE TABLE "kitchen_egg_links" (
	"property_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "kitchen_egg_sends" (
	"entity" text NOT NULL,
	"record_id" text NOT NULL,
	"property_id" text NOT NULL,
	"version" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "kitchen_egg_sends_pk" PRIMARY KEY("entity","record_id")
);
--> statement-breakpoint
CREATE INDEX "kitchen_egg_sends_property_idx" ON "kitchen_egg_sends" ("property_id");
