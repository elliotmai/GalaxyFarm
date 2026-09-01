-- Chore templates learn which part of the day they belong to (spec §5.1, §6).
--
-- Until now a template said which *day* and nothing finer, so every instance
-- was due at the end of it — the morning stall check and the evening lock-up
-- both turned late at midnight, and until then sat in an arbitrary order on
-- the sheet. Feeding chores already carry a part of the day and its deadline;
-- this column lets a template use the same arithmetic: `morning`, `midday`,
-- `evening` or `night`, with the instance due by that part's deadline.
--
-- Nullable, and no default: NULL means the whole day, which is exactly what
-- every template written before this column existed meant. The domain reads a
-- missing `timeOfDay` the same way, so old rows and old devices keep saying
-- what they always said.
ALTER TABLE "chore_templates"
  ADD COLUMN "time_of_day" text;
--> statement-breakpoint

-- `updated_at` is deliberately NOT touched. It carries the sync cursors
-- (§4.2), so moving it would re-send every template to every device for a
-- change none of them can see: the column arrives NULL, which is what those
-- devices already believe. Rows travel on their next real edit.
