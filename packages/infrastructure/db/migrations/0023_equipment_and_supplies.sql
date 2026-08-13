CREATE TABLE "durable_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"supply_item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"animal_id" text,
	"zone_id" text,
	"condition" text NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"make" text,
	"model" text,
	"year" integer,
	"vin" text,
	"status" text NOT NULL,
	"purchased_on" timestamp with time zone,
	"purchase_price" jsonb,
	"photo_keys" text[] DEFAULT '{}' NOT NULL,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "fuel_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"equipment_id" text NOT NULL,
	"gallons" double precision NOT NULL,
	"cost" jsonb NOT NULL,
	"filled_on" timestamp with time zone NOT NULL,
	"hours" double precision,
	"miles" double precision,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "maintenance_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"equipment_id" text NOT NULL,
	"rule_id" text,
	"task" text NOT NULL,
	"performed_on" timestamp with time zone NOT NULL,
	"cost" jsonb,
	"parts" text,
	"hours" double precision,
	"miles" double precision,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "maintenance_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"equipment_id" text NOT NULL,
	"task" text NOT NULL,
	"every_hours" double precision,
	"every_miles" double precision,
	"every_months" double precision,
	"parts" text,
	"active" boolean NOT NULL
);--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"equipment_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" double precision NOT NULL,
	"read_on" timestamp with time zone NOT NULL,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "supply_items" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"opening_qty" double precision NOT NULL,
	"reorder_threshold" double precision,
	"storage_location" text,
	"photo_key" text,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "supply_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"supply_item_id" text NOT NULL,
	"quantity" double precision NOT NULL,
	"unit_cost" jsonb NOT NULL,
	"vendor_contact_id" text,
	"purchased_on" timestamp with time zone NOT NULL,
	"notes" text
);--> statement-breakpoint
CREATE TABLE "supply_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"supply_item_id" text NOT NULL,
	"quantity" double precision NOT NULL,
	"used_on" timestamp with time zone NOT NULL,
	"animal_id" text,
	"zone_id" text,
	"notes" text
);--> statement-breakpoint
CREATE INDEX "durable_assignments_property_idx" ON "durable_assignments" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "durable_assignments_sync_cursor_idx" ON "durable_assignments" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "durable_assignments_live_idx" ON "durable_assignments" USING btree ("property_id") WHERE "durable_assignments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "equipment_property_idx" ON "equipment" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "equipment_sync_cursor_idx" ON "equipment" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "equipment_live_idx" ON "equipment" USING btree ("property_id") WHERE "equipment"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "fuel_logs_property_idx" ON "fuel_logs" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "fuel_logs_sync_cursor_idx" ON "fuel_logs" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "fuel_logs_live_idx" ON "fuel_logs" USING btree ("property_id") WHERE "fuel_logs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "maintenance_logs_property_idx" ON "maintenance_logs" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "maintenance_logs_sync_cursor_idx" ON "maintenance_logs" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "maintenance_logs_live_idx" ON "maintenance_logs" USING btree ("property_id") WHERE "maintenance_logs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "maintenance_rules_property_idx" ON "maintenance_rules" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "maintenance_rules_sync_cursor_idx" ON "maintenance_rules" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "maintenance_rules_live_idx" ON "maintenance_rules" USING btree ("property_id") WHERE "maintenance_rules"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "meter_readings_property_idx" ON "meter_readings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "meter_readings_sync_cursor_idx" ON "meter_readings" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "meter_readings_live_idx" ON "meter_readings" USING btree ("property_id") WHERE "meter_readings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "supply_items_property_idx" ON "supply_items" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "supply_items_sync_cursor_idx" ON "supply_items" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "supply_items_live_idx" ON "supply_items" USING btree ("property_id") WHERE "supply_items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "supply_purchases_property_idx" ON "supply_purchases" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "supply_purchases_sync_cursor_idx" ON "supply_purchases" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "supply_purchases_live_idx" ON "supply_purchases" USING btree ("property_id") WHERE "supply_purchases"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "supply_usage_property_idx" ON "supply_usage" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "supply_usage_sync_cursor_idx" ON "supply_usage" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "supply_usage_live_idx" ON "supply_usage" USING btree ("property_id") WHERE "supply_usage"."deleted_at" is null;
