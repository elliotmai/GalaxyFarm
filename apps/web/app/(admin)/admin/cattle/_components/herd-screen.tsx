"use client";

import Link from "next/link";

import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  FilterPanel,
  Modal,
  SafetyBadge,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import {
  ANIMAL_STATUSES,
  SAFETY_LEVEL_DEFAULTS,
  SEXES,
  animalSchema,
  animalsWithoutOutside,
  assignmentInSlot,
  encodeUlid,
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
  breedsInUse,
  breedsOf,
  CATTLE_CLASS_LABELS,
  CATTLE_CLASS_SINGULAR,
  CATTLE_CLASSES,
  cattleClass,
  classCounts,
  damsThatHaveCalved,
  unclassified,
  type BreedingRecord,
  type CalvingRecord,
  type CattleProfile,
  type HealthRecord,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";
import { animalHref, animalTitle } from "@/lib/animal-slug";
import { useRecords } from "@/lib/local/use-records";

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
 */

const SEX_OPTIONS = SEXES.map((sex) => ({ value: sex, label: sex }));
const CLASS_OPTIONS = CATTLE_CLASSES.map((name) => ({
  value: name,
  label: CATTLE_CLASS_LABELS[name],
}));
const STATUS_OPTIONS = ANIMAL_STATUSES.map((status) => ({ value: status, label: status }));
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
}

