CREATE TABLE "cattle_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"animal_id" text NOT NULL,
	"breed_composition" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"horn_status" text,
	"colour" text,
	"markings" text,
	"registrations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sire" jsonb,
	"dam" jsonb
);
--> statement-breakpoint
CREATE TABLE "external_animals" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"reg_number" text,
	"association" text,
	"sire" jsonb,
	"dam" jsonb,
	"notes" text
);
--> statement-breakpoint
CREATE INDEX "cattle_profiles_property_idx" ON "cattle_profiles" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "cattle_profiles_sync_cursor_idx" ON "cattle_profiles" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "cattle_profiles_live_idx" ON "cattle_profiles" USING btree ("property_id") WHERE "cattle_profiles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "external_animals_property_idx" ON "external_animals" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "external_animals_sync_cursor_idx" ON "external_animals" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "external_animals_live_idx" ON "external_animals" USING btree ("property_id") WHERE "external_animals"."deleted_at" is null;