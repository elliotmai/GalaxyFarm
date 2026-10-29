-- Chore templates can wait for the weather (spec §5.1, §6).
--
-- Some jobs are only jobs on certain days: tank covers before a hard freeze,
-- row cover on a frost night, shutting the coop before rain. Until now a
-- template that said "every day" put "covers on" on the board every morning
-- of a mild week, and people learned to tick it without looking. This column
-- names the weather it waits for — `freeze_tonight`, `frost_tonight`,
-- `freezing_today`, `rain_coming`, `wind_coming` or `heat_today` — and the day sheet only
-- generates it on days the forecast shows that.
--
-- Nullable, and no default: NULL means the recurrence alone decides, which is
-- exactly what every template written before this column existed meant.
ALTER TABLE "chore_templates"
  ADD COLUMN "weather" text;
--> statement-breakpoint

-- `updated_at` is deliberately NOT touched, for the same reason as 0033: it
-- carries the sync cursors (§4.2), and the column arrives NULL, which is what
-- every device already believes.