const NO_FILTERS: Filters = {
  zoneId: "",
  status: "",
  sex: "",
  cattleClass: "",
  breed: "",
  safetyLevel: "",
  withdrawnOnly: false,
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
  const classOf = (animal: Animal) =>
    cattleClass(animal, asOf, { hasCalved: calved.has(animal.id) });

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
    return true;
  });

  const filtered = animals.length !== cattle.length;

  // Counted over the whole herd, not the filtered list: these are what the
  // filter is chosen *from*, and counts that shrank as they were used would
  // leave nothing to go back to.
  const counts = useMemo(() => classCounts(cattle, asOf, calved), [cattle, asOf, calved]);
  const unsexed = useMemo(() => unclassified(cattle, asOf), [cattle, asOf]);

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
  ].filter((entry): entry is string => entry !== undefined);

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

  /**
   * Cattle on the place with no pen recorded.
   *
   * Records written before the form asked for one, mostly. Named rather than
   * counted, and shown rather than fixed silently: which pen an animal is in
   * is a fact about the world that only somebody who has looked knows.
   */
  const unplaced = useMemo(
    () => new Set(animalsWithoutOutside(cattle, assignments, indoorZoneIds)),
    [cattle, assignments, indoorZoneIds],
  );

  const zoneOptions = zones
    .filter((zone) => zone.active)
    .map((zone) => ({ value: zone.id, label: zone.name }));

  const profileOf = (animalId: Ulid) => profiles.find((profile) => profile.animalId === animalId);

  const currentZone = (animalId: Ulid) => {
    const open = assignments.find((a) => a.animalId === animalId && a.periodTo === undefined);
    return open === undefined ? undefined : zones.find((zone) => zone.id === open.zoneId);
  };

  function startCreate() {
    setEditing(undefined);
    setDraft(BLANK);
    setErrors({});
  }

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
   * The same `moveToZone` the Move button uses — which is what makes it a
   * no-op when she is already there, rather than a second identical row.
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

  /**
   * Move an animal to another zone.
   *
   * Closes the open assignment and opens a new one rather than editing the
   * existing row. That is what makes "where was she in March" answerable, and
   * it is also why the two writes are separate patches — a device that syncs
   * the close but not the open must not end up with the animal nowhere.
   */
  async function moveTo(animal: Animal, zoneId: Ulid) {
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (zone === undefined) return;

    const at = new Date();

    // The slot is the zone's, not a question. Moving a cow into the barn
    // leaves her pasture assignment alone; moving her to another trap closes
    // the first one. `closed` is a list because more than one open assignment
    // in a slot means the rule was already broken, and this is where it gets
    // repaired rather than left for somebody to notice on the pen board.
    const { closed, opened } = moveToZone(
      assignments,
      {
        id: encodeUlid(at.getTime()) as Ulid,
        propertyId,
        createdAt: at,
        updatedAt: at,
        animalId: animal.id,
        zoneId,
        indoor: zone.indoor,
        at,
      },
      indoorZoneIds,
    );

    // Closes first, including any duplicate rows for a zone she is already in
    // — that is the repair, and it runs whether or not there is a move to make.
    for (const entry of closed) {
      await placements.update(entry.id, { periodTo: entry.periodTo });
    }

    if (opened === undefined) {
      // Already there. Saying so is the honest answer to the button that was
      // pressed; writing a second identical assignment was the old one.
      show({
        message: `${animal.name ?? "Animal"} is already in ${zone.name}`,
        tone: "info",
      });
      return;
    }

    const result = await placements.create(opened);

    if (!result.ok) {
      show({ message: "Could not move that animal", tone: "danger" });
      return;
    }

    show({
      message: `${animal.name ?? "Animal"} moved to ${zone.name}`,
      tone: "success",
    });
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

  const columns: readonly Column<Animal>[] = [
    {
      key: "name",
      header: "Name",
      // The name is the link. A row that needs a separate "open" button puts
      // the smallest target on the screen in front of the most common action.
      render: (animal) => (
        <Link
          href={animalHref(animal)}
          className="font-medium text-ink underline decoration-edge underline-offset-4 hover:decoration-action"
        >
          {animalTitle(animal)}
        </Link>
      ),
    },
    {
      key: "tag",
      header: "Tag",
      numeric: true,
      render: (animal) => animal.tagNumber ?? "—",
    },
    { key: "sex", header: "Sex", render: (animal) => animal.sex },
    {
      key: "class",
      header: "Class",
      // The same fact the class row and the filter select on, on the row
      // itself — so nobody has to work out why a cow is in the calf list.
      render: (animal) => {
        const name = classOf(animal);
        return name === undefined ? "—" : CATTLE_CLASS_SINGULAR[name];
      },
    },
    {
      key: "breed",
      header: "Breed",
      render: (animal) => {
        const breeds = breedsOf(profileOf(animal.id) ?? {});
        return breeds.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {breeds.map((breed) => (
              <Badge key={breed} tone="neutral">
                {breed}
              </Badge>
            ))}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (animal) => (
        <Badge tone={animal.status === "active" ? "calm" : "neutral"}>{animal.status}</Badge>
      ),
    },
    {
      key: "zone",
      header: "Where",
      render: (animal) => (
        <Select
          label={`Zone for ${animal.name ?? "animal"}`}
          hideLabel
          options={zoneOptions}
          placeholder="Nowhere"
          value={currentZone(animal.id)?.id ?? ""}
          onChange={(event) => void moveTo(animal, event.target.value as Ulid)}
        />
      ),
    },
    {
      key: "safety",
      header: "Care",
      render: (animal) => (
        <span className="flex flex-wrap items-center gap-2">
          <SafetyBadge level={animal.safetyLevel} size="compact" />
          {/* The same fact the filter selects on, visible without selecting. */}
          {withheld.has(animal.id) ? <Badge tone="danger">Withdrawal</Badge> : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (animal) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => startEdit(animal)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(animal)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  if (loading) return <p className="text-muted">Loading the herd…</p>;

  return (
    <div className="flex flex-col gap-density">
      <header className="flex flex-wrap items-center justify-between gap-density">
        <h1 className="text-ink">Herd</h1>
        <div className="flex items-center gap-2">
          <TextInput
            label="Search"
            hideLabel
            placeholder="Name, tag, or notes"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button variant="primary" onClick={startCreate}>
            Add an animal
          </Button>
        </div>
      </header>

      {/*
        The filters #15 asks for, in the order they get reached for. They stack
        rather than replace each other: "bulls in the north pen still under
        withdrawal" is one question, not three.
      */}
      {/*
        The four classes, as a row of counts that are also the filter. This is
        the split somebody asks for out loud — "how many steers have we got" —
        and making the answer the control means it takes one press rather than
        opening a panel and finding the right select.

        Counted over the whole herd rather than the filtered list, so the
        numbers do not shrink as they are used.
      */}
      {unplaced.size === 0 ? null : (
        <Callout tone="danger" title={`${unplaced.size} with no pen or pasture recorded`}>
          Everything on the place stands somewhere outdoors, and these do not say where. They are
          missing from the Pen Board and from every headcount a pen is asked for. Open each one and
          set its pen — or use <strong>Off site</strong> if it is away.
          <span className="mt-2 flex flex-wrap gap-2">
            {cattle
              .filter((animal) => unplaced.has(animal.id))
              .map((animal) => (
                <Button key={animal.id} variant="secondary" onClick={() => startEdit(animal)}>
                  {animalTitle(animal)}
                </Button>
              ))}
          </span>
        </Callout>
      )}

      <Card title="The herd, by class">
        <div className="flex flex-wrap gap-2">
          {counts.map((entry) => {
            const on = filters.cattleClass === entry.cattleClass;
            return (
              <Button
                key={entry.cattleClass}
                variant={on ? "primary" : "secondary"}
                aria-pressed={on}
                onClick={() =>
                  setFilters({
                    ...filters,
                    // Pressing the one already on clears it, so the row is a
                    // way back to the whole herd as well as a way into a part.
                    cattleClass: on ? "" : entry.cattleClass,
                  })
                }
              >
                {entry.label} {entry.count}
              </Button>
            );
          })}
          {unsexed === 0 ? null : (
            <span className="self-center text-sm text-muted">
              {unsexed} with no sex recorded, in none of these.
            </span>
          )}
        </div>
      </Card>

      <FilterPanel
        title="Narrow the herd"
        active={activeFilters.length}
        summary={activeFilters.join(" · ")}
        count={
          filtered ? (
            <>
              Showing {animals.length} of {cattle.length}.
            </>
          ) : undefined
        }
        onClear={() => setFilters(NO_FILTERS)}
      >
        <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-6">
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
            label="Class"
            hint="Calves are under a year. A steer is a steer whatever his age."
            value={filters.cattleClass}
            placeholder="Any class"
            options={CLASS_OPTIONS}
            onChange={(event) => setFilters({ ...filters, cattleClass: event.target.value })}
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
        </div>
      </FilterPanel>

      {draft !== undefined ? (
        <Modal
          key={editing?.id ?? "new"}
          size="wide"
          title={editing === undefined ? "New animal" : `Editing ${editing.name ?? "animal"}`}
          description="Name or tag is enough to start. Everything else can be filled in later."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density md:grid md:grid-cols-2">
            <TextInput
              label="Name"
              value={draft.name}
              error={errors["name"]}
              hint="What you call it. A tag number is enough on its own."
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <TextInput
              label="Tag number"
              numeric
              value={draft.tagNumber}
              error={errors["tagNumber"]}
              onChange={(event) => setDraft({ ...draft, tagNumber: event.target.value })}
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
              className="md:col-span-2"
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </div>

          <div className="mt-density flex gap-2">
            <Button variant="primary" onClick={() => void save()}>
              {editing === undefined ? "Add animal" : "Save changes"}
            </Button>
            <Button onClick={() => setDraft(undefined)}>Cancel</Button>
          </div>
        </Modal>
      ) : null}

      <Card>
        <DataTable
          caption="Cattle on this property"
          columns={columns}
          rows={animals}
          rowKey={(animal) => animal.id}
          empty={
            <EmptyState
              title={search === "" ? "No cattle yet" : `Nothing matches "${search}"`}
              detail={
                search === ""
                  ? "Add the herd here. Breeding, health, and feed all hang off these records."
                  : "Search looks at name, tag number, and notes."
              }
              {...(search === ""
                ? {
                    action: (
                      <Button variant="primary" onClick={startCreate}>
                        Add the first animal
                      </Button>
                    ),
                  }
                : {})}
            />
          }
        />
      </Card>
    </div>
  );
}
