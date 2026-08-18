import { projectedId, type CalendarEntry, type Ulid } from "@galaxy-farm/core";

import type { ProgramEnrollment } from "./entities.js";
import { ruleDeadlines, type RuleSubject } from "./rules.js";

/**
 * What the business puts on the unified calendar (spec §6, §5.7).
 *
 * Three of §6's kinds, and they are all deadlines rather than appointments:
 * the ring by eight months, the departures at ten and twelve, and the two ends
 * of a calf's stay. §5.7 has the age rules "evaluated at booking and
 * continuously against DOB", and continuously is what a calendar row is — a
 * calf that arrives at four months is ringed at eight and gone at ten, both
 * dates knowable the day it arrives.
 *
 * Everything here derives from a date of birth or from the enrollment record,
 * so a DOB corrected after the papers turn up moves all three at once.
 */

const ANIMALS = "animals";
const ENROLLMENTS = "programEnrollments";

export interface BusinessCalendarInput {
  /**
   * The calves the rules apply to, in the shape the rule engine reads.
   *
   * Assembled by the caller because §4.1 keeps this module from importing
   * cattle — sex, weaning and visible ID belong to whoever owns the animal,
   * and `RuleSubject` is the agreed shape they cross in.
   */
  readonly subjects?: readonly RuleSubject[];
  readonly enrollments?: readonly ProgramEnrollment[];
  /** For the names on the rows; an unnamed calf still gets its deadlines. */
  readonly animalNames?: ReadonlyMap<Ulid, string>;
}

/** Every business row, unordered — `projectEvents` sorts and windows them. */
export function businessCalendarEntries(input: BusinessCalendarInput, now: Date): CalendarEntry[] {
  const name = (id: Ulid): string => input.animalNames?.get(id) ?? "Calf";

  return [
    ...deadlineEntries(input.subjects ?? [], now, name),
    ...enrollmentEntries(input.enrollments ?? [], name),
  ];
}

/**
 * The age rules, as dates.
 *
 * A satisfied rule still gets its row. A bull ringed in March has a ring
 * deadline in March, and dropping it from the calendar the moment it is done
 * would make the month it happened in unreadable a year later — the row says
 * so instead, which is what `satisfied` is for.
 */
function deadlineEntries(
  subjects: readonly RuleSubject[],
  now: Date,
  name: (id: Ulid) => string,
): CalendarEntry[] {
  return subjects.flatMap((subject) =>
    ruleDeadlines(subject, now).map((deadline) => ({
      // One animal has several deadlines, so the rule's own id is the
      // discriminator — a slug, not a position, so adding a rule to §5.7's
      // table does not renumber the rows already on the calendar.
      id: `${projectedId("rule_deadline", ANIMALS, deadline.animalId)}:${deadline.rule.id}`,
      kind: "rule_deadline" as const,
      module: "business" as const,
      title: `${name(deadline.animalId)} — ${deadline.rule.statement}`,
      detail: deadline.satisfied ? "Done" : undefined,
      at: deadline.dueOn,
      allDay: true,
      source: { entity: ANIMALS, id: deadline.animalId },
    })),
  );
}

/**
 * Drop-offs and estimated pickups.
 *
 * The pickup is an estimate and says so in its own kind, because §5.7 has the
 * departure governed by the age rules and by whenever the owner actually turns
 * up — a date on the agreement is a plan, not an appointment.
 */
function enrollmentEntries(
  enrollments: readonly ProgramEnrollment[],
  name: (id: Ulid) => string,
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];

  for (const enrollment of enrollments) {
    if (enrollment.dropOffDate !== undefined) {
      entries.push({
        id: projectedId("drop_off", ENROLLMENTS, enrollment.id),
        kind: "drop_off",
        module: "business",
        title: `${name(enrollment.animalId)} — drop-off`,
        at: enrollment.dropOffDate,
        allDay: true,
        source: { entity: ENROLLMENTS, id: enrollment.id },
      });
    }

    const pickup = enrollment.estPickupDate ?? enrollment.targetEndDate;
    if (pickup !== undefined) {
      entries.push({
        id: projectedId("pickup_estimate", ENROLLMENTS, enrollment.id),
        kind: "pickup_estimate",
        module: "business",
        title: `${name(enrollment.animalId)} — pickup (estimated)`,
        at: pickup,
        allDay: true,
        source: { entity: ENROLLMENTS, id: enrollment.id },
      });
    }
  }

  return entries;
}
