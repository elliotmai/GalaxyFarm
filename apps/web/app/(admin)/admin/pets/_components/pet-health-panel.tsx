"use client";

import { useState } from "react";

import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Modal,
  Pill,
  Section,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import {
  displayName,
  formatMoney,
  fromDollars,
  type Animal,
  type Contact,
  type CrudError,
  type Ulid,
} from "@galaxy-farm/core";
import {
  HEALTH_RECORD_TYPES,
  healthRecordSchema,
  type HealthRecord,
  type HealthRecordType,
} from "@galaxy-farm/module-cattle";
import { outstandingPetCare } from "@galaxy-farm/module-pets";

import { careRecordsFor } from "@/lib/pet-care";
import { useMutations } from "@/lib/local/mutations";

/**
 * Vet and medicine (spec §5.8).
 *
 * The same `HealthRecord` the herd uses — §5.8 asks for exactly that, and a
 * second table for pets would mean a second withdrawal rule, a second booster
 * derivation, and two places to fix whichever one was wrong.
 *
 * **The next-due date is the vet's answer, not ours.** Nothing here knows how
 * often a rabies shot is wanted; whoever gives it writes down when the next one
 * is, and the reminder derives from that. An app that computed "due" on its own
 * authority would be inventing a protocol for somebody else's animal.
 */

const TYPE_LABELS: Readonly<Record<HealthRecordType, string>> = {
  vaccination: "Vaccination",
  treatment: "Treatment",
  exam: "Check-up",
  injury: "Injury",
  deworming: "Worming",
};

interface Draft {
  readonly animalId: string;
  readonly type: HealthRecordType;
  readonly date: string;
  readonly product: string;
  readonly vetContactId: string;
  readonly administeredBy: string;
  readonly cost: string;
  readonly boosterDueOn: string;
  readonly notes: string;
}

function blank(animalId: string): Draft {
  return {
    animalId,
    type: "vaccination",
    date: new Date().toISOString().slice(0, 10),
    product: "",
    vetContactId: "",
    administeredBy: "",
    cost: "",
    boosterDueOn: "",
    notes: "",
  };
}

