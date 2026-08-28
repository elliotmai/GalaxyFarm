-- Feeding as work, derived from the plans (spec §2, §5.1, §5.3).
--
-- §2 is a non-negotiable: derive, don't duplicate. A feeding plan already says
-- what goes out, to whom, how often and at what time of day, so the day sheet
-- reads the plans rather than asking somebody to write a chore template beside
-- every ration — two copies of one fact, drifting the first time a ration
-- changes, with the chore list quietly wrong.
--
-- Nothing about a derived chore is stored until somebody ticks one. That is
-- how chore templates already work, and it is what lets a plan edited today
-- change tomorrow's sheet without rewriting yesterday's.
--
-- This column is what makes the tick stick. A template's instance is matched
-- by `template_id` plus its day, which works because a template is a row with
-- an id. A feeding chore has no such row behind it: it is the sum of however
-- many plans happened to land on one trip — one pen, one time of day — and
-- that sum can change tomorrow without making today's tick wrong. So the row
-- carries the occurrence's own derived id, and the day sheet drops any
-- occurrence a stored row already claims. Without it the sheet shows the tick
-- and the untouched occurrence side by side, which reads as the chore coming
-- straight back.
--
-- Nullable, and no default: every task already in the table came from a
-- template or from somebody writing it down, and neither has a derived
-- occurrence behind it. NULL is the honest answer for all of them.
ALTER TABLE "tasks"
  ADD COLUMN "source_key" text;
--> statement-breakpoint

-- Not unique, deliberately. The key identifies an occurrence within a
-- property, and `propertyId` is what scopes every table here (§5) — a global
-- constraint would make two properties unable to feed a pen on the same
-- morning. The day sheet already reads within one property, so a plain index
-- is what the lookup wants and a constraint is not.
CREATE INDEX IF NOT EXISTS "tasks_source_key_idx"
  ON "tasks" ("property_id", "source_key");
--> statement-breakpoint

-- `updated_at` is deliberately NOT touched.
--
-- It carries the sync cursors (§4.2), so moving it would re-send every task on
-- the property to every device for a change none of them can see: the column
-- arrives NULL, which is what those devices already believe. Rows travel on
-- their next real edit, and until then the domain reads a missing `sourceKey`
-- as absent — the same answer this migration just wrote down.
