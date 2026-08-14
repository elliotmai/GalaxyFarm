-- Close the duplicate open assignments a bug left behind.
--
-- Reported from the field: a cow set to the zone she was already in ended up
-- assigned to it twice — two rows, same animal, same zone, both open. The
-- cause is fixed in `moveToZone`, which used to skip closing her existing row
-- (rightly, since closing and reopening one zone writes a zero-length period
-- for no reason) and then open the new row regardless, which does not follow.
--
-- The rows it already wrote are still there, and no screen can render them
-- honestly: she is in one place, and the record says she is in it twice.
--
-- ## What is repaired, and what deliberately is not
--
-- Only duplicates of the **same zone**. Those are provably spurious — nothing
-- about where the animal is changed between the two rows, so the later one
-- says nothing the earlier one did not. The earliest is kept because it holds
-- the true date she arrived; keeping the newest would silently reset it.
--
-- Two open rows in **different** zones are left alone. That is a genuine
-- conflict about where an animal is, and only somebody who was there knows
-- which is right. `doubleBookedAnimals` surfaces them for a person to settle,
-- and quietly picking one here would destroy the evidence that there was ever
-- a question.
--
-- ## Soft, not hard
--
-- Tombstoned rather than deleted, like every other removal in this app (§4.5):
-- the row goes to Trash with a reason on it, and `updated_at` moves so the
-- change reaches every device through the ordinary sync rather than leaving
-- the duplicate sitting in somebody's phone forever.
WITH duplicates AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY animal_id, zone_id
      -- Oldest first: it carries the date she actually arrived.
      ORDER BY period_from, created_at, id
    ) AS n
  FROM "zone_assignments"
  WHERE period_to IS NULL
    AND deleted_at IS NULL
)
UPDATE "zone_assignments" AS za
SET
  deleted_at = now(),
  deleted_reason = 'Duplicate open assignment for a zone the animal was already in (repaired by migration 0024)',
  updated_at = now()
FROM duplicates
WHERE duplicates.id = za.id
  AND duplicates.n > 1;
