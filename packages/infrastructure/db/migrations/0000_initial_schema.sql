CREATE TABLE "animals" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"species" text NOT NULL,
	"name" text,
	"tag_number" text,
	"sex" text NOT NULL,
	"dob" timestamp with time zone,
	"dob_is_estimate" boolean NOT NULL,
	"status" text NOT NULL,
	"ownership" text NOT NULL,
	"owner_id" text,
	"safety_level" integer NOT NULL,
	"safety_notes" text,
	"photo_keys" text[] DEFAULT '{}' NOT NULL,
	"custom_instructions" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"owner_entity" text NOT NULL,
	"owner_id" text NOT NULL,
	"key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"caption" text,
	"uploaded" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branding_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"farm_name" text NOT NULL,
	"business_name" text,
	"tagline" text,
	"logo_key" text
);
--> statement-breakpoint
CREATE TABLE "chore_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"title" text NOT NULL,
	"detail" text,
	"recurrence" text NOT NULL,
	"recurrence_days" integer[] DEFAULT '{}' NOT NULL,
	"zone_id" text,
	"animal_id" text,
	"active" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"company" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"address" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"address" text,
	"timezone" text NOT NULL,
	"growing_zone" text,
	"latitude" text,
	"longitude" text,
	"offline_imagery_key" text
);
--> statement-breakpoint
CREATE TABLE "purchase_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"domain" text NOT NULL,
	"roadmap_item_id" text,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"asking_price_cents" integer NOT NULL,
	"additional_costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"listing_url" text,
	"seller_id" text,
	"location" text,
	"distance_miles" integer,
	"listed_date" timestamp with time zone,
	"first_seen" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"photo_keys" text[] DEFAULT '{}' NOT NULL,
	"pros" text[] DEFAULT '{}' NOT NULL,
	"cons" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"plan_status" text NOT NULL,
	"realised_as" text,
	"realised_at" timestamp with time zone,
	"abandoned_reason" text
);
--> statement-breakpoint
CREATE TABLE "roadmap_items" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"domain" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"target_date" timestamp with time zone,
	"target_season" text,
	"priority" text NOT NULL,
	"budget_estimate_cents" integer,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"entity" text NOT NULL,
	"record_id" text NOT NULL,
	"field" text NOT NULL,
	"winner_value" jsonb,
	"winner_at" timestamp with time zone NOT NULL,
	"winner_device_id" text NOT NULL,
	"loser_value" jsonb,
	"loser_at" timestamp with time zone NOT NULL,
	"loser_device_id" text NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"template_id" text,
	"title" text NOT NULL,
	"detail" text,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"assigned_to" text,
	"zone_id" text,
	"animal_id" text
);
--> statement-breakpoint
CREATE TABLE "water_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"has_heater" boolean NOT NULL,
	"active" boolean NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "zone_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"animal_id" text NOT NULL,
	"zone_id" text NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone,
	"slot" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"indoor" boolean NOT NULL,
	"capacity" integer,
	"boundary" jsonb,
	"baseline_safety_level" integer NOT NULL,
	"water_source_ids" text[] DEFAULT '{}' NOT NULL,
	"custom_instructions" text,
	"resting" boolean NOT NULL,
	"active" boolean NOT NULL
);
--> statement-breakpoint
CREATE INDEX "animals_property_idx" ON "animals" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "animals_sync_cursor_idx" ON "animals" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "animals_live_idx" ON "animals" USING btree ("property_id") WHERE "animals"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "attachments_property_idx" ON "attachments" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "attachments_sync_cursor_idx" ON "attachments" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "attachments_live_idx" ON "attachments" USING btree ("property_id") WHERE "attachments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "branding_configs_property_idx" ON "branding_configs" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "branding_configs_sync_cursor_idx" ON "branding_configs" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "branding_configs_live_idx" ON "branding_configs" USING btree ("property_id") WHERE "branding_configs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "chore_templates_property_idx" ON "chore_templates" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "chore_templates_sync_cursor_idx" ON "chore_templates" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "chore_templates_live_idx" ON "chore_templates" USING btree ("property_id") WHERE "chore_templates"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "contacts_property_idx" ON "contacts" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "contacts_sync_cursor_idx" ON "contacts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "contacts_live_idx" ON "contacts" USING btree ("property_id") WHERE "contacts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "properties_property_idx" ON "properties" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "properties_sync_cursor_idx" ON "properties" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "properties_live_idx" ON "properties" USING btree ("property_id") WHERE "properties"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "purchase_candidates_property_idx" ON "purchase_candidates" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "purchase_candidates_sync_cursor_idx" ON "purchase_candidates" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "purchase_candidates_live_idx" ON "purchase_candidates" USING btree ("property_id") WHERE "purchase_candidates"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "roadmap_items_property_idx" ON "roadmap_items" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "roadmap_items_sync_cursor_idx" ON "roadmap_items" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "roadmap_items_live_idx" ON "roadmap_items" USING btree ("property_id") WHERE "roadmap_items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "sync_audit_record_id_index" ON "sync_audit" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "sync_audit_resolved_at_index" ON "sync_audit" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "tasks_property_idx" ON "tasks" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "tasks_sync_cursor_idx" ON "tasks" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "tasks_live_idx" ON "tasks" USING btree ("property_id") WHERE "tasks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "water_sources_property_idx" ON "water_sources" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "water_sources_sync_cursor_idx" ON "water_sources" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "water_sources_live_idx" ON "water_sources" USING btree ("property_id") WHERE "water_sources"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "zone_assignments_property_idx" ON "zone_assignments" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "zone_assignments_sync_cursor_idx" ON "zone_assignments" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "zone_assignments_live_idx" ON "zone_assignments" USING btree ("property_id") WHERE "zone_assignments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "zones_property_idx" ON "zones" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "zones_sync_cursor_idx" ON "zones" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "zones_live_idx" ON "zones" USING btree ("property_id") WHERE "zones"."deleted_at" is null;