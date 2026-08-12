CREATE TABLE "fertility_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"animal_id" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"verdict" text NOT NULL,
	"scrotal_circumference_cm" double precision,
	"motility_percent" double precision,
	"morphology_percent" double precision,
	"vet" text,
	"retest_due_on" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "died_on" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "animals" ADD COLUMN "cause_of_death" text;--> statement-breakpoint
ALTER TABLE "calving_records" ADD COLUMN "birth_type" text DEFAULT 'natural' NOT NULL;--> statement-breakpoint
ALTER TABLE "calving_records" ADD COLUMN "premature" boolean;--> statement-breakpoint
CREATE INDEX "fertility_tests_property_idx" ON "fertility_tests" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "fertility_tests_sync_cursor_idx" ON "fertility_tests" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "fertility_tests_live_idx" ON "fertility_tests" USING btree ("property_id") WHERE "fertility_tests"."deleted_at" is null;