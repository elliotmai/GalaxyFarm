import {
  animalsFedBy,
  displayName,
  isShared,
  type Animal,
  type FeedingPlan,
  type Ulid,
} from "@galaxy-farm/core";
import type { HealthRecord } from "@galaxy-farm/module-cattle";
import type { FeedType } from "@galaxy-farm/module-feed";
import type { PetCareRecord } from "@galaxy-farm/module-pets";

import { describePlanLine } from "@/lib/feed-lines";

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

/** The plans feeding one pet — including any bowl it shares with another. */
export function plansFeeding(petId: Ulid, plans: readonly FeedingPlan[]): FeedingPlan[] {
  return plans.filter((plan) => plan.target === "animal" && animalsFedBy(plan).includes(petId));
}

/**
 * Every line of every live plan for one pet, worded.
 *
 * `animals` is passed so a shared bowl can name the cats on it. Without them
 * the sentence still reads correctly, just without the names — a screen that
 * has not got the herd to hand should degrade rather than refuse.
 */
export function feedingLinesFor(
  petId: Ulid,
  plans: readonly FeedingPlan[],
  feeds: readonly FeedType[],
  animals: readonly Pick<Animal, "id" | "name" | "tagNumber">[] = [],
): string[] {
  return plansFeeding(petId, plans)
    .filter((plan) => plan.active)
    .flatMap((plan) => {
      const between = isShared(plan)
        ? animalsFedBy(plan)
            .map((id) => animals.find((animal) => animal.id === id))
            .filter(
              (animal): animal is Pick<Animal, "id" | "name" | "tagNumber"> => animal !== undefined,
            )
            .map(displayName)
        : [];

      return plan.lines.map((line) => describePlanLine(line, feeds, between));
    });
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
