CREATE TABLE "breeding_records" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"dam_id" text NOT NULL,
	"method" text NOT NULL,
	"bull_id" text,
	"semen_inventory_id" text,
	"sire_external_id" text,
	"embryo_donor_id" text,
	"embryo_code" text,
	"date" timestamp with time zone NOT NULL,
	"technician_id" text,
	"sync_protocol_id" text,
	"preg_check" jsonb,
	"gestation_days" integer,
	"notes" text
);
--> statement-breakpoint
CREATE INDEX "breeding_records_property_idx" ON "breeding_records" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "breeding_records_sync_cursor_idx" ON "breeding_records" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "breeding_records_live_idx" ON "breeding_records" USING btree ("property_id") WHERE "breeding_records"."deleted_at" is null;