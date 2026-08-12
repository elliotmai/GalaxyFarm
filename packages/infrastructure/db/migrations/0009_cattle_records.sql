CREATE TABLE "acquisition_records" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"animal_id" text NOT NULL,
	"counterparty_id" text,
	"date" timestamp with time zone NOT NULL,
	"price" jsonb NOT NULL,
	"type" text NOT NULL,
	"transport_notes" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "genetic_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"trait" text NOT NULL,
	"direction" text NOT NULL,
	"rationale" text,
	"active" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_records" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"animal_id" text NOT NULL,
	"type" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"product" text,
	"med_inventory_id" text,
	"dose" jsonb,
	"route" text,
	"administered_by" text,
	"vet_contact_id" text,
	"cost" jsonb,
	"withdrawal_days" integer,
	"booster_due_on" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "heat_records" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"animal_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"intensity" text NOT NULL,
	"observed_by" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "med_inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"product" text NOT NULL,
	"category" text NOT NULL,
	"on_hand" jsonb NOT NULL,
	"expires_on" timestamp with time zone,
	"lot_number" text,
	"unit_cost" jsonb,
	"default_withdrawal_days" integer,
	"storage_location" text,
	"vendor_contact_id" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "planned_matings" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"dam_id" text,
	"dam_criteria" text,
	"method" text NOT NULL,
	"semen_inventory_id" text,
	"bull_id" text,
	"sire_external_id" text,
	"target_season" text,
	"target_date" timestamp with time zone,
	"rationale" text,
	"plan_status" text NOT NULL,
	"realised_as" text,
	"realised_at" timestamp with time zone,
	"abandoned_reason" text
);
--> statement-breakpoint
CREATE TABLE "processing_records" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"animal_id" text NOT NULL,
	"processor_id" text,
	"delivered_on" timestamp with time zone NOT NULL,
	"collected_on" timestamp with time zone,
	"live_scale_weight_lb" double precision,
	"hanging_weight_lb" double precision,
	"processing_cost" jsonb,
	"payment_received" jsonb,
	"cut_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "sale_records" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"animal_id" text NOT NULL,
	"counterparty_id" text,
	"date" timestamp with time zone NOT NULL,
	"price" jsonb NOT NULL,
	"type" text NOT NULL,
	"commission" jsonb,
	"transport_notes" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "semen_inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"sire_external_id" text,
	"sire_animal_id" text,
	"sire_name" text NOT NULL,
	"straws_on_hand" integer NOT NULL,
	"tank" text,
	"canister" text,
	"cane" text,
	"source" text,
	"vendor_contact_id" text,
	"price_per_straw" jsonb,
	"purchased_on" timestamp with time zone,
	"reorder_threshold" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "sync_protocols" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"detail" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_candidates" ADD COLUMN "domain_detail" jsonb;--> statement-breakpoint
CREATE INDEX "acquisition_records_property_idx" ON "acquisition_records" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "acquisition_records_sync_cursor_idx" ON "acquisition_records" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "acquisition_records_live_idx" ON "acquisition_records" USING btree ("property_id") WHERE "acquisition_records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "genetic_goals_property_idx" ON "genetic_goals" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "genetic_goals_sync_cursor_idx" ON "genetic_goals" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "genetic_goals_live_idx" ON "genetic_goals" USING btree ("property_id") WHERE "genetic_goals"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "health_records_property_idx" ON "health_records" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "health_records_sync_cursor_idx" ON "health_records" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "health_records_live_idx" ON "health_records" USING btree ("property_id") WHERE "health_records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "heat_records_property_idx" ON "heat_records" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "heat_records_sync_cursor_idx" ON "heat_records" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "heat_records_live_idx" ON "heat_records" USING btree ("property_id") WHERE "heat_records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "med_inventory_property_idx" ON "med_inventory" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "med_inventory_sync_cursor_idx" ON "med_inventory" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "med_inventory_live_idx" ON "med_inventory" USING btree ("property_id") WHERE "med_inventory"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "planned_matings_property_idx" ON "planned_matings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "planned_matings_sync_cursor_idx" ON "planned_matings" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "planned_matings_live_idx" ON "planned_matings" USING btree ("property_id") WHERE "planned_matings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "processing_records_property_idx" ON "processing_records" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "processing_records_sync_cursor_idx" ON "processing_records" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "processing_records_live_idx" ON "processing_records" USING btree ("property_id") WHERE "processing_records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "sale_records_property_idx" ON "sale_records" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "sale_records_sync_cursor_idx" ON "sale_records" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "sale_records_live_idx" ON "sale_records" USING btree ("property_id") WHERE "sale_records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "semen_inventory_property_idx" ON "semen_inventory" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "semen_inventory_sync_cursor_idx" ON "semen_inventory" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "semen_inventory_live_idx" ON "semen_inventory" USING btree ("property_id") WHERE "semen_inventory"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "sync_protocols_property_idx" ON "sync_protocols" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "sync_protocols_sync_cursor_idx" ON "sync_protocols" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "sync_protocols_live_idx" ON "sync_protocols" USING btree ("property_id") WHERE "sync_protocols"."deleted_at" is null;