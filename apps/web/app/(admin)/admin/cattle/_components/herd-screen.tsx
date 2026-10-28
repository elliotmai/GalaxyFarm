"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Button,
  Checkbox,
  EmptyState,
  Modal,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
  toOptions,
} from "@galaxy-farm/ui";
import {
  ANIMAL_STATUSES,
  SAFETY_LEVEL_DEFAULTS,
  SEXES,
  animalSchema,
  animalsWithoutOutside,
  assignmentInSlot,
  encodeUlid,
  isOnFarm,
  moveToZone,
  zoneAssignmentSchema,
  type Animal,
  type AnimalStatus,
  type SafetyLevel,
  type Sex,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";

import {
  animalsUnderWithdrawal,
  awaitingCalving,
  breedsInUse,
  breedsOf,
  CATTLE_CLASS_LABELS,
  CATTLE_CLASS_SINGULAR,
  cattleClass,
  classCounts,
  damsThatHaveCalved,
  projectedDueDate,
  unclassified,
  type BreedingRecord,
  type CalvingRecord,
  type CattleProfile,
  type HealthRecord,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";
import { animalHref, animalTitle } from "@/lib/animal-slug";
import { useRecords } from "@/lib/local/use-records";

import { ageLabel, flagFor, HerdRow } from "./herd-row";

/**
 * The herd (spec §5.1, §7).
 *
 * Cattle are the same `Animal` every other species uses — §2 is explicit that
 * there is no parallel model for client calves, which is what lets a boarded
 * calf run through the identical program pipeline as an own one. This screen
 * filters to `species: "cattle"` and nothing more.
 *
 * Moving an animal is the operation worth reading. It does not edit the
 * assignment: it closes one and opens another, so where a cow was in March
 * survives. History is free precisely because nothing is overwritten.
 *
 * The list is a list, not a table. Each row is the tag, the name, one line and
 * one chip (`herd-row.tsx`); everything else is on the animal's own page or in
 * the editor, which is a side panel on a laptop and a bottom sheet on a phone.
 * The class chips are the filter people reach for, and the rest of the filters
 * sit behind one button — with whatever is on always said out loud above the
 * list, so a narrowed herd never looks like a smaller one.
 */

const SEX_OPTIONS = toOptions(SEXES);
const STATUS_OPTIONS = toOptions(ANIMAL_STATUSES);
const SAFETY_OPTIONS = Object.values(SAFETY_LEVEL_DEFAULTS).map((level) => ({
  value: String(level.level),
  label: `${level.level} — ${level.label}`,
}));

/**
 * The filters that actually get used (issue #15).
 *
 * Every one of them is "" for off rather than undefined, because they are read
 * straight out of a `<select>` and a select has no undefined to give.
 */
interface Filters {
  readonly zoneId: string;
  readonly status: string;
  readonly sex: string;
  /** A cattle class — cow, bull, steer, calf — or "" for all of them. */
  readonly cattleClass: string;
  /** A breed name, or "" for all of them. */
  readonly breed: string;
  readonly safetyLevel: string;
  readonly withdrawnOnly: boolean;
  /** Only the animals with no pen recorded — what the alert line opens. */
  readonly unplacedOnly: boolean;
}

const NO_FILTERS: Filters = {
  zoneId: "",
  status: "",
  sex: "",
  cattleClass: "",
  breed: "",
  safetyLevel: "",
  withdrawnOnly: false,
  unplacedOnly: false,
};

interface Draft {
  readonly name: string;
  /**
   * The pen or pasture. Required for a new animal.
   *
   * Everything on the place stands somewhere outdoors, and asking at the one
   * moment somebody is already thinking about the animal is the only way that
   * stays true — a pen asked for later is a pen filled in for the first three
   * animals and skipped for the next thirty.
   */
  readonly outsideZoneId: string;
  /** The barn or stall, if it is in one tonight. Optional, always. */
  readonly insideZoneId: string;
  readonly tagNumber: string;
  readonly sex: Sex;
  readonly dob: string;
  readonly dobIsEstimate: boolean;
  readonly status: AnimalStatus;
  readonly safetyLevel: SafetyLevel;
  readonly safetyNotes: string;
  readonly notes: string;
}

const BLANK: Draft = {
  name: "",
  outsideZoneId: "",
  insideZoneId: "",
  tagNumber: "",
  sex: "female",
  dob: "",
  dobIsEstimate: false,
  status: "active",
  safetyLevel: 2,
  safetyNotes: "",
  notes: "",
};

export function HerdScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const { records: all, loading } = useRecords<Animal>("animals", { propertyId, search });
  // The herd unsearched, for the headcount, the class chips and the alert. A
  // count that shrank while somebody typed a name would stop being a count.
  const { records: everyone } = useRecords<Animal>("animals", { propertyId });
  const { records: zones } = useRecords<Zone>("zones", { propertyId });
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", { propertyId });
  // Needed to see past a recipient to the donor: a donor whose every calf came
  // out of a recip has still had calves, and is a cow.
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", { propertyId });
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", { propertyId });
  const { records: health } = useRecords<HealthRecord>("healthRecords", { propertyId });
  // Breed lives on the profile rather than the animal, because most of what a
  // profile holds is breeding information and this is the same conversation.
  const { records: profiles } = useRecords<CattleProfile>("cattleProfiles", { propertyId });

  // Which zones are indoor, so an assignment's slot can be read off its zone
  // rather than trusted from the row — a legacy `primary` row has to count
  // against the slot its zone implies, or the rule misses it entirely.
  const indoorZoneIds = useMemo(
    () => new Set(zones.filter((zone) => zone.indoor).map((zone) => zone.id)),
    [zones],
  );

  const cattle = all.filter((animal) => animal.species === "cattle");
  const herd = useMemo(() => everyone.filter((animal) => animal.species === "cattle"), [everyone]);

  // Whoever is held back by a withdrawal today. Computed once for the whole
  // list rather than per row: it reads every health record, and doing that
  // inside a filter would read them once per animal.
  const withheld = useMemo(
    () => new Set(animalsUnderWithdrawal(health, new Date()).map((entry) => entry.animalId)),
    [health],
  );

  /**
   * The zone an animal is standing in now, by animal.
   *
   * An animal has an outside pen and an inside pen at once (§5.1), so "in this
   * pen" is a membership test, not an equality one — filtering on the first
   * open assignment would hide a cow from her own barn.
   */
  const openZonesByAnimal = useMemo(() => {
    const map = new Map<Ulid, Set<Ulid>>();
    for (const assignment of assignments) {
      if (assignment.periodTo !== undefined) continue;
      const existing = map.get(assignment.animalId) ?? new Set<Ulid>();
      existing.add(assignment.zoneId);
      map.set(assignment.animalId, existing);
    }
    return map;
  }, [assignments]);

  /**
   * Fixed for one render, so an animal cannot change class mid-list.
   *
   * A calf a day short of a year is a calf in the count, in the filter and in
   * its own row, and reading the clock three times could disagree on the
   * morning of its birthday.
   */
  const asOf = useMemo(() => new Date(), []);

  // A heifer becomes a cow by calving, not by ageing — so the calvings decide
  // which of the two a female is. Built from the records rather than a flag, so
  // a calving entered or corrected moves her without anything else to remember.
  const calved = useMemo(() => damsThatHaveCalved(calvings, breedings), [calvings, breedings]);

  // When each cow inside her calving window is due — the earliest, should a
  // record ever leave her with two. Built from `awaitingCalving` so a cow that
  // has calved drops off the list instead of being "due" with a calf at side.
  const dueByAnimal = useMemo(() => {
    const map = new Map<Ulid, Date>();
    for (const record of awaitingCalving(breedings, calvings, asOf)) {
      const due = projectedDueDate(record);
      const was = map.get(record.damId);
      if (was === undefined || due < was) map.set(record.damId, due);
    }
    return map;
  }, [breedings, calvings, asOf]);
  const classOf = (animal: Animal) =>
    cattleClass(animal, asOf, { hasCalved: calved.has(animal.id) });

  /*
   * Indexed once, not scanned per row.
   *
   * Both of these are read by the list for every animal it draws, and both
   * used to be a `find` over a whole table to answer for one of them — so the
   * herd list cost animals × profiles and animals × assignments, on every
   * render, including every keystroke in the search box. Assignments is the
   * table that grows fastest here, because it holds every move ever made
   * rather than where things are now, so the scan somebody would notice first
   * is the one that gets slower every time an animal is moved.
   *
   * Each map keeps the *first* match, which is what `find` returned: an animal
   * is in an outside pen and an inside pen at once (§5.1), and the row has
   * always shown whichever assignment was written first.
   */
  const profileByAnimal = useMemo(() => {
    const map = new Map<Ulid, CattleProfile>();
    for (const profile of profiles)
      if (!map.has(profile.animalId)) map.set(profile.animalId, profile);
    return map;
  }, [profiles]);

  const openZoneByAnimal = useMemo(() => {
    const byId = new Map(zones.map((zone) => [zone.id, zone]));
    const map = new Map<Ulid, Zone | undefined>();
    for (const assignment of assignments) {
      if (assignment.periodTo !== undefined) continue;
      if (map.has(assignment.animalId)) continue;
      map.set(assignment.animalId, byId.get(assignment.zoneId));
    }
    return map;
  }, [assignments, zones]);

  const profileOf = (animalId: Ulid) => profileByAnimal.get(animalId);

  const currentZone = (animalId: Ulid) => openZoneByAnimal.get(animalId);

  /**
   * Cattle on the place with no pen recorded.
   *
   * Records written before the form asked for one, mostly. Shown rather than
   * fixed silently: which pen an animal is in is a fact about the world that
   * only somebody who has looked knows.
   */
  const unplaced = useMemo(
    () => new Set(animalsWithoutOutside(herd, assignments, indoorZoneIds)),
    [herd, assignments, indoorZoneIds],
  );

  const animals = cattle.filter((animal) => {
    if (
      filters.zoneId !== "" &&
      !(openZonesByAnimal.get(animal.id)?.has(filters.zoneId as Ulid) ?? false)
    ) {
      return false;
    }
    if (filters.status !== "" && animal.status !== filters.status) return false;
    if (
      filters.breed !== "" &&
      !breedsOf(profileOf(animal.id) ?? {}).some(
        (breed) => breed.toLowerCase() === filters.breed.toLowerCase(),
      )
    ) {
      return false;
    }
    if (filters.sex !== "" && animal.sex !== filters.sex) return false;
    if (filters.cattleClass !== "" && classOf(animal) !== filters.cattleClass) return false;
    if (filters.safetyLevel !== "" && String(animal.safetyLevel) !== filters.safetyLevel) {
      return false;
    }
    if (filters.withdrawnOnly && !withheld.has(animal.id)) return false;
    if (filters.unplacedOnly && !unplaced.has(animal.id)) return false;
    return true;
  });

  // Counted over the whole herd, not the filtered list: these are what the
  // filter is chosen *from*, and counts that shrank as they were used would
  // leave nothing to go back to.
  const counts = useMemo(() => classCounts(herd, asOf, calved), [herd, asOf, calved]);
  const unsexed = useMemo(() => unclassified(herd, asOf), [herd, asOf]);
  /** Head on the place — the number the Pen Board and the rosters count. */
  const head = herd.filter(isOnFarm).length;

  /** What is on, in the words the controls use — shown even when folded. */
  const activeFilters = [
    filters.zoneId === ""
      ? undefined
      : `Pen: ${zones.find((zone) => zone.id === filters.zoneId)?.name ?? "a pen"}`,
    filters.status === "" ? undefined : `Status: ${filters.status}`,
    filters.sex === "" ? undefined : `Sex: ${filters.sex}`,
    filters.cattleClass === ""
      ? undefined
      : CATTLE_CLASS_LABELS[filters.cattleClass as keyof typeof CATTLE_CLASS_LABELS],
    filters.breed === "" ? undefined : `Breed: ${filters.breed}`,
    filters.safetyLevel === "" ? undefined : `Level ${filters.safetyLevel}`,
    filters.withdrawnOnly ? "Under withdrawal" : undefined,
    filters.unplacedOnly ? "No pen recorded" : undefined,
  ].filter((entry): entry is string => entry !== undefined);

  /** How many of those live behind the Filters button rather than the chips. */
  const panelFilters = activeFilters.length - (filters.cattleClass === "" ? 0 : 1);

  const mutations = useMutations<Animal>("animals", "animals", animalSchema, propertyId, actorId);
  const placements = useMutations<ZoneAssignment>(
    "zoneAssignments",
    "zoneAssignments",
    zoneAssignmentSchema,
    propertyId,
    actorId,
  );

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<Animal | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  /** Pens and pastures — everywhere an animal can live outdoors. */
  const outsideZoneOptions = zones
    .filter((zone) => zone.active && !zone.indoor && zone.type !== "working_facility")
    .map((zone) => ({
      value: zone.id,
      label: zone.type === "off_site" ? `${zone.name} (off site)` : zone.name,
    }));

  /** Barns and stalls. Never the only place an animal is. */
  const insideZoneOptions = zones
    .filter((zone) => zone.active && zone.indoor)
    .map((zone) => ({ value: zone.id, label: zone.name }));

  const zoneOptions = zones
    .filter((zone) => zone.active)
    .map((zone) => ({ value: zone.id, label: zone.name }));

  function startCreate() {
    setEditing(undefined);
    setDraft(BLANK);
    setErrors({});
  }

  // `?add=1` lands on the add form — the Animals list's "+ Add animal" comes
  // here rather than keeping a second add form. Read once, off `window`
  // rather than `useSearchParams`, so the page needs no Suspense boundary;
  // the flag is then dropped from the address so a reload does not reopen it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("add") !== "1") return;
    startCreate();
    params.delete("add");
    const rest = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${rest === "" ? "" : `?${rest}`}`,
    );
    // Mount only: this is a way in, not a state to keep in step with.
  }, []);

  function startEdit(animal: Animal) {
    setEditing(animal);
    setDraft({
      name: animal.name ?? "",
      tagNumber: animal.tagNumber ?? "",
      sex: animal.sex,
      // The input wants yyyy-mm-dd; slicing the ISO string is exact for a date
      // that was stored at UTC midnight, which is how a date-only field lands.
      dob: animal.dob === undefined ? "" : animal.dob.toISOString().slice(0, 10),
      dobIsEstimate: animal.dobIsEstimate,
      status: animal.status,
      safetyLevel: animal.safetyLevel,
      safetyNotes: animal.safetyNotes ?? "",
      notes: animal.notes ?? "",
      // Where she is now, so opening the form does not read as "nowhere".
      outsideZoneId:
        assignmentInSlot(assignments, animal.id, "outside", indoorZoneIds)?.zoneId ?? "",
      insideZoneId: assignmentInSlot(assignments, animal.id, "inside", indoorZoneIds)?.zoneId ?? "",
    });
    setErrors({});
  }

  async function save() {
    if (draft === undefined) return;

    // Checked before anything is written. The rule is about the assignment
    // rather than a column on the animal, so no schema can state it — which
    // is exactly why it has to be said here rather than left to the save.
    if (draft.outsideZoneId === "") {
      setErrors({ outsideZoneId: "Every animal on the place stands somewhere outdoors" });
      return;
    }

    const fields = {
      species: "cattle" as const,
      sex: draft.sex,
      dobIsEstimate: draft.dobIsEstimate,
      status: draft.status,
      ownership: "own" as const,
      safetyLevel: draft.safetyLevel,
      photoKeys: editing?.photoKeys ?? [],
      ...(draft.name.trim() === "" ? {} : { name: draft.name.trim() }),
      ...(draft.tagNumber.trim() === "" ? {} : { tagNumber: draft.tagNumber.trim() }),
      ...(draft.dob === "" ? {} : { dob: new Date(`${draft.dob}T00:00:00Z`) }),
      ...(draft.safetyNotes.trim() === "" ? {} : { safetyNotes: draft.safetyNotes.trim() }),
      ...(draft.notes.trim() === "" ? {} : { notes: draft.notes.trim() }),
    };

    const result =
      editing === undefined
        ? await mutations.create(fields)
        : await mutations.update(editing.id, fields);

    if (!result.ok) {
      setErrors(
        result.error.kind === "validation"
          ? Object.fromEntries(
              result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
            )
          : { name: "Could not save. Check the fields and try again." },
      );
      return;
    }

    // The placement, after the animal exists. Both slots go through the same
    // move as every other, so an edit that changes a pen closes the old
    // assignment rather than overwriting it and losing where she was.
    const animalId = editing?.id ?? (result.value as Animal).id;
    await placeIn(animalId, draft.outsideZoneId as Ulid);
    if (draft.insideZoneId !== "") await placeIn(animalId, draft.insideZoneId as Ulid);

    show({ message: editing === undefined ? "Animal added" : "Animal saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
  }

  /**
   * Put an animal in a zone, quietly.
   *
   * The same `moveToZone` every move on the place goes through — which is
   * what makes it a no-op when she is already there, rather than a second
   * identical row, and what repairs a slot that somehow holds two.
   */
  async function placeIn(animalId: Ulid, zoneId: Ulid) {
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (zone === undefined) return;

    const at = new Date();
    const { closed, opened } = moveToZone(
      assignments,
      {
        id: encodeUlid(at.getTime()) as Ulid,
        propertyId,
        createdAt: at,
        updatedAt: at,
        animalId,
        zoneId,
        indoor: zone.indoor,
        at,
      },
      indoorZoneIds,
    );

    for (const entry of closed) {
      await placements.update(entry.id, { periodTo: entry.periodTo });
    }
    if (opened !== undefined) await placements.create(opened);
  }

  async function remove(animal: Animal) {
    const open = assignments.filter((a) => a.animalId === animal.id && a.periodTo === undefined);

    const confirmed = await confirmDelete({
      // An animal is an aggregate root: everything about it — weights,
      // treatments, breedings — hangs off this record (§4.5 clause 3).
      tier: "typed",
      recordName: animal.name ?? animal.tagNumber ?? "this animal",
      entity: "animal",
      dependents: open.map((assignment) => ({
        entity: "Zone assignment",
        label: zones.find((zone) => zone.id === assignment.zoneId)?.name ?? "a zone",
        effect: "deleted" as const,
      })),
      consequence:
        "Everything recorded about this animal goes to Trash with it, and can be restored.",
    });

    if (!confirmed) return;

    const result = await mutations.remove(animal.id);
    if (!result.ok) {
      show({ message: "Could not delete that animal", tone: "danger" });
      return;
    }

    show({
      message: `${animal.name ?? "Animal"} deleted`,
      action: { label: "Undo", onAct: () => void mutations.restoreRecord(animal.id) },
    });
  }

  const [filtersOpen, setFiltersOpen] = useState(false);

  /** The one line under a name: what she is, how old, where. */
  function lineFor(animal: Animal): string {
    const name = classOf(animal);
    return [
      name === undefined ? animal.sex : CATTLE_CLASS_SINGULAR[name],
      ageLabel(animal, asOf),
      currentZone(animal.id)?.name,
    ]
      .filter((part) => part !== undefined && part !== "")
      .join(" · ");
  }

  /** Chips for the class row: the whole herd, then each class with its count. */
  const chips = [
    { key: "", label: "All", count: undefined as number | undefined },
    ...counts.map((entry) => ({ key: entry.cattleClass, label: entry.label, count: entry.count })),
  ];

  if (loading) return <p className="text-muted">Loading the herd…</p>;

  return (
    // Bottom clearance on a phone, so the floating add button and the tab bar
    // under it never sit on top of the last row.
    <div className="flex flex-col gap-density pb-20 sm:pb-0">
      <header className="flex items-center justify-between gap-density">
        {/* The count is a fact, said beside the title rather than under it. */}
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="text-ink">Cattle</h1>
          <span className="text-sm text-muted">{head} head</span>
        </div>
        {/* Hidden on a phone by a wrapper, not a class on the button: the
            button's own `inline-flex` wins over a `hidden` passed in. */}
        <span className="hidden sm:block">
          <Button variant="primary" onClick={startCreate}>
            <span aria-hidden="true">+</span> Add animal
          </Button>
        </span>
      </header>

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextInput
            label="Search"
            hideLabel
            placeholder="Name, tag, or notes"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
          Filters{panelFilters === 0 ? "" : ` (${panelFilters})`}
        </Button>
      </div>

      {/*
        The classes, as one row of toggles that are also the counts. This is
        the split somebody asks for out loud — "how many steers have we got" —
        and making the answer the control means it takes one press rather than
        opening a panel and finding the right select. A single row that scrolls
        sideways on a phone, because a row that wraps pushes the herd down.
      */}
      <div
        role="group"
        aria-label="Filter by class"
        className="-mx-1 flex items-center gap-1 overflow-x-auto px-1"
      >
        {chips.map((chip) => {
          const on = filters.cattleClass === chip.key;
          return (
            <button
              key={chip.key === "" ? "all" : chip.key}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setFilters({
                  ...filters,
                  // Pressing the one already on goes back to the whole herd,
                  // so the row is a way out of a part as well as a way in.
                  cattleClass: on ? "" : chip.key,
                })
              }
              className={[
                "inline-flex min-h-target shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action",
                on
                  ? "bg-action/15 font-semibold text-action"
                  : "font-medium text-muted hover:bg-raised hover:text-ink",
              ].join(" ")}
            >
              {chip.label}
              {chip.count === undefined ? null : (
                <span className="gf-numeric text-xs opacity-80">{chip.count}</span>
              )}
            </button>
          );
        })}
        {unsexed === 0 ? null : (
          <span className="shrink-0 whitespace-nowrap px-2 text-xs text-muted">
            {unsexed} with no sex recorded
          </span>
        )}
      </div>

      {/*
        The one alert this screen keeps, as one line. An animal with no pen is
        missing from the Pen Board and from every headcount a pen is asked for,
        so it is worth saying — but saying it once, and making the line the way
        to the animals concerned, rather than a box of buttons above the herd.
      */}
      {unplaced.size === 0 || filters.unplacedOnly ? null : (
        <p className="text-sm text-danger">
          {unplaced.size} with no pen or pasture recorded.{" "}
          <button
            type="button"
            onClick={() => setFilters({ ...filters, unplacedOnly: true })}
            className="inline-flex min-h-target items-center font-semibold underline underline-offset-2"
          >
            Show them
          </button>
        </p>
      )}

      {/*
        What is on, whenever anything is — the part of the old filter panel
        that must never fold away. A narrowed list that does not say so is a
        screen that lies: somebody looks for a cow, does not find her, and
        concludes she is not on the place.
      */}
      {activeFilters.length === 0 ? null : (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted" aria-live="polite">
          <span>
            Showing {animals.length} of {herd.length}
          </span>
          <span aria-hidden="true">·</span>
          <span>{activeFilters.join(" · ")}</span>
          <button
            type="button"
            onClick={() => setFilters(NO_FILTERS)}
            className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
          >
            Clear
          </button>
        </p>
      )}

      {animals.length === 0 ? (
        <EmptyState
          title={
            herd.length === 0
              ? "No cattle yet"
              : search !== ""
                ? `Nothing matches "${search}"`
                : "None match these filters"
          }
          detail={
            herd.length === 0
              ? "Add the herd here. Breeding, health, and feed all hang off these records."
              : search !== ""
                ? "Search looks at name, tag number, and notes."
                : undefined
          }
          {...(herd.length === 0
            ? {
                action: (
                  <Button variant="primary" onClick={startCreate}>
                    Add the first animal
                  </Button>
                ),
              }
            : activeFilters.length > 0
              ? {
                  action: <Button onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>,
                }
              : {})}
        />
      ) : (
        <ul
          aria-label="Cattle on this property"
          className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
        >
          {animals.map((animal) => (
            <HerdRow
              key={animal.id}
              animal={animal}
              href={animalHref(animal)}
              title={animalTitle(animal)}
              line={lineFor(animal)}
              flag={flagFor({
                animal,
                withdrawn: withheld.has(animal.id),
                unplaced: unplaced.has(animal.id),
                due: dueByAnimal.get(animal.id),
                now: asOf,
              })}
              onEdit={() => startEdit(animal)}
            />
          ))}
        </ul>
      )}

      {/*
        On a phone the add button floats bottom-right, where a thumb already
        is, and clear of the tab bar below it. On anything wider it sits in the
        header and this one is not drawn.
      */}
      {/* A plain button rather than `Button`: its shape and shadow are its own,
          and overriding a primitive's radius from outside is a fight over
          class order that the stylesheet decides, not this file. */}
      <button
        type="button"
        onClick={startCreate}
        className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:hidden"
      >
        <span aria-hidden="true" className="text-xl leading-none">
          +
        </span>
        Add animal
      </button>

      {filtersOpen ? (
        <Modal
          title="Filters"
          placement="side"
          onClose={() => setFiltersOpen(false)}
          footer={
            <>
              <Button variant="primary" onClick={() => setFiltersOpen(false)}>
                Show {animals.length}
              </Button>
              {activeFilters.length === 0 ? null : (
                <Button variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
                  Clear filters
                </Button>
              )}
            </>
          }
        >
          {/*
            The rest of what #15 asks for, in the order it gets reached for.
            They stack rather than replace each other: "bulls in the north pen
            still under withdrawal" is one question, not three. Class is not
            here because the chips above are the class filter.
          */}
          <Select
            label="Pen"
            value={filters.zoneId}
            placeholder="Any pen"
            options={zoneOptions}
            onChange={(event) => setFilters({ ...filters, zoneId: event.target.value })}
          />
          <Select
            label="Status"
            value={filters.status}
            placeholder="Any status"
            options={STATUS_OPTIONS}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          />
          <Select
            label="Sex"
            value={filters.sex}
            placeholder="Any sex"
            options={SEX_OPTIONS}
            onChange={(event) => setFilters({ ...filters, sex: event.target.value })}
          />
          <Select
            label="Breed"
            hint="Typed on the animal, or worked out from its makeup."
            value={filters.breed}
            placeholder="Any breed"
            options={breedsInUse(profiles).map((value) => ({ value, label: value }))}
            onChange={(event) => setFilters({ ...filters, breed: event.target.value })}
          />
          <Select
            label="Handling level"
            value={filters.safetyLevel}
            placeholder="Any level"
            options={SAFETY_OPTIONS}
            onChange={(event) => setFilters({ ...filters, safetyLevel: event.target.value })}
          />
          <Checkbox
            label="Under withdrawal"
            hint="Cannot go to a sale or a packer today."
            checked={filters.withdrawnOnly}
            onChange={(event) => setFilters({ ...filters, withdrawnOnly: event.target.checked })}
          />
          <Checkbox
            label="No pen recorded"
            checked={filters.unplacedOnly}
            onChange={(event) => setFilters({ ...filters, unplacedOnly: event.target.checked })}
          />
        </Modal>
      ) : null}

      {draft !== undefined ? (
        <Modal
          key={editing?.id ?? "new"}
          placement="side"
          title={editing === undefined ? "Add an animal" : `Editing ${animalTitle(editing)}`}
          description="Tag or name is enough to start. Everything else can be filled in later."
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add animal" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined ? null : (
                // Delete lives here now that the row has no room for it. The
                // editor closes first, so the typed confirmation is the only
                // dialog on screen rather than a second one stacked on this.
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const animal = editing;
                    setDraft(undefined);
                    setEditing(undefined);
                    void remove(animal);
                  }}
                >
                  Delete
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-density sm:grid sm:grid-cols-2">
            {/* The tag first: it is what is written on the animal, and the
                thing somebody standing at the chute is reading off her ear. */}
            <TextInput
              label="Tag number"
              numeric
              value={draft.tagNumber}
              error={errors["tagNumber"]}
              onChange={(event) => setDraft({ ...draft, tagNumber: event.target.value })}
            />
            <TextInput
              label="Name"
              value={draft.name}
              error={errors["name"]}
              hint="What you call it. A tag number is enough on its own."
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <Select
              label="Sex"
              options={SEX_OPTIONS}
              value={draft.sex}
              onChange={(event) => setDraft({ ...draft, sex: event.target.value as Sex })}
            />
            <Select
              label="Status"
              options={STATUS_OPTIONS}
              value={draft.status}
              onChange={(event) =>
                setDraft({ ...draft, status: event.target.value as AnimalStatus })
              }
            />
            <Select
              label="Pen or pasture"
              hint="Everything on the place stands somewhere outdoors. Use Off site while an animal is away."
              required
              value={draft.outsideZoneId}
              placeholder="Pick one"
              options={outsideZoneOptions}
              error={errors["outsideZoneId"]}
              onChange={(event) => setDraft({ ...draft, outsideZoneId: event.target.value })}
            />
            <Select
              label="Barn or stall"
              hint="Only if it is inside tonight. It keeps its pen either way."
              value={draft.insideZoneId}
              placeholder="Not inside"
              options={insideZoneOptions}
              onChange={(event) => setDraft({ ...draft, insideZoneId: event.target.value })}
            />
            <TextInput
              label="Date of birth"
              type="date"
              value={draft.dob}
              error={errors["dob"]}
              onChange={(event) => setDraft({ ...draft, dob: event.target.value })}
            />
            <Checkbox
              label="Date of birth is an estimate"
              hint="Every age-based rule reads this — a guessed date must not look exact."
              checked={draft.dobIsEstimate}
              onChange={(event) => setDraft({ ...draft, dobIsEstimate: event.target.checked })}
            />
            <Select
              label="Handling level"
              options={SAFETY_OPTIONS}
              value={String(draft.safetyLevel)}
              onChange={(event) =>
                setDraft({ ...draft, safetyLevel: Number(event.target.value) as SafetyLevel })
              }
            />
            <TextInput
              label="Why"
              value={draft.safetyNotes}
              hint='"Kicks when cornered." The level alone tells a housesitter nothing.'
              onChange={(event) => setDraft({ ...draft, safetyNotes: event.target.value })}
            />
            <TextArea
              label="Notes"
              rows={3}
              className="sm:col-span-2"
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
