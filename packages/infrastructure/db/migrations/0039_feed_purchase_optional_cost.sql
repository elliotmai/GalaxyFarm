-- A feed purchase can be recorded without a price (spec §5.3).
--
-- Hay off a neighbour's wagon is in the shed today and on a bill at the end of
-- the month. Requiring the price meant either leaving the purchase out — and
-- the shed count wrong for a month — or typing $0, which values that feed at
-- nothing in every cost-per-head figure that used it. NULL now means "not
-- priced yet": the load still counts toward on-hand, and the cost a head says
-- it is incomplete instead of showing a confident $0.
ALTER TABLE "feed_purchases"
  ALTER COLUMN "unit_cost" DROP NOT NULL;
--> statement-breakpoint

-- `updated_at` is deliberately NOT touched, for the same reason as 0033: no
-- row changes here, and every device already holds every value this allows.
