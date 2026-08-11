-- Money moves from an integer `*_cents` column to jsonb holding the domain's
-- `{ cents }`. The old columns were unreachable: the repository maps a column
-- key to the identically-named field, and no record has an `askingPriceCents`.
-- `asking_price` is added NOT NULL without a default because the table is
-- empty by construction — a purchase candidate could not be saved at all.
ALTER TABLE "purchase_candidates" ADD COLUMN "asking_price" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD COLUMN "budget_estimate" jsonb;