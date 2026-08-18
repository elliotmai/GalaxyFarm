"use client";

import { useState } from "react";

import {
  Button,
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
import type { CrudError, Ulid } from "@galaxy-farm/core";
import {
  gardenCareLogSchema,
  type Bed,
  type Crop,
  type GardenCareAction,
  type GardenCareLog,
  type Planting,
  type Variety,
} from "@galaxy-farm/module-garden";

import {
  CARE_ACTION_LABEL,
  CARE_ACTION_OPTIONS,
  dateFromInput,
  dateInputValue,
  formatDate,
} from "@/app/(admin)/admin/garden/_components/labels";
import { varietyLabel } from "@/lib/garden";
import { useMutations } from "@/lib/local/mutations";

/**
 * What was done, and to what (spec §5.5).
 *
 * An entry names a bed **or** a planting, and the domain refuses one that
 * names neither. The two are genuinely different facts: amending a bed is
 * something done to the ground and outlives whatever is in it, while spraying
 * for hornworms is something done to the tomatoes and is meaningless once they
 * are pulled. Forcing everything onto the bed would lose which planting was
 * treated; forcing everything onto a planting would leave nowhere to record
 * the compost that went in before anything was planted at all.
 */

interface Draft {
  readonly target: string;
  readonly action: GardenCareAction;
  readonly performedOn: string;
  readonly product: string;
  readonly notes: string;
}

/** The picker holds both kinds, prefixed, because they are one question. */
const BED = "bed:";
const PLANTING = "planting:";

export function CareLogPanel({
  care,
  beds,
  plantings,
  varieties,
  crops,
  loading,
  propertyId,
  actorId,
}: {
  readonly care: readonly GardenCareLog[];
  readonly beds: readonly Bed[];
  readonly plantings: readonly Planting[];
  readonly varieties: readonly Variety[];
  readonly crops: readonly Crop[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<GardenCareLog>(
    "gardenCareLogs",
    "gardenCareLogs",
    gardenCareLogSchema,
    propertyId,
    actorId,
  );

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<GardenCareLog | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const bedName = (id: Ulid | undefined) =>
    id === undefined ? undefined : beds.find((bed) => bed.id === id)?.name;

  const plantingName = (id: Ulid | undefined) => {
    if (id === undefined) return undefined;
    const planting = plantings.find((row) => row.id === id);
    if (planting === undefined) return undefined;
    const variety = varieties.find((row) => row.id === planting.varietyId);
    return `${varietyLabel(variety, crops)} in ${bedName(planting.bedId) ?? "a bed"}`;
  };

  const targetLabel = (entry: GardenCareLog) =>
    plantingName(entry.plantingId) ?? bedName(entry.bedId) ?? "Something that has been deleted";

  const options = [
    { value: "", label: "Pick one" },
    ...beds
      .filter((bed) => bed.active)
      .map((bed) => ({ value: `${BED}${bed.id}`, label: `${bed.name} (the bed itself)` })),
    ...plantings
      .filter((planting) => planting.status !== "finished" && planting.status !== "failed")
      .map((planting) => ({
        value: `${PLANTING}${planting.id}`,
        label: plantingName(planting.id) ?? "A planting",
      })),
  ];

  function startCreate() {
    setEditing(undefined);
    setDraft({
      target: "",
      action: "water",
      performedOn: dateInputValue(new Date()),
      product: "",
      notes: "",
    });
    setErrors({});
  }

  function startEdit(entry: GardenCareLog) {
    setEditing(entry);
    setDraft({
      target:
        entry.plantingId !== undefined
          ? `${PLANTING}${entry.plantingId}`
          : entry.bedId !== undefined
            ? `${BED}${entry.bedId}`
            : "",
      action: entry.action,
      performedOn: dateInputValue(entry.performedOn),
      product: entry.product ?? "",
      notes: entry.notes ?? "",
    });
    setErrors({});
  }

  function reportErrors(error: CrudError) {
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { bedId: "Could not save. Check the fields and try again." },
    );
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});

    const isPlanting = draft.target.startsWith(PLANTING);
    const id = draft.target.slice(draft.target.indexOf(":") + 1) as Ulid;
    const planting = isPlanting ? plantings.find((row) => row.id === id) : undefined;

    const fields = {
      // A planting entry carries its bed too, so "what has this bed had done
      // to it" is one query rather than a join the caller has to remember.
      bedId: isPlanting ? planting?.bedId : draft.target === "" ? undefined : id,
      plantingId: isPlanting ? id : undefined,
      action: draft.action,
      performedOn: dateFromInput(draft.performedOn) ?? new Date(),
      product: draft.product.trim() === "" ? undefined : draft.product.trim(),
      notes: draft.notes.trim() === "" ? undefined : draft.notes.trim(),
    };

    const result =
      editing === undefined
        ? await api.create(fields as never)
        : await api.update(editing.id, fields as Partial<GardenCareLog>);

    if (!result.ok) {
      reportErrors(result.error);
      return;
    }

    show({ message: editing === undefined ? "Care recorded" : "Entry saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
  }

  /** Standard tier: a log entry with nothing hanging off it (§4.5). */
  async function remove(entry: GardenCareLog) {
    const label = `${CARE_ACTION_LABEL[entry.action]} — ${targetLabel(entry)}`;

    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: label,
      entity: "care entry",
      dependents: [],
      consequence: "Nothing else points at it.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await api.remove(entry.id, "Care entry removed");
    if (!result.ok) {
      show({ message: "Could not delete that entry", tone: "danger" });
      return;
    }

    show({
      message: "Care entry deleted",
      action: { label: "Undo", onAct: () => void api.restoreRecord(entry.id) },
    });
  }

  const columns: readonly Column<GardenCareLog>[] = [
    {
      key: "performedOn",
      header: "When",
      primary: true,
      render: (row) => formatDate(row.performedOn),
    },
    {
      key: "action",
      header: "What",
      render: (row) => <Pill tone="action">{CARE_ACTION_LABEL[row.action]}</Pill>,
    },
    { key: "target", header: "Where", render: (row) => targetLabel(row) },
    {
      key: "product",
      header: "Product",
      render: (row) =>
        row.product === undefined ? <span className="text-muted">—</span> : row.product,
    },
    {
      key: "notes",
      header: "Notes",
      render: (row) =>
        row.notes === undefined ? <span className="text-muted">—</span> : row.notes,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => startEdit(row)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(row)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  if (loading) return <p className="text-muted">Loading the care log…</p>;

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Care log"
        description="Water, weeding, feeding, spray and amendments — against a bed when it is the ground being treated, against a planting when it is the crop."
        actions={
          <Button variant="primary" onClick={startCreate} disabled={options.length === 1}>
            Record care
          </Button>
        }
      >
        {care.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            detail="What went on the beds and when. The product field is what makes this worth keeping — next year's question is always which one worked."
            action={
              <Button variant="primary" onClick={startCreate} disabled={options.length === 1}>
                Record the first entry
              </Button>
            }
          />
        ) : (
          <DataTable
            rows={[...care].sort(
              (left, right) => right.performedOn.getTime() - left.performedOn.getTime(),
            )}
            columns={columns}
            rowKey={(row) => row.id}
            caption="Garden care log"
            empty="Nothing recorded yet."
          />
        )}
      </Section>

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          size="wide"
          title={editing === undefined ? "Record care" : "Editing an entry"}
          description="One entry per thing done. A planting entry is filed against its bed as well, so a bed's history is complete either way."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <Select
                label="Bed or planting"
                required
                hint="The bed when it is the ground being treated; the planting when it is the crop."
                options={options}
                value={draft.target}
                error={errors["bedId"]}
                onChange={(event) => setDraft({ ...draft, target: event.target.value })}
              />
              <Select
                label="What was done"
                options={CARE_ACTION_OPTIONS}
                value={draft.action}
                error={errors["action"]}
                onChange={(event) =>
                  setDraft({ ...draft, action: event.target.value as GardenCareAction })
                }
              />
              <TextInput
                label="When"
                type="date"
                required
                value={draft.performedOn}
                error={errors["performedOn"]}
                onChange={(event) => setDraft({ ...draft, performedOn: event.target.value })}
              />
              <TextInput
                label="Product"
                hint="&ldquo;Fish emulsion&rdquo;, &ldquo;Spinosad&rdquo;, &ldquo;composted manure&rdquo;."
                value={draft.product}
                error={errors["product"]}
                onChange={(event) => setDraft({ ...draft, product: event.target.value })}
              />
            </div>

            <TextArea
              label="Notes"
              rows={3}
              hint="Rate, dilution, what it was for, whether it worked."
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Record it" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
