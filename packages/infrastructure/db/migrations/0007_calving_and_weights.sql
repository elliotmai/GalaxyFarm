CREATE TABLE "calving_records" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"dam_id" text NOT NULL,
	"breeding_record_id" text,
	"date" timestamp with time zone NOT NULL,
	"calving_ease" integer NOT NULL,
	"vigour" text NOT NULL,
	"calf_sex" text,
	"birth_weight_lb" double precision,
	"assisted" boolean NOT NULL,
	"assist_detail" text,
	"calf_animal_id" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "weight_records" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"animal_id" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"weight_lb" double precision NOT NULL,
	"context" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE INDEX "calving_records_property_idx" ON "calving_records" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "calving_records_sync_cursor_idx" ON "calving_records" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "calving_records_live_idx" ON "calving_records" USING btree ("property_id") WHERE "calving_records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "weight_records_property_idx" ON "weight_records" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "weight_records_sync_cursor_idx" ON "weight_records" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "weight_records_live_idx" ON "weight_records" USING btree ("property_id") WHERE "weight_records"."deleted_at" is null;