CREATE TABLE "feed_consumption" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"feed_type_id" text NOT NULL,
	"quantity" double precision NOT NULL,
	"kind" text NOT NULL,
	"used_on" timestamp with time zone NOT NULL,
	"animal_id" text,
	"zone_id" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "feed_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"feed_type_id" text NOT NULL,
	"quantity" double precision NOT NULL,
	"unit_cost" jsonb NOT NULL,
	"vendor_contact_id" text,
	"purchased_on" timestamp with time zone NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE INDEX "feed_consumption_property_idx" ON "feed_consumption" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "feed_consumption_sync_cursor_idx" ON "feed_consumption" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "feed_consumption_live_idx" ON "feed_consumption" USING btree ("property_id") WHERE "feed_consumption"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "feed_purchases_property_idx" ON "feed_purchases" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "feed_purchases_sync_cursor_idx" ON "feed_purchases" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "feed_purchases_live_idx" ON "feed_purchases" USING btree ("property_id") WHERE "feed_purchases"."deleted_at" is null;