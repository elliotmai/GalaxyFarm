"use client";

import { useState } from "react";

import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
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
  encodeUlid,
  move,
  zoneAssignmentSchema,
  type Animal,
  type AnimalStatus,
  type SafetyLevel,
  type Sex,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";
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
const STATUS_OPTIONS = ANIMAL_STATUSES.map((status) => ({ value: status, label: status }));
const SAFETY_OPTIONS = Object.values(SAFETY_LEVEL_DEFAULTS).map((level) => ({
  value: String(level.level),
  label: `${level.level} — ${level.label}`,
}));

interface Draft {
  readonly name: string;
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
  const { records: all, loading } = useRecords<Animal>("animals", { propertyId, search });
  const { records: zones } = useRecords<Zone>("zones", { propertyId });
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", { propertyId });

  const animals = all.filter((animal) => animal.species === "cattle");

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

  const zoneOptions = zones
    .filter((zone) => zone.active)
    .map((zone) => ({ value: zone.id, label: zone.name }));

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
    });
    setErrors({});
  }

  async function save() {
    if (draft === undefined) return;

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

    show({ message: editing === undefined ? "Animal added" : "Animal saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
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
    const open = assignments.find((a) => a.animalId === animal.id && a.periodTo === undefined);
    const at = new Date();

    const { closed, opened } = move(open, {
      id: encodeUlid(at.getTime()),
      propertyId,
      createdAt: at,
      updatedAt: at,
      animalId: animal.id,
      zoneId,
      slot: "primary",
      at,
    });

    if (closed !== undefined) {
      await placements.update(closed.id, { periodTo: closed.periodTo });
    }
    const result = await placements.create(opened);

    if (!result.ok) {
      show({ message: "Could not move that animal", tone: "danger" });
      return;
    }

    const zone = zones.find((candidate) => candidate.id === zoneId);
    show({ message: `${animal.name ?? "Animal"} moved to ${zone?.name ?? "a new zone"}` });
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
      consequence: "Everything recorded about her goes to Trash with her, and can be restored.",
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
      render: (animal) => animal.name ?? <span className="text-muted">Unnamed</span>,
    },
    {
      key: "tag",
      header: "Tag",
      numeric: true,
      render: (animal) => animal.tagNumber ?? "—",
    },
    { key: "sex", header: "Sex", render: (animal) => animal.sex },
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
          className="[&>label]:sr-only"
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
      render: (animal) => <SafetyBadge level={animal.safetyLevel} size="compact" />,
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
        <h1 className="font-heading text-2xl font-semibold text-ink">Herd</h1>
        <div className="flex items-center gap-2">
          <TextInput
            label="Search"
            className="[&>label]:sr-only"
            placeholder="Name, tag, or notes"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button variant="primary" onClick={startCreate}>
            Add an animal
          </Button>
        </div>
      </header>

      {draft !== undefined ? (
        <Card title={editing === undefined ? "New animal" : `Editing ${editing.name ?? "animal"}`}>
          <div className="flex flex-col gap-density md:grid md:grid-cols-2">
            <TextInput
              label="Name"
              value={draft.name}
              error={errors["name"]}
              hint="What you call her. A tag number is enough if she has no name."
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
        </Card>
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
