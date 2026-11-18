-- A feeding plan owns its animals (spec §5.1, decision 49).
--
-- A plan used to be aimed at one animal, a zone or the whole place, with
-- `also_feeds` listing others sharing an animal's bowl and `portion` saying
-- per_head or shared. Now a plan names one species and the animals (or, for
-- poultry, flocks) it feeds, says each or total, and says where they are fed.
--
-- Every existing plan is converted, not dropped:
--
--   animal plans  feed that animal and everybody in `also_feeds`.
--   zone plans    feed the livestock standing in that zone today, and are fed
--                 there; a coop with no birds kept as animals feeds its flocks.
--   group plans   ("the whole place") feed every livestock animal on the farm
--                 of the commonest species — in practice, the herd.
--
-- Pets were never fed by a zone or group plan (§5.8), so they are left out of
-- those conversions. A converted plan nobody is left on is switched off, so it
-- stays visible to fix rather than drawing feed for nobody.
--
-- `updated_at` is bumped on every converted row, unlike 0026 which avoided it:
-- the shape has changed, and a device must pull the new one rather than keep
-- an old record its screens can no longer read.

ALTER TABLE "feeding_plans" ADD COLUMN IF NOT EXISTS "species" text;
--> statement-breakpoint
ALTER TABLE "feeding_plans" ADD COLUMN IF NOT EXISTS "animal_ids" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "feeding_plans" ADD COLUMN IF NOT EXISTS "flock_ids" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "feeding_plans" ADD COLUMN IF NOT EXISTS "place_zone_id" text;
--> statement-breakpoint
ALTER TABLE "feeding_plans" ADD COLUMN IF NOT EXISTS "place_label" text;
--> statement-breakpoint

-- Everything below reads the old columns, so it runs only while they exist —
-- a database that already took this file skips straight past it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'feeding_plans' AND column_name = 'target'
  ) THEN

    -- Animal plans: the animal, then its company.
    UPDATE "feeding_plans" AS p
    SET "animal_ids" = ARRAY[p."target_id"] || COALESCE(p."also_feeds", '{}'),
        "species" = a."species"
    FROM "animals" AS a
    WHERE p."target" = 'animal' AND a."id" = p."target_id";

    -- Zone plans: the livestock in the zone today, fed in that zone.
    UPDATE "feeding_plans" AS p
    SET "place_zone_id" = p."target_id",
        "animal_ids" = COALESCE((
          SELECT array_agg(DISTINCT za."animal_id")
          FROM "zone_assignments" AS za
          JOIN "animals" AS a ON a."id" = za."animal_id"
          WHERE za."zone_id" = p."target_id"
            AND za."period_to" IS NULL
            AND za."deleted_at" IS NULL
            AND a."deleted_at" IS NULL
            AND a."status" IN ('active', 'boarding')
            AND a."species" NOT IN ('dog', 'cat', 'reptile')
        ), '{}'),
        "species" = (
          SELECT a."species"
          FROM "zone_assignments" AS za
          JOIN "animals" AS a ON a."id" = za."animal_id"
          WHERE za."zone_id" = p."target_id"
            AND za."period_to" IS NULL
            AND za."deleted_at" IS NULL
            AND a."deleted_at" IS NULL
            AND a."status" IN ('active', 'boarding')
            AND a."species" NOT IN ('dog', 'cat', 'reptile')
          GROUP BY a."species"
          ORDER BY count(*) DESC, a."species"
          LIMIT 1
        )
    WHERE p."target" = 'zone';

    -- A coop: nobody kept as an animal, so the plan feeds the flocks there.
    UPDATE "feeding_plans" AS p
    SET "flock_ids" = sub."ids", "species" = sub."species"
    FROM (
      SELECT f."zone_id",
             array_agg(f."id" ORDER BY f."id") AS "ids",
             min(f."species") AS "species"
      FROM "flocks" AS f
      WHERE f."deleted_at" IS NULL AND f."active"
      GROUP BY f."zone_id"
    ) AS sub
    WHERE p."target" = 'zone'
      AND cardinality(p."animal_ids") = 0
      AND sub."zone_id" = p."target_id";

    -- Group plans: the commonest livestock species on the place, all of it.
    UPDATE "feeding_plans" AS p
    SET "species" = (
          SELECT a."species" FROM "animals" AS a
          WHERE a."property_id" = p."property_id"
            AND a."deleted_at" IS NULL
            AND a."status" IN ('active', 'boarding')
            AND a."species" NOT IN ('dog', 'cat', 'reptile')
          GROUP BY a."species"
          ORDER BY count(*) DESC, a."species"
          LIMIT 1
        )
    WHERE p."target" = 'group';

    UPDATE "feeding_plans" AS p
    SET "animal_ids" = COALESCE((
          SELECT array_agg(a."id" ORDER BY a."id") FROM "animals" AS a
          WHERE a."property_id" = p."property_id"
            AND a."species" = p."species"
            AND a."deleted_at" IS NULL
            AND a."status" IN ('active', 'boarding')
        ), '{}')
    WHERE p."target" = 'group';

    -- The old portion words become the new ones.
    UPDATE "feeding_plans"
    SET "portion" = CASE WHEN "portion" = 'shared' THEN 'total' ELSE 'each' END;

    -- Anything left without a species (an empty pen, a deleted animal) gets
    -- cattle so the record is readable, and is switched off for review.
    UPDATE "feeding_plans"
    SET "species" = COALESCE("species", 'cattle'),
        "active" = "active"
          AND cardinality("animal_ids") + cardinality("flock_ids") > 0
          AND "species" IS NOT NULL;

    UPDATE "feeding_plans" SET "updated_at" = now();

    ALTER TABLE "feeding_plans" DROP COLUMN "target";
    ALTER TABLE "feeding_plans" DROP COLUMN "target_id";
    ALTER TABLE "feeding_plans" DROP COLUMN "also_feeds";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "feeding_plans" ALTER COLUMN "species" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "feeding_plans" ALTER COLUMN "portion" SET DEFAULT 'each';
--> statement-breakpoint

-- Feed categories: `pet` was every pet food at once; it is now `dry_food`,
-- with wet food, raw food, insects, frozen prey and supplements beside it.
UPDATE "feed_types" SET "category" = 'dry_food', "updated_at" = now() WHERE "category" = 'pet';
