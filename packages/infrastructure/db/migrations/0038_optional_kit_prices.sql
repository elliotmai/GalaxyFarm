-- Prices on supplies, fuel and equipment candidates become optional (spec §5.6, §5.11).
--
-- Three money columns were NOT NULL, so every screen that wrote them had to
-- invent a figure when nobody had one — and the figure it invented was $0.
-- A pallet of shavings from the neighbour, diesel out of the bulk tank, a
-- tractor listed "price on request": each is a real record with no price, and
-- writing zero made the spend look smaller and the candidate look cheapest.
--
-- NULL now means "not recorded". Every reader treats it as absent rather than
-- zero: spend and cost of ownership leave it out, the weighted cost a calf is
-- charged for supplies averages only priced purchases, and an unpriced
-- candidate sorts after the priced ones instead of first.
ALTER TABLE "supply_purchases" ALTER COLUMN "unit_cost" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "fuel_logs" ALTER COLUMN "cost" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "purchase_candidates" ALTER COLUMN "asking_price" DROP NOT NULL;
--> statement-breakpoint

-- No backfill. Rows written before this have a price somebody typed (or the
-- $0 a blank used to become); there is no telling those zeros from a real
-- free item, so they are left as they are. `updated_at` is not touched, for
-- the same reason as 0033: it carries the sync cursors (§4.2).