const formatDate = (value: Date | undefined): string =>
  value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function PetHealthPanel({
  pets,
  records,
  contacts,
  loading,
  propertyId,
  actorId,
}: {
  readonly pets: readonly Animal[];
  readonly records: readonly HealthRecord[];
  readonly contacts: readonly Contact[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const mutations = useMutations<HealthRecord>(
    "healthRecords",
    "healthRecords",
    healthRecordSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [draft, setDraft] = useState<Draft>(() => blank(pets[0]?.id ?? ""));
  const [editing, setEditing] = useState<HealthRecord | undefined>();
  const [editDraft, setEditDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");

  /**
   * Which pet the form is actually on.
   *
   * The pets arrive from a live query, so the first render has none of them and
   * the draft starts empty. Left as state alone, the select would show the
   * first pet while the draft still held "" — and saving would complain about
   * the pet visibly chosen.
   */
  const chosen = pets.some((pet) => pet.id === draft.animalId)
    ? draft.animalId
    : (pets[0]?.id ?? "");

  const petName = (id: Ulid) => {
    const pet = pets.find((held) => held.id === id);
    return pet === undefined ? "a pet" : displayName(pet);
  };
  const contactName = (id: Ulid | undefined) =>
    id === undefined ? undefined : contacts.find((held) => held.id === id)?.name;

  const due = outstandingPetCare(careRecordsFor(records), new Date());
  const shown = filter === "all" ? records : records.filter((record) => record.animalId === filter);
  const history = [...shown].sort((left, right) => right.date.getTime() - left.date.getTime());

  const vets = contacts.filter(
    (contact) => contact.tags.includes("vet") || contact.tags.includes("ai_tech"),
  );

  function reportErrors(error: CrudError) {
    // §4.5 clause 2: on the field, not in a banner.
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { animalId: "Could not save. Check the fields and try again." },
    );
  }

  function fields(source: Draft) {
    const text = (value: string) => (value.trim() === "" ? undefined : value.trim());

    return {
      animalId: source.animalId as Ulid,
      type: source.type,
      date: new Date(`${source.date}T12:00:00`),
      product: text(source.product),
      vetContactId: source.vetContactId === "" ? undefined : (source.vetContactId as Ulid),
      administeredBy: text(source.administeredBy),
      cost: source.cost.trim() === "" ? undefined : fromDollars(Number(source.cost)),
      boosterDueOn:
        source.boosterDueOn === "" ? undefined : new Date(`${source.boosterDueOn}T12:00:00`),
      notes: text(source.notes),
    };
  }

  async function record(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});

    if (chosen === "") {
      setErrors({ animalId: "Add a pet before recording anything against one" });
      return;
    }

    setBusy(true);
    try {
      const result = await mutations.create(fields({ ...draft, animalId: chosen }) as never);
      if (!result.ok) {
        reportErrors(result.error);
        return;
      }

      show({
        message: `${TYPE_LABELS[draft.type]} recorded for ${petName(chosen as Ulid)}`,
        tone: "success",
      });
      // The pet and the date stay: a vet visit is usually two or three entries
      // for the same animal on the same day.
      setDraft({ ...blank(chosen), date: draft.date, vetContactId: draft.vetContactId });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(entry: HealthRecord) {
    setEditing(entry);
    setEditDraft({
      animalId: entry.animalId,
      type: entry.type,
      date: entry.date.toISOString().slice(0, 10),
      product: entry.product ?? "",
      vetContactId: entry.vetContactId ?? "",
      administeredBy: entry.administeredBy ?? "",
      cost: entry.cost === undefined ? "" : String(entry.cost.cents / 100),
      boosterDueOn: entry.boosterDueOn?.toISOString().slice(0, 10) ?? "",
      notes: entry.notes ?? "",
    });
    setErrors({});
  }

  function closeEdit() {
    setEditing(undefined);
    setEditDraft(undefined);
    setErrors({});
  }

  async function saveEdit() {
    if (editing === undefined || editDraft === undefined) return;

    const result = await mutations.update(editing.id, fields(editDraft));
    if (!result.ok) {
      reportErrors(result.error);
      return;
    }

    show({ message: "Entry saved", tone: "success" });
    closeEdit();
  }

  async function remove(entry: HealthRecord) {
    const confirmed = await confirmDelete({
      // Standard tier: one line in a history, with nothing hanging off it.
      tier: "standard",
      recordName: `${TYPE_LABELS[entry.type]} — ${petName(entry.animalId)}, ${formatDate(entry.date)}`,
      entity: "health record",
      dependents: [],
      consequence:
        entry.boosterDueOn === undefined
          ? "It comes off that pet's history."
          : "Its next-due date goes with it, so the reminder stops.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await mutations.remove(entry.id);
    if (!result.ok) {
      show({ message: "Could not delete that entry", tone: "danger" });
      return;
    }

    show({
      message: "Entry deleted",
      action: { label: "Undo", onAct: () => void mutations.restoreRecord(entry.id) },
    });
  }

  const columns: readonly Column<HealthRecord>[] = [
    { key: "date", header: "Date", render: (entry) => formatDate(entry.date) },
    { key: "pet", header: "Pet", render: (entry) => petName(entry.animalId) },
    {
      key: "type",
      header: "What",
      render: (entry) => <Badge tone="neutral">{TYPE_LABELS[entry.type]}</Badge>,
    },
    { key: "product", header: "Product", render: (entry) => entry.product ?? "—" },
    {
      key: "who",
      header: "Given by",
      render: (entry) => contactName(entry.vetContactId) ?? entry.administeredBy ?? "—",
    },
    {
      key: "next",
      header: "Next due",
      render: (entry) => formatDate(entry.boosterDueOn),
    },
    {
      key: "cost",
      header: "Cost",
      render: (entry) => (entry.cost === undefined ? "—" : formatMoney(entry.cost)),
    },
    {
      key: "actions",
      header: "",
      render: (entry) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => startEdit(entry)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(entry)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  if (loading) return <p className="text-muted">Loading health records…</p>;

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Coming up"
        description="Derived from the next-due date on the last one, so nothing has to be ticked off."
      >
        {due.length === 0 ? (
          <p className="text-density text-ink">
            Nothing due in the next fortnight.{" "}
            <span className="text-muted">
              A record only appears here if somebody put a next-due date on it.
            </span>
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {due.map((need) => (
              <li key={need.recordId} className="flex flex-wrap items-center gap-2 text-sm">
                <Pill tone={need.status === "overdue" ? "danger" : "action"} dot>
                  {need.status === "overdue" ? "overdue" : `in ${need.daysUntil}d`}
                </Pill>
                <span className="text-ink">{petName(need.animalId)}</span>
                <span className="text-muted">
                  {need.label} · {formatDate(need.dueOn)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Record a visit"
        description="Shots, worming, flea and tick, the annual check-up. Put the next-due date on if the vet gave one — that is the whole reminder."
      >
        {pets.length === 0 ? (
          <EmptyState title="No pets yet" detail="Add a pet before recording anything for one." />
        ) : (
          <form onSubmit={(event) => void record(event)} className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Pet"
                value={chosen}
                error={errors["animalId"]}
                options={pets.map((pet) => ({ value: pet.id, label: displayName(pet) }))}
                onChange={(event) => setDraft({ ...draft, animalId: event.target.value })}
              />
              <Select
                label="What"
                value={draft.type}
                options={HEALTH_RECORD_TYPES.map((type) => ({
                  value: type,
                  label: TYPE_LABELS[type],
                }))}
                onChange={(event) =>
                  setDraft({ ...draft, type: event.target.value as HealthRecordType })
                }
              />
              <TextInput
                label="Date"
                type="date"
                required
                value={draft.date}
                error={errors["date"]}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
              />
              <TextInput
                label="Product"
                hint="Rabies, Bravecto, Heartgard."
                value={draft.product}
                error={errors["product"]}
                onChange={(event) => setDraft({ ...draft, product: event.target.value })}
              />
              <Select
                label="Vet"
                value={draft.vetContactId}
                error={errors["vetContactId"]}
                options={[
                  { value: "", label: "Not a vet visit" },
                  ...vets.map((vet) => ({ value: vet.id, label: vet.name })),
                ]}
                onChange={(event) => setDraft({ ...draft, vetContactId: event.target.value })}
              />
              <TextInput
                label="Or given by"
                hint="Not every hand is a contact."
                value={draft.administeredBy}
                error={errors["administeredBy"]}
                onChange={(event) => setDraft({ ...draft, administeredBy: event.target.value })}
              />
              <TextInput
                label="Next due"
                type="date"
                hint="What the vet said. Leave blank if it does not come round."
                value={draft.boosterDueOn}
                error={errors["boosterDueOn"]}
                onChange={(event) => setDraft({ ...draft, boosterDueOn: event.target.value })}
              />
              <TextInput
                label="Cost ($)"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={draft.cost}
                error={errors["cost"]}
                onChange={(event) => setDraft({ ...draft, cost: event.target.value })}
              />
            </div>
            <TextArea
              label="Notes"
              rows={2}
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
            <div>
              <Button type="submit" variant="primary" busy={busy}>
                Record it
              </Button>
            </div>
          </form>
        )}
      </Section>

      <Section
        title="Everything recorded"
        actions={
          <Select
            label="Pet"
            hideLabel
            value={filter}
            options={[
              { value: "all", label: "Every pet" },
              ...pets.map((pet) => ({ value: pet.id, label: displayName(pet) })),
            ]}
            onChange={(event) => setFilter(event.target.value)}
          />
        }
      >
        <Card>
          <DataTable
            caption="Pet health history"
            columns={columns}
            rows={history}
            rowKey={(entry) => entry.id}
            empty={
              <EmptyState
                title="Nothing recorded yet"
                detail="Shots, worming and check-ups land here, with what they cost and when the next one is due."
              />
            }
          />
        </Card>
      </Section>

      {editDraft === undefined || editing === undefined ? null : (
        <Modal
          key={editing.id}
          size="wide"
          title={`Editing ${TYPE_LABELS[editing.type]} — ${petName(editing.animalId)}`}
          description="Correct what was given, by whom, and when the next one is due."
          onClose={closeEdit}
          footer={
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void saveEdit()}>
                Save changes
              </Button>
              <Button onClick={closeEdit}>Cancel</Button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
            <Select
              label="Pet"
              value={editDraft.animalId}
              error={errors["animalId"]}
              options={pets.map((pet) => ({ value: pet.id, label: displayName(pet) }))}
              onChange={(event) => setEditDraft({ ...editDraft, animalId: event.target.value })}
            />
            <Select
              label="What"
              value={editDraft.type}
              options={HEALTH_RECORD_TYPES.map((type) => ({
                value: type,
                label: TYPE_LABELS[type],
              }))}
              onChange={(event) =>
                setEditDraft({ ...editDraft, type: event.target.value as HealthRecordType })
              }
            />
            <TextInput
              label="Date"
              type="date"
              value={editDraft.date}
              error={errors["date"]}
              onChange={(event) => setEditDraft({ ...editDraft, date: event.target.value })}
            />
            <TextInput
              label="Product"
              value={editDraft.product}
              error={errors["product"]}
              onChange={(event) => setEditDraft({ ...editDraft, product: event.target.value })}
            />
            <Select
              label="Vet"
              value={editDraft.vetContactId}
              error={errors["vetContactId"]}
              options={[
                { value: "", label: "Not a vet visit" },
                ...vets.map((vet) => ({ value: vet.id, label: vet.name })),
              ]}
              onChange={(event) => setEditDraft({ ...editDraft, vetContactId: event.target.value })}
            />
            <TextInput
              label="Or given by"
              value={editDraft.administeredBy}
              error={errors["administeredBy"]}
              onChange={(event) =>
                setEditDraft({ ...editDraft, administeredBy: event.target.value })
              }
            />
            <TextInput
              label="Next due"
              type="date"
              value={editDraft.boosterDueOn}
              error={errors["boosterDueOn"]}
              onChange={(event) => setEditDraft({ ...editDraft, boosterDueOn: event.target.value })}
            />
            <TextInput
              label="Cost ($)"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={editDraft.cost}
              error={errors["cost"]}
              onChange={(event) => setEditDraft({ ...editDraft, cost: event.target.value })}
            />
            <TextArea
              label="Notes"
              rows={2}
              className="sm:col-span-2"
              value={editDraft.notes}
              error={errors["notes"]}
              onChange={(event) => setEditDraft({ ...editDraft, notes: event.target.value })}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
