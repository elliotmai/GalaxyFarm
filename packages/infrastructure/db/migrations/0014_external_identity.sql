ALTER TABLE "external_animals" ADD COLUMN "registrations" jsonb;--> statement-breakpoint
ALTER TABLE "external_animals" ADD COLUMN "tattoo" text;--> statement-breakpoint
ALTER TABLE "external_animals" ADD COLUMN "dob" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_animals" ADD COLUMN "colour" text;--> statement-breakpoint
ALTER TABLE "external_animals" ADD COLUMN "breeder" text;--> statement-breakpoint
ALTER TABLE "external_animals" ADD COLUMN "genetic_tests" jsonb;
