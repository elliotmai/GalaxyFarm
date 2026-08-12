import { z } from "zod";

import { baseRecordSchema, ulidSchema, type BaseRecord, type Ulid } from "@galaxy-farm/core";

/**
 * Breeding soundness on a bull (spec §5.2).
 *
 * A breeding soundness exam is the cheapest insurance on a cattle operation
 * and the one most often skipped. A bull that fails it does not look any
 * different in the pasture — the failure shows up as a calving season that
 * arrives late and light, by which point the year is gone.
 *
 * The verdict is the whole point, so it is a field rather than something to be
 * worked out from three measurements. A vet says satisfactory, deferred, or
 * unsatisfactory, and "deferred" is its own answer: a young bull can fail in
 * February and pass in April, and recording that as a failure would cull a
 * bull who was simply not finished growing.
 */

export const FERTILITY_VERDICTS = ["satisfactory", "deferred", "unsatisfactory"] as const;
export type FertilityVerdict = (typeof FERTILITY_VERDICTS)[number];

export interface FertilityTest extends BaseRecord {
  readonly animalId: Ulid;
  readonly date: Date;
  readonly verdict: FertilityVerdict;
  /** Centimetres. Under 30 at a year old is the usual line. */
  readonly scrotalCircumferenceCm?: number | undefined;
  /** Percent progressively motile. */
  readonly motilityPercent?: number | undefined;
  /** Percent normal. Seventy is the usual threshold. */
  readonly morphologyPercent?: number | undefined;
  readonly vet?: string | undefined;
  /** When it should be repeated — every bull, every year, before turnout. */
  readonly retestDueOn?: Date | undefined;
  readonly notes?: string | undefined;
}

export const fertilityTestSchema = baseRecordSchema.extend({
  animalId: ulidSchema,
  date: z.coerce.date(),
  verdict: z.enum(FERTILITY_VERDICTS),
  scrotalCircumferenceCm: z.number().positive().max(60).optional(),
  motilityPercent: z.number().min(0).max(100).optional(),
  morphologyPercent: z.number().min(0).max(100).optional(),
  vet: z.string().max(160).optional(),
  retestDueOn: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<FertilityTest>;

/** This bull's most recent exam. */
export function latestFertilityTest(
  tests: readonly FertilityTest[],
  animalId: Ulid,
): FertilityTest | undefined {
  return [...tests]
    .filter((test) => test.animalId === animalId)
    .sort((left, right) => right.date.getTime() - left.date.getTime())[0];
}

/**
 * Is he cleared to breed?
 *
 * Untested is not cleared, and neither is a pass from two years ago. A bull
 * passes in April and is a different animal after a hard winter, a foot
 * injury, or a fight over a fence — which is why the industry standard is
 * annually, before turnout, rather than once in a lifetime.
 */
export const FERTILITY_TEST_VALID_DAYS = 365;

export interface FertilityStatus {
  readonly cleared: boolean;
  readonly reason: string;
  readonly test?: FertilityTest | undefined;
  readonly daysSince?: number | undefined;
}

export function fertilityStatus(
  tests: readonly FertilityTest[],
  animalId: Ulid,
  now: Date,
): FertilityStatus {
  const test = latestFertilityTest(tests, animalId);
  if (test === undefined) {
    return { cleared: false, reason: "Never tested" };
  }

  const daysSince = Math.floor((now.getTime() - test.date.getTime()) / 86_400_000);

  if (test.verdict === "unsatisfactory") {
    return { cleared: false, reason: "Failed his last exam", test, daysSince };
  }
  if (test.verdict === "deferred") {
    return {
      cleared: false,
      reason: "Deferred — retest before he is turned out",
      test,
      daysSince,
    };
  }
  if (daysSince > FERTILITY_TEST_VALID_DAYS) {
    return {
      cleared: false,
      reason: `Passed, but ${daysSince} days ago — a year is the usual limit`,
      test,
      daysSince,
    };
  }

  return { cleared: true, reason: `Passed ${daysSince} days ago`, test, daysSince };
}

/** Bulls whose exam has run out or never happened, soonest problem first. */
export function bullsNeedingExam(
  bullIds: readonly Ulid[],
  tests: readonly FertilityTest[],
  now: Date,
): { readonly animalId: Ulid; readonly status: FertilityStatus }[] {
  return bullIds
    .map((animalId) => ({ animalId, status: fertilityStatus(tests, animalId, now) }))
    .filter((entry) => !entry.status.cleared)
    .sort((left, right) => (right.status.daysSince ?? 1e9) - (left.status.daysSince ?? 1e9));
}
