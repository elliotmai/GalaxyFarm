ALTER TABLE "cattle_profiles" ADD COLUMN "genetic_tests" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cattle_profiles" ADD COLUMN "coat_genotype" jsonb;