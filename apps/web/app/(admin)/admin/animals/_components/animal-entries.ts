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

export const GROUPS = ["cattle", "horses", "chickens", "dogs", "cats"] as const;
export type AnimalGroup = (typeof GROUPS)[number];

export const GROUP_LABELS: Readonly<Record<AnimalGroup, string>> = {
  cattle: "Cattle",
  horses: "Horses",
  chickens: "Chickens",
  dogs: "Dogs",
  cats: "Cats",
};

/** Each species' own page — what its chip on the Animals list opens. */
export const GROUP_HOMES: Readonly<Record<AnimalGroup, string>> = {
  cattle: "/admin/cattle",
  horses: "/admin/horses",
  chickens: "/admin/chickens/flock",
  dogs: "/admin/pets/dogs",
  cats: "/admin/pets/cats",
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
  /** Where it stands outdoors — a pen or pasture — if anywhere is recorded. */
  readonly outside: Place | undefined;
  /** The barn or stall it is in tonight, if any. Optional, always. */
  readonly inside: Place | undefined;
  /** For the Sex filter. A flock has none. */
  readonly sex: string | undefined;
  /** The record's status — active, sold, dead… — or a flock's active/retired. */
  readonly status: string;
  /** "Cow", "Heifer", "Dog" — what the Class filter and grouping read. */
  readonly kind: string;
}

/** A zone as a row names it. */
export interface Place {
  readonly id: Ulid;
  readonly name: string;
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
  if (animal.species === "dog") return "dogs";
  if (animal.species === "cat") return "cats";
  // A bird kept as its own record is still part of the flock people look for.
  return "chickens";
}

