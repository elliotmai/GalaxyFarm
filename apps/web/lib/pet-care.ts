import type { FeedingPlan, FeedingPlanLine, Ulid } from "@galaxy-farm/core";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";
import type { PetCareRecord } from "@galaxy-farm/module-pets";

/**
 * The joins between a pet and the records that describe it.
 *
 * Here rather than in `module-pets` because every one of them crosses a module
 * boundary: a health record is `module-cattle`'s, a feed is `module-feed`'s,
 * and §4.1 has those two talk only through ids. `apps/web` is where they are
 * allowed to meet, so the translation lives on this side and the pets module
 * keeps taking shapes it can reason about without importing anything.
 */

/**
 * A health record, as care that may come round again.
 *
 * The label is the product where there is one — "Rabies" and "Bravecto" are
 * what somebody would ask about, and two vaccinations both labelled
 * `vaccination` would satisfy each other's boosters.
 */
export function careRecordsFor(records: readonly HealthRecord[]): PetCareRecord[] {
  return records.map((record) => ({
    id: record.id,
    animalId: record.animalId,
    label: record.product ?? record.type,
    performedOn: record.date,
    nextDueOn: record.boosterDueOn,
  }));
}

const FREQUENCY_WORDS: Readonly<Record<FeedingPlanLine["frequency"], string>> = {
  once_daily: "once a day",
  twice_daily: "twice a day",
  three_times_daily: "three times a day",
  every_other_day: "every other day",
  weekly: "once a week",
};

/**
 * One plan line, in the words somebody would say it.
 *
 * "1 scoop of Purina Pro Plan, twice a day, morning" rather than a row of
 * fields. The guide and the pet card both want a sentence, and building it
 * twice is how the two end up disagreeing about the amount.
 */
export function describePlanLine(line: FeedingPlanLine, feeds: readonly FeedType[]): string {
  const feed = feeds.find((held) => held.id === line.feedTypeId)?.name ?? "feed";
  const unit = line.amount.unit.replace(/_/g, " ");
  const plural = line.amount.amount === 1 ? unit : `${unit}s`;

  return `${line.amount.amount} ${plural} of ${feed}, ${FREQUENCY_WORDS[line.frequency]}, ${line.timeOfDay}${
    line.notes === undefined ? "" : ` — ${line.notes}`
  }`;
}

/** Every line of every live plan for one pet, worded. */
export function feedingLinesFor(
  petId: Ulid,
  plans: readonly FeedingPlan[],
  feeds: readonly FeedType[],
): string[] {
  return plans
    .filter((plan) => plan.active && plan.target === "animal" && plan.targetId === petId)
    .flatMap((plan) => plan.lines.map((line) => describePlanLine(line, feeds)));
}

/**
 * Medicines a pet is on now, as a helper would need them.
 *
 * "On now" is the honest part. A dewormer given in March is history; what a
 * housesitter needs is the tablet that has to go in the food this week, and
 * the only marker we have for that is a treatment whose next dose has not yet
 * come round.
 */
export function currentMedicinesFor(
  petId: Ulid,
  records: readonly HealthRecord[],
  now: Date,
): string[] {
  return records
    .filter((record) => record.animalId === petId)
    .filter((record) => record.type === "treatment" || record.type === "deworming")
    .filter((record) => record.boosterDueOn !== undefined && record.boosterDueOn >= now)
    .sort((left, right) => right.date.getTime() - left.date.getTime())
    .map((record) => {
      const what = record.product ?? "a treatment";
      const dose = record.dose === undefined ? "" : `, ${record.dose.amount} ${record.dose.unit}`;
      return record.notes === undefined ? `${what}${dose}` : `${what}${dose} — ${record.notes}`;
    });
}
