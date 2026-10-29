import {
  animalsWithoutOutside,
  endOfDay,
  isOnFarm,
  type Animal,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import {
  animalsUnderWithdrawal,
  awaitingCalving,
  CATTLE_CLASS_SINGULAR,
  cattleClass,
  damsThatHaveCalved,
  projectedDueDate,
  type BreedingRecord,
  type CalvingRecord,
  type HealthRecord,
} from "@galaxy-farm/module-cattle";
import { outstandingPetCare } from "@galaxy-farm/module-pets";
import { headCountOn, type Flock, type FlockAdjustment } from "@galaxy-farm/module-poultry";

import { ageLabel, flagFor, type HerdFlag } from "@/app/(admin)/admin/cattle/_components/herd-row";
import { animalHref, animalTitle, horseHref, petHref } from "@/lib/animal-slug";
import { birdHref, flockHref } from "@/lib/flock-slug";
import { careRecordsFor } from "@/lib/pet-care";

/**
 * Every animal on the place as one list (V2 Animals).
 *
 * Built as plain data from the same records each species' own screen reads,
 * so the row here and the row there are worked out the same way: a cow's chip
 * comes from the herd's own `flagFor`, a flock's count from the poultry log.
 * Kept out of the component so the rules can be read, and tested, without
 * rendering a list.
 */

export const GROUPS = ["cattle", "horses", "flock", "pets"] as const;
export type AnimalGroup = (typeof GROUPS)[number];

export const GROUP_LABELS: Readonly<Record<AnimalGroup, string>> = {
  cattle: "Cattle",
  horses: "Horses",
  flock: "Flock",
  pets: "Pets",
};

export interface AnimalEntry {
  /** The record's id — an animal's, or a flock's for a flock row. */
  readonly id: Ulid;
  readonly group: AnimalGroup;
  /** What the round badge says: the ear tag, a flock's headcount, or a letter. */
  readonly badge: string | undefined;
  readonly title: string;
  /** "Cow · 7 yr · Pasture 3" — already joined. */
  readonly line: string;
  readonly flag: HerdFlag | undefined;
  /** The animal's own page, or the screen that species is kept on. */
  readonly href: string;
  /**
   * Can be picked for the Log. A flock row is not an `Animal`, and the Log's
   * `?animals=` only answers for animals, so a flock is logged from inside
   * the Log (eggs, feeding) rather than picked here.
   */
  readonly selectable: boolean;
  /** Still here: sold, dead and retired animals are folded away by default. */
  readonly onFarm: boolean;
  /** Lower-cased text the search box matches against. */
  readonly haystack: string;
}

export interface EntryInputs {
  readonly animals: readonly Animal[];
  readonly flocks: readonly Flock[];
  readonly adjustments: readonly FlockAdjustment[];
  readonly zones: readonly Zone[];
  readonly assignments: readonly ZoneAssignment[];
  readonly health: readonly HealthRecord[];
  readonly breedings: readonly BreedingRecord[];
  readonly calvings: readonly CalvingRecord[];
  readonly now: Date;
}

function groupOf(animal: Animal): AnimalGroup {
  if (animal.species === "cattle") return "cattle";
  if (animal.species === "horse") return "horses";
  if (animal.species === "dog" || animal.species === "cat") return "pets";
  // A bird kept as its own record is still part of the flock people look for.
  return "flock";
}

/** Where a row goes: the animal's own page, or a bird's flock's page. */
function hrefOf(animal: Animal, group: AnimalGroup, input: EntryInputs): string {
  if (group === "cattle") return animalHref(animal);
  if (group === "horses") return horseHref(animal);
  if (group === "pets") return petHref(animal);
  return birdHref(animal, input.flocks, input.assignments);
}

const SPECIES_WORD: Readonly<Record<string, string>> = {
  horse: "Horse",
  dog: "Dog",
  cat: "Cat",
  chicken: "Chicken",
  quail: "Quail",
};

export function animalEntries(input: EntryInputs): AnimalEntry[] {
  const { animals, now } = input;

  // Every whole-herd rule computed once, never per row — each one reads a
  // whole table, and doing it inside the map would read it once per animal.
  const indoorZoneIds = new Set(input.zones.filter((zone) => zone.indoor).map((zone) => zone.id));
  const zoneById = new Map(input.zones.map((zone) => [zone.id, zone]));
  const withheld = new Set(
    animalsUnderWithdrawal(input.health, now).map((entry) => entry.animalId),
  );
  const calved = damsThatHaveCalved(input.calvings, input.breedings);
  const cattle = animals.filter((animal) => animal.species === "cattle");
  const unplaced = new Set(animalsWithoutOutside(cattle, input.assignments, indoorZoneIds));

  const dueByAnimal = new Map<Ulid, Date>();
  for (const record of awaitingCalving(input.breedings, input.calvings, now)) {
    const due = projectedDueDate(record);
    const was = dueByAnimal.get(record.damId);
    if (was === undefined || due < was) dueByAnimal.set(record.damId, due);
  }

  // The pen a row names: the outside one when there is one, as on the herd.
  const zoneOf = new Map<Ulid, Zone>();
  for (const assignment of input.assignments) {
    if (assignment.periodTo !== undefined) continue;
    const zone = zoneById.get(assignment.zoneId);
    if (zone === undefined) continue;
    const held = zoneOf.get(assignment.animalId);
    if (held === undefined || (held.indoor && !zone.indoor)) zoneOf.set(assignment.animalId, zone);
  }

  // A pet whose shots have lapsed — the pets screen's red line, as a chip.
  const petIds = new Set(
    animals.filter((animal) => groupOf(animal) === "pets").map((animal) => animal.id),
  );
  const careOverdue = new Set(
    outstandingPetCare(
      careRecordsFor(input.health.filter((record) => petIds.has(record.animalId))),
      now,
    )
      .filter((need) => need.status === "overdue")
      .map((need) => need.animalId),
  );

  const rows: AnimalEntry[] = animals.map((animal) => {
    const group = groupOf(animal);
    const title = animalTitle(animal);
    const zone = zoneOf.get(animal.id)?.name;
    const kind =
      group === "cattle"
        ? cattleClass(animal, now, { hasCalved: calved.has(animal.id) })
        : undefined;
    const what =
      group === "cattle"
        ? kind === undefined
          ? capitalise(animal.sex)
          : CATTLE_CLASS_SINGULAR[kind]
        : (SPECIES_WORD[animal.species] ?? capitalise(animal.species));
    const line = [what, ageLabel(animal, now), zone]
      .filter((part) => part !== undefined && part !== "")
      .join(" · ");

    let flag = flagFor({
      animal,
      withdrawn: withheld.has(animal.id),
      unplaced: unplaced.has(animal.id),
      due: dueByAnimal.get(animal.id),
      now,
    });
    if (flag === undefined && careOverdue.has(animal.id)) {
      flag = { kind: "pill", tone: "danger", label: "Care overdue" };
    }

    const tag =
      animal.tagNumber === undefined || animal.tagNumber === "" ? undefined : animal.tagNumber;
    return {
      id: animal.id,
      group,
      // Untagged animals other than cattle get their species' letter, so a
      // dog's row is not a dash in a circle; an untagged calf keeps the dash,
      // which is the herd's way of saying "tag her".
      badge: tag ?? (group === "cattle" ? undefined : what.charAt(0)),
      title,
      line,
      flag,
      href: hrefOf(animal, group, input),
      selectable: true,
      onFarm: isOnFarm(animal),
      haystack: [animal.name, animal.tagNumber, line].filter(Boolean).join(" ").toLowerCase(),
    };
  });

  // One row per flock, counted from the log the flock screen keeps (§4.5):
  // a headcount is derived, never stored, so it is asked as of today.
  const today = endOfDay(now);
  for (const flock of input.flocks) {
    const count = headCountOn(flock, input.adjustments, today);
    const zone = flock.zoneId === undefined ? undefined : zoneById.get(flock.zoneId)?.name;
    const line = [
      `${count} ${flock.species === "quail" ? "quail" : count === 1 ? "bird" : "birds"}`,
      zone,
    ]
      .filter((part) => part !== undefined && part !== "")
      .join(" · ");
    rows.push({
      id: flock.id,
      group: "flock",
      badge: String(count),
      title: flock.name,
      line,
      flag: undefined,
      href: flockHref(flock, input.flocks),
      selectable: false,
      onFarm: flock.active,
      haystack: [flock.name, line].join(" ").toLowerCase(),
    });
  }

  return rows.sort(
    (left, right) =>
      GROUPS.indexOf(left.group) - GROUPS.indexOf(right.group) ||
      left.title.localeCompare(right.title, undefined, { numeric: true }),
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
