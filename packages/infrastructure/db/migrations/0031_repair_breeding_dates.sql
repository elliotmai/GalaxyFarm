-- Breeding dates that were stored a day early.
--
-- `<input type="date">` hands over `2026-02-14`, and `new Date("2026-02-14")`
-- reads a bare date string as **midnight UTC**. The breeding screen did that;
-- every other screen on the farm wrote midday local by hand and was right. The
-- app renders with `toLocaleDateString`, which is local, so west of Greenwich
-- the two disagreed by a day: a cow bred on Valentine's Day was logged, shown
-- and projected from the 13th — and because §2 derives everything from that
-- one date, her due date, her calving window and her preg-check reminder were
-- all a day early with her.
--
-- The screen is fixed. These are the rows it already wrote, on a real server,
-- for a cow with a real due date.
--
-- Midday **UTC** rather than midday local, because this runs on a server that
-- does not know where the farm is. It is the same calendar day everywhere from
-- UTC-11 to UTC+11, which is the property the fix needs and the property
-- midnight never had.
--
-- Only rows sitting exactly on midnight UTC are touched, because that is the
-- signature of the bad parse and nothing else writes it: every correct row was
-- written as midday somewhere, which is midnight nowhere.
--
-- `updated_at` moves deliberately. Devices pull what has changed since their
-- cursor (§4.2), so a repair that left it alone would fix the server and leave
-- every phone showing the old day until somebody cleared their site data.
UPDATE "breeding_records"
SET "date" = "date" + interval '12 hours',
    "updated_at" = now()
WHERE "deleted_at" IS NULL
  AND date_part('hour', "date" AT TIME ZONE 'UTC') = 0
  AND date_part('minute', "date" AT TIME ZONE 'UTC') = 0
  AND date_part('second', "date" AT TIME ZONE 'UTC') = 0;
