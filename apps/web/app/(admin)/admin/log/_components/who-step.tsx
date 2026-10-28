"use client";

import { useMemo, useState } from "react";

import { Button, TextInput } from "@galaxy-farm/ui";
import {
  displayName,
  type Animal,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import {
  CATTLE_CLASS_LABELS,
  CATTLE_CLASS_SINGULAR,
  cattleClass,
  damsThatHaveCalved,
  type BreedingRecord,
  type CalvingRecord,
  type CattleClass,
} from "@galaxy-farm/module-cattle";

import { useRecords } from "@/lib/local/use-records";

import { eligible, KIND_LABELS, singleAnimal, type LogKind } from "./log-kinds";
import { StepFooter } from "./log-parts";

/**
 * Step 2: who.
 *
 * Every animal that can take this kind, with a search box and quick groups
 * built from the herd as it stands — one per pen with somebody in it, one per
 * class of cattle, one per other species — so "the whole calving pen" or
 * "all the calves" is one tap. A group chip adds its animals; pressed again
 * (it shows pressed when all of them are chosen) it takes them back off.
 *
 * A calving is one cow, so the list becomes a single choice and the groups go.
 */

const SPECIES_GROUP: Readonly<Record<string, string>> = {
  horse: "Horses",
  chicken: "Chickens",
  quail: "Quail",
  dog: "Dogs",
  cat: "Cats",
};

interface Group {
  readonly key: string;
  readonly label: string;
  readonly ids: readonly Ulid[];
}

export function WhoStep({
  propertyId,
  kind,
  animals,
  selected,
  onSelected,
  onNext,
}: {
  readonly propertyId: Ulid;
  readonly kind: LogKind;
  readonly animals: readonly Animal[];
  readonly selected: readonly Ulid[];
  readonly onSelected: (ids: readonly Ulid[]) => void;
  readonly onNext: () => void;
}) {
  const query = { propertyId };
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", query);
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", query);

  const [search, setSearch] = useState("");
  const single = singleAnimal(kind);

  const candidates = useMemo(
    () =>
      animals
        .filter((animal) => eligible(kind, animal))
        .sort((left, right) => displayName(left).localeCompare(displayName(right))),
    [animals, kind],
  );

  // Fixed for the render, so a calf a day short of a year cannot change class
  // between its row and its group.
  const asOf = useMemo(() => new Date(), []);
  const calved = useMemo(() => damsThatHaveCalved(calvings, breedings), [calvings, breedings]);
  const classes = useMemo(
    () =>
      new Map(
        candidates.map((animal) => [
          animal.id,
          animal.species === "cattle"
            ? cattleClass(animal, asOf, { hasCalved: calved.has(animal.id) })
            : undefined,
        ]),
      ),
    [candidates, asOf, calved],
  );
  const classOf = (animal: Animal): CattleClass | undefined => classes.get(animal.id);

  /** Where each animal stands now — both slots, outside and in. */
  const zonesByAnimal = useMemo(() => {
    const names = new Map(zones.map((zone) => [zone.id, zone.name]));
    const map = new Map<Ulid, string[]>();
    for (const assignment of assignments) {
      if (assignment.periodTo !== undefined) continue;
      const name = names.get(assignment.zoneId);
      if (name === undefined) continue;
      map.set(assignment.animalId, [...(map.get(assignment.animalId) ?? []), name]);
    }
    return map;
  }, [zones, assignments]);

  const groups = useMemo<Group[]>(() => {
    if (single) return [];
    const ids = new Set(candidates.map((animal) => animal.id));

    const byZone = new Map<Ulid, Set<Ulid>>();
    for (const assignment of assignments) {
      if (assignment.periodTo !== undefined || !ids.has(assignment.animalId)) continue;
      const members = byZone.get(assignment.zoneId) ?? new Set<Ulid>();
      members.add(assignment.animalId);
      byZone.set(assignment.zoneId, members);
    }
    const pens: Group[] = zones
      .filter((zone) => byZone.has(zone.id))
      .map((zone) => ({
        key: `zone:${zone.id}`,
        label: `Whole ${zone.name}`,
        ids: [...(byZone.get(zone.id) ?? [])],
      }))
      .filter((group) => group.ids.length > 1);

    const byClass = new Map<CattleClass, Ulid[]>();
    const bySpecies = new Map<string, Ulid[]>();
    for (const animal of candidates) {
      const cls = classes.get(animal.id);
      if (cls !== undefined) byClass.set(cls, [...(byClass.get(cls) ?? []), animal.id]);
      else bySpecies.set(animal.species, [...(bySpecies.get(animal.species) ?? []), animal.id]);
    }
    const byClassGroups: Group[] = [...byClass.entries()]
      // A class that is the whole list is not a group worth a chip.
      .filter(([, members]) => members.length > 1 && members.length < candidates.length)
      .map(([cls, members]) => ({
        key: `class:${cls}`,
        label: CATTLE_CLASS_LABELS[cls],
        ids: members,
      }));
    const species: Group[] = [...bySpecies.entries()]
      .filter(([, members]) => members.length > 1 && members.length < candidates.length)
      .map(([name, members]) => ({
        key: `species:${name}`,
        label: SPECIES_GROUP[name] ?? name,
        ids: members,
      }));

    return [...pens, ...byClassGroups, ...species];
  }, [single, candidates, assignments, zones, classes]);

  const needle = search.trim().toLowerCase();
  const shown =
    needle === ""
      ? candidates
      : candidates.filter((animal) =>
          [animal.name, animal.tagNumber, ...(zonesByAnimal.get(animal.id) ?? [])].some(
            (value) => value?.toLowerCase().includes(needle) === true,
          ),
        );

  const chosen = new Set(selected);

  function toggle(id: Ulid) {
    if (single) {
      onSelected(chosen.has(id) ? [] : [id]);
      return;
    }
    onSelected(chosen.has(id) ? selected.filter((entry) => entry !== id) : [...selected, id]);
  }

  function toggleGroup(group: Group) {
    const all = group.ids.every((id) => chosen.has(id));
    onSelected(
      all
        ? selected.filter((id) => !group.ids.includes(id))
        : [...selected, ...group.ids.filter((id) => !chosen.has(id))],
    );
  }

  const count = selected.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2.5 px-4 pb-2.5 pt-1 md:px-0">
        <h1 className="text-ink">{KIND_LABELS[kind]} — who?</h1>
        <TextInput
          label="Find an animal"
          hideLabel
          type="search"
          placeholder="Name, tag or pen"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {single ? (
          <p className="text-sm text-muted">One cow per calving.</p>
        ) : groups.length === 0 && count === 0 ? null : (
          <div
            role="group"
            aria-label="Quick groups"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0"
          >
            {groups.map((group) => {
              const on = group.ids.every((id) => chosen.has(id));
              return (
                <button
                  key={group.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleGroup(group)}
                  className={[
                    "inline-flex min-h-target shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
                    on
                      ? "border-action bg-action/15 text-action"
                      : "border-edge bg-panel text-ink hover:bg-raised",
                  ].join(" ")}
                >
                  {group.label}
                  <span className="text-xs opacity-70 [font-variant-numeric:tabular-nums]">
                    {group.ids.length}
                  </span>
                </button>
              );
            })}
            {count === 0 ? null : (
              <button
                type="button"
                onClick={() => onSelected([])}
                className="inline-flex min-h-target shrink-0 items-center whitespace-nowrap rounded-full border border-edge bg-panel px-3.5 text-sm font-medium text-ink hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
              >
                None
              </button>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule bg-panel md:overflow-visible md:rounded-density md:border">
        {candidates.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">
            Nobody on the place can take a {KIND_LABELS[kind].toLowerCase()}.
          </p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Nobody matches “{search.trim()}”.</p>
        ) : (
          <ul aria-label="Animals">
            {shown.map((animal, index) => {
              const on = chosen.has(animal.id);
              const cls = classOf(animal);
              const line = [
                ...(zonesByAnimal.get(animal.id) ?? []),
                cls === undefined
                  ? (SPECIES_GROUP[animal.species] ?? animal.species)
                  : CATTLE_CLASS_SINGULAR[cls],
                animal.tagNumber === undefined || animal.name === undefined
                  ? undefined
                  : `#${animal.tagNumber}`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={animal.id} className={index === 0 ? "" : "border-t border-rule"}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(animal.id)}
                    className={[
                      "flex min-h-[58px] w-full items-center gap-3 px-4 py-1.5 text-left",
                      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action",
                      on ? "bg-action/10" : "hover:bg-canvas",
                    ].join(" ")}
                  >
                    <span
                      aria-hidden="true"
                      className={[
                        "flex h-[26px] w-[26px] shrink-0 items-center justify-center border-2",
                        single ? "rounded-full" : "rounded-lg",
                        on ? "border-action bg-action text-action-ink" : "border-edge bg-panel",
                      ].join(" ")}
                    >
                      {on ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M5 12l5 5 9-10"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate font-semibold text-ink">{displayName(animal)}</span>
                      {line === "" ? null : (
                        <span className="truncate text-sm text-muted">{line}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <StepFooter>
        <Button
          variant="primary"
          block
          disabled={count === 0}
          onClick={onNext}
          className="min-h-14 text-base"
        >
          {count === 0 ? "Pick at least one" : `Next · ${count} animal${count === 1 ? "" : "s"}`}
        </Button>
      </StepFooter>
    </div>
  );
}
