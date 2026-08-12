CREATE TABLE "feed_types" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"est_weight_lb_per_unit" double precision,
	"current_unit_cost" jsonb,
	"reorder_lead_days" integer NOT NULL,
	"reorder_threshold" double precision,
	"active" boolean NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE INDEX "feed_types_property_idx" ON "feed_types" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "feed_types_sync_cursor_idx" ON "feed_types" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "feed_types_live_idx" ON "feed_types" USING btree ("property_id") WHERE "feed_types"."deleted_at" is null;