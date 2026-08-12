-- What breed an animal is, in words, as a list.
--
-- Separate from the breed makeup on purpose. The makeup is percentages off the
-- papers; the breed is what somebody would say standing at the fence, and most
-- of this farm's cattle have one long before there are papers to work a
-- percentage out of. A crossbred animal is more than one breed, so it is a
-- list — a column that has to pick one picks wrong every time.
--
-- Nullable rather than defaulted to an empty array: "nobody has said" and "this
-- animal has no breeds" are different, and only the first is true here. An
-- animal with a makeup and no breed on file has its breeds derived from the
-- makeup, so the two cannot drift apart.
ALTER TABLE "cattle_profiles" ADD COLUMN "breed" jsonb;
ALTER TABLE "external_animals" ADD COLUMN "breed" jsonb;
