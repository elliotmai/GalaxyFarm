ALTER TABLE "external_animals" ADD COLUMN "horn_status" text;--> statement-breakpoint
ALTER TABLE "external_animals" ADD COLUMN "breed_composition" jsonb;--> statement-breakpoint
ALTER TABLE "external_animals" ADD COLUMN "coi" double precision;--> statement-breakpoint
ALTER TABLE "external_animals" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "external_animals" ADD COLUMN "disposed_on" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_animals" ADD COLUMN "service_type" text;--> statement-breakpoint
ALTER TABLE "external_animals" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "external_animals" DROP COLUMN IF EXISTS "breeder";
