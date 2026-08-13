-- Which tanks actually have covers, answered (13 August 2026).
--
-- 0021 added the column and defaulted every existing row to 'none', because
-- nobody had said which tanks have covers and 'none' is the reading of silence
-- that raises no chore. The answer since given is that the **auto-refill tanks
-- have covers and the static one does not**, and that all of them are off — it
-- is August. So the three auto-refill tanks move to 'off' and the West Pen's
-- static tank stays 'none', which is what it was defaulted to.
--
-- Keyed on `type` rather than on three ids because that is how the distinction
-- was described, and because an id list in a migration is unreadable a year
-- later. It is still a one-time backfill: a migration runs once, so an
-- auto-refill tank added tomorrow is unaffected and gets whatever the form says.
--
-- `updated_at` moves with it, and that is not decoration. The sync cursor is
-- `(updated_at, id)` — a device asks for everything newer than the last row it
-- saw — so a value changed underneath a row whose timestamp did not move is a
-- value no phone in the barn will ever pull. It would sit correct on the
-- server and wrong on every device, which is the hardest kind of wrong to
-- notice.
--
-- Tombstones are left alone. Bumping a deleted row's timestamp re-sends it to
-- every device as a tombstone it already has, for a field nothing will read.
UPDATE "water_sources"
SET "cover" = 'off',
    "updated_at" = now()
WHERE "type" = 'auto_refill'
  AND "cover" = 'none'
  AND "deleted_at" IS NULL;