/** Where a row goes: the animal's own page, or a bird's flock's page. */
function hrefOf(animal: Animal, group: AnimalGroup, input: EntryInputs): string {
  if (group === "cattle") return animalHref(animal);
  if (group === "horses") return horseHref(animal);
  if (group === "dogs" || group === "cats") return petHref(animal);
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

  // Where each animal stands, in both places at once: the pasture it is on and
  // the barn it may be shut in tonight. The latest open assignment wins each.
  const outsideOf = new Map<Ulid, Zone>();
  const insideOf = new Map<Ulid, Zone>();
  for (const assignment of [...input.assignments].sort(
    (left, right) => left.periodFrom.getTime() - right.periodFrom.getTime(),
  )) {
    if (assignment.periodTo !== undefined) continue;
    const zone = zoneById.get(assignment.zoneId);
    if (zone === undefined) continue;
    (zone.indoor ? insideOf : outsideOf).set(assignment.animalId, zone);
  }

  // A pet whose shots have lapsed — the pets screen's red line, as a chip.
  const petIds = new Set(
    animals
      .filter((animal) => groupOf(animal) === "dogs" || groupOf(animal) === "cats")
      .map((animal) => animal.id),
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
    const outside = outsideOf.get(animal.id);
    const inside = insideOf.get(animal.id);
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
    const line = [
      what,
      ageLabel(animal, now),
      outside?.name,
      inside === undefined ? undefined : `inside ${inside.name}`,
    ]
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
      outside: outside === undefined ? undefined : { id: outside.id, name: outside.name },
      inside: inside === undefined ? undefined : { id: inside.id, name: inside.name },
      sex: animal.sex,
      status: animal.status,
      kind: what,
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
      group: "chickens",
      badge: String(count),
      title: flock.name,
      line,
      flag: undefined,
      href: flockHref(flock, input.flocks),
      selectable: false,
      onFarm: flock.active,
      haystack: [flock.name, line].join(" ").toLowerCase(),
      outside:
        zone === undefined || flock.zoneId === undefined
          ? undefined
          : { id: flock.zoneId, name: zone },
      inside: undefined,
      sex: undefined,
      status: flock.active ? "active" : "retired",
      kind: flock.species === "quail" ? "Quail flock" : "Flock",
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

/**
 * How the list is narrowed and laid out: where, sex, status, class, and what
 * it is grouped by. Each is "" for "any", because they come straight out of a
 * `<select>` and out of the address bar, neither of which has an undefined.
 *
 * Kept in the address rather than in component state, so a list narrowed to
 * "heifers in Pasture 3" is still narrowed after opening one of them and
 * coming Back.
 */
export interface EntryView {
  /** A zone id (outside or inside), `none` for nowhere recorded, or "". */
  readonly where: string;
  readonly sex: string;
  /** A status, or "" for whatever is on the farm. */
  readonly status: string;
  readonly kind: string;
  readonly groupBy: GroupBy;
}

export const GROUP_BYS = ["", "where", "kind", "sex", "status"] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

export const GROUP_BY_LABELS: Readonly<Record<GroupBy, string>> = {
  "": "No grouping",
  where: "Where",
  kind: "Class",
  sex: "Sex",
  status: "Status",
};

export const NO_VIEW: EntryView = { where: "", sex: "", status: "", kind: "", groupBy: "" };

/** Read a view out of the address bar, ignoring anything it does not know. */
export function viewFrom(params: { get(name: string): string | null }): EntryView {
  const groupBy = params.get("by") ?? "";
  return {
    where: params.get("where") ?? "",
    sex: params.get("sex") ?? "",
    status: params.get("status") ?? "",
    kind: params.get("class") ?? "",
    groupBy: (GROUP_BYS as readonly string[]).includes(groupBy) ? (groupBy as GroupBy) : "",
  };
}

/** The filters in force, as the line under the chips says them. */
export function viewFacts(view: EntryView, zones: readonly Pick<Zone, "id" | "name">[]): string[] {
  return [
    view.where === ""
      ? undefined
      : view.where === "none"
        ? "Not placed"
        : (zones.find((zone) => zone.id === view.where)?.name ?? "A pen"),
    view.sex === "" ? undefined : capitalise(view.sex),
    view.status === "" ? undefined : capitalise(view.status),
    view.kind === "" ? undefined : view.kind,
  ].filter((part): part is string => part !== undefined);
}

export function filterEntries(entries: readonly AnimalEntry[], view: EntryView): AnimalEntry[] {
  return entries.filter((entry) => {
    if (view.where === "none" && entry.outside !== undefined) return false;
    if (
      view.where !== "" &&
      view.where !== "none" &&
      entry.outside?.id !== view.where &&
      entry.inside?.id !== view.where
    ) {
      return false;
    }
    if (view.sex !== "" && entry.sex !== view.sex) return false;
    if (view.status !== "" && entry.status !== view.status) return false;
    if (view.kind !== "" && entry.kind !== view.kind) return false;
    return true;
  });
}

export interface EntrySection {
  readonly label: string;
  readonly entries: readonly AnimalEntry[];
}

/**
 * The list cut into headed sections — by pasture, by class, by sex, by status.
 *
 * By "where" reads the outside place, the one every animal has; a barn it is
 * shut in tonight still shows on its row. Sections come in name order, with
 * the catch-all ("Not placed", "Unknown") last, where a list of loose ends
 * belongs.
 */
export function groupEntries(entries: readonly AnimalEntry[], by: GroupBy): EntrySection[] {
  if (by === "") return [{ label: "", entries }];

  const LAST = "￿";
  const labelOf = (entry: AnimalEntry): string => {
    switch (by) {
      case "where":
        return entry.outside?.name ?? `${LAST}Not placed`;
      case "kind":
        return entry.kind;
      case "sex":
        return entry.sex === undefined ? `${LAST}Not recorded` : capitalise(entry.sex);
      case "status":
        return capitalise(entry.status);
    }
  };

  const sections = new Map<string, AnimalEntry[]>();
  for (const entry of entries) {
    const label = labelOf(entry);
    sections.set(label, [...(sections.get(label) ?? []), entry]);
  }
  return [...sections.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([label, held]) => ({ label: label.replace(LAST, ""), entries: held }));
}
