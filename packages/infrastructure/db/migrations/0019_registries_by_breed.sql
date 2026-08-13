-- File registrations under the breed, not the association's initials.
--
-- `ASA` is the American Shorthorn Association on this farm's papers. It is also
-- the American Simmental Association, and both publish herdbooks whose numbers
-- overlap. A row reading `ASA / 4219133` therefore does not say which animal it
-- means, and no amount of care downstream can recover what the field never
-- held. Every registry this app reads keeps exactly one breed's herdbook, so
-- the breed names it and cannot collide: `Shorthorn / 4219133`.
--
-- Four codes are rewritten and nothing else is touched. A registry this app has
-- never heard of keeps whatever it was given — the point is to remove an
-- ambiguity that is known to exist, not to normalise records nobody has
-- checked.
--
-- `updated_at` moves with the change on purpose. It carries the sync cursors
-- (§4.2), so a row rewritten here without it would stay old on every device
-- that already holds it, and the two would disagree indefinitely. The
-- `IS DISTINCT FROM` guard keeps rows that had nothing to rename out of that
-- entirely, so re-running this costs nothing and re-syncs nothing.

-- One registration list at a time, rebuilt element by element in its original
-- order. `WITH ORDINALITY` is what preserves that order: `jsonb_agg` over an
-- unordered set would silently reshuffle an animal's registrations, and the
-- first one in the list is the one screens show.
WITH renamed AS (
  SELECT
    profile.id,
    jsonb_agg(
      CASE
        WHEN renaming.breed IS NULL THEN element.entry
        ELSE jsonb_set(element.entry, '{association}', to_jsonb(renaming.breed))
      END
      ORDER BY element.ordinality
    ) AS registrations
  FROM "cattle_profiles" AS profile
  CROSS JOIN LATERAL
    jsonb_array_elements(profile.registrations) WITH ORDINALITY AS element(entry, ordinality)
  LEFT JOIN (
    VALUES ('AMAA', 'Maine-Anjou'), ('ACA', 'Chianina'), ('ASA', 'Shorthorn'), ('AAA', 'Angus')
  ) AS renaming(code, breed) ON renaming.code = element.entry ->> 'association'
  WHERE profile.registrations IS NOT NULL
    AND jsonb_typeof(profile.registrations) = 'array'
  GROUP BY profile.id
)
UPDATE "cattle_profiles" AS profile
SET registrations = renamed.registrations,
    updated_at = now()
FROM renamed
WHERE profile.id = renamed.id
  AND profile.registrations IS DISTINCT FROM renamed.registrations;

-- Outside animals carry the same list, plus a single column naming the registry
-- the record was first read from.
WITH renamed AS (
  SELECT
    animal.id,
    jsonb_agg(
      CASE
        WHEN renaming.breed IS NULL THEN element.entry
        ELSE jsonb_set(element.entry, '{association}', to_jsonb(renaming.breed))
      END
      ORDER BY element.ordinality
    ) AS registrations
  FROM "external_animals" AS animal
  CROSS JOIN LATERAL
    jsonb_array_elements(animal.registrations) WITH ORDINALITY AS element(entry, ordinality)
  LEFT JOIN (
    VALUES ('AMAA', 'Maine-Anjou'), ('ACA', 'Chianina'), ('ASA', 'Shorthorn'), ('AAA', 'Angus')
  ) AS renaming(code, breed) ON renaming.code = element.entry ->> 'association'
  WHERE animal.registrations IS NOT NULL
    AND jsonb_typeof(animal.registrations) = 'array'
  GROUP BY animal.id
)
UPDATE "external_animals" AS animal
SET registrations = renamed.registrations,
    updated_at = now()
FROM renamed
WHERE animal.id = renamed.id
  AND animal.registrations IS DISTINCT FROM renamed.registrations;

UPDATE "external_animals"
SET association = CASE association
      WHEN 'AMAA' THEN 'Maine-Anjou'
      WHEN 'ACA' THEN 'Chianina'
      WHEN 'ASA' THEN 'Shorthorn'
      WHEN 'AAA' THEN 'Angus'
    END,
    updated_at = now()
WHERE association IN ('AMAA', 'ACA', 'ASA', 'AAA');
