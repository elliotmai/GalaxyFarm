"use client";

import { useState } from "react";

import {
  Button,
  EmptyState,
  Modal,
  Section,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import type { CrudError, Ulid } from "@galaxy-farm/core";
import {
  PRESERVATION_METHODS,
  preservationLogSchema,
  type Crop,
  type HarvestLog,
  type Planting,
  type PreservationLog,
  type PreservationMethod,
  type Variety,
} from "@galaxy-farm/module-garden";

import {
  PANTRY_UNIT_OPTIONS,
  PRESERVATION_LABEL,
  PRESERVATION_OPTIONS,
  dateFromInput,
  dateInputValue,
  formatDate,
  quantityLabel,
} from "@/app/(admin)/admin/garden/_components/labels";
import {
  AddAction,
  ChipGroup,
  FilteredLine,
  LandRow,
  RowList,
} from "@/app/(admin)/admin/pastures/_components/land-kit";
import { pantryByMethod, pantryShelf, varietyLabel } from "@/lib/garden";
import { useMutations } from "@/lib/local/mutations";

/**
 * The pantry (spec §5.5).
 *
 * §5.5 calls this "your pantry inventory", and an inventory is not a log. The
 * shelf is folded on label, method and unit, because twelve entries of
 * six jars across a summer is seventy-two jars of salsa and reading it as
 * twelve rows is reading it wrong. Method stays in the key — canned green
 * beans and frozen green beans are different food in different places — and so
 * does the unit, because four bags plus six quarts is not ten of anything.
 *
 * The individual entries are still there, below, because §4.5 needs somewhere
 * to edit and delete one and because "when was this batch made" is a question
 * a shelf cannot answer.
 *
 * `harvestLogId` is optional on purpose. Half of what gets put by never came
 * off these beds — apples from a neighbour, a case of tomatoes off a truck —
 * and a jar on a shelf is a fact about the pantry either way.
 */

interface Draft {
  readonly label: string;
  readonly method: PreservationMethod;
  readonly quantity: string;
  readonly unit: PreservationLog["unit"];
  readonly preservedOn: string;
  readonly storageLocation: string;
  readonly harvestLogId: string;
  readonly notes: string;
}

export function PantryPanel({
  pantry,
  harvests,
  plantings,
  varieties,
  crops,
  loading,
  propertyId,
  actorId,
}: {
  readonly pantry: readonly PreservationLog[];
  readonly harvests: readonly HarvestLog[];
  readonly plantings: readonly Planting[];
  readonly varieties: readonly Variety[];
  readonly crops: readonly Crop[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<PreservationLog>(
    "preservationLogs",
    "preservationLogs",
    preservationLogSchema,
    propertyId,
    actorId,
  );

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<PreservationLog | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<PreservationMethod | "all">("all");

  const harvestLabel = (log: HarvestLog) => {
    const planting = plantings.find((row) => row.id === log.plantingId);
    const variety = varieties.find((row) => row.id === planting?.varietyId);
    return `${varietyLabel(variety, crops)} — ${quantityLabel(log.quantity, log.unit)}, ${formatDate(log.harvestedOn)}`;
  };

  const shown = method === "all" ? pantry : pantry.filter((entry) => entry.method === method);
  const shelf = pantryShelf(shown);
  const byMethod = pantryByMethod(pantry);

  function startCreate() {
    setEditing(undefined);
    setDraft({
      label: "",
      method: "canned",
      quantity: "",
      unit: "jar",
      preservedOn: dateInputValue(new Date()),
      storageLocation: "",
      harvestLogId: "",
      notes: "",
    });
    setErrors({});
  }

  function startEdit(entry: PreservationLog) {
    setEditing(entry);
    setDraft({
      label: entry.label,
      method: entry.method,
      quantity: String(entry.quantity),
      unit: entry.unit,
      preservedOn: dateInputValue(entry.preservedOn),
      storageLocation: entry.storageLocation ?? "",
      harvestLogId: entry.harvestLogId ?? "",
      notes: entry.notes ?? "",
    });
    setErrors({});
  }

  function reportErrors(error: CrudError) {
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { label: "Could not save. Check the fields and try again." },
    );
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});

    const text = (value: string) => (value.trim() === "" ? undefined : value.trim());
    const fields = {
      label: draft.label.trim(),
      method: draft.method,
      quantity: draft.quantity.trim() === "" ? Number.NaN : Number(draft.quantity),
      unit: draft.unit,
      preservedOn: dateFromInput(draft.preservedOn) ?? new Date(),
      storageLocation: text(draft.storageLocation),
      harvestLogId: draft.harvestLogId === "" ? undefined : (draft.harvestLogId as Ulid),
      notes: text(draft.notes),
    };

    const result =
      editing === undefined
        ? await api.create(fields as never)
        : await api.update(editing.id, fields as Partial<PreservationLog>);

    if (!result.ok) {
      reportErrors(result.error);
      return;
    }

    show({ message: editing === undefined ? "Put by" : "Batch saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
  }

  /**
   * Delete a batch.
   *
   * Standard tier: nothing points at a pantry entry. Worth saying that this is
   * for correcting a mistyped batch and not for recording that the jars were
   * eaten — eating six jars is an edit down to nothing left, and deleting the
   * row would lose the record that they were ever made.
   */
  async function remove(entry: PreservationLog) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${entry.label} — ${quantityLabel(entry.quantity, entry.unit)}`,
      entity: "pantry batch",
      dependents: [],
      consequence:
        "Nothing else points at it. If the jars were eaten rather than never made, edit the count down instead — that keeps the record of the batch.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await api.remove(entry.id, "Pantry batch removed");
    if (!result.ok) {
      show({ message: "Could not delete that batch", tone: "danger" });
      return;
    }

    show({
      message: `${entry.label} deleted`,
      action: { label: "Undo", onAct: () => void api.restoreRecord(entry.id) },
    });
  }

  if (loading) return <p className="text-muted">Loading the pantry…</p>;

  // The methods in use, as chips carrying what the old row of pills counted.
  const chips = [
    { key: "all", label: "All" },
    ...PRESERVATION_METHODS.filter((each) => byMethod.get(each) !== undefined).map((each) => ({
      key: each,
      label: PRESERVATION_LABEL[each],
      count: byMethod.get(each),
    })),
  ];

  return (
    <div className="flex flex-col gap-density pb-20 sm:pb-0">
      {pantry.length === 0 ? (
        <EmptyState
          title="Nothing put by yet"
          detail="Record a batch as it comes out of the canner. The label and where it is kept make it readable from a doorway."
          action={
            <Button variant="primary" onClick={startCreate}>
              Record the first batch
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-density">
            <div className="min-w-0 flex-1">
              <ChipGroup
                label="Filter by method"
                chips={chips}
                value={method}
                // The chip row's "off" is "", which here means everything.
                onChange={(key) => setMethod(key === "" ? "all" : (key as PreservationMethod))}
              />
            </div>
            <AddAction label="Put something by" onClick={startCreate} />
          </div>

          <FilteredLine
            shown={shown.length}
            total={pantry.length}
            labels={method === "all" ? [] : [PRESERVATION_LABEL[method]]}
            onClear={() => setMethod("all")}
          />

          {/* The inventory: everything put by, folded together by label. The
              batches that made it up are below. */}
          <Section title="On the shelf">
            <RowList label="On the shelf">
              {shelf.map((line) => (
                <LandRow
                  key={`${line.label}-${line.method}-${line.unit}`}
                  title={
                    <>
                      {line.label}{" "}
                      <span className="gf-numeric font-normal text-muted">
                        {quantityLabel(line.quantity, line.unit)}
                      </span>
                    </>
                  }
                  line={[
                    PRESERVATION_LABEL[line.method],
                    line.locations.length === 0 ? "no storage place" : line.locations.join(", "),
                    `last put by ${formatDate(line.latest)}`,
                  ].join(" · ")}
                />
              ))}
            </RowList>
          </Section>

          {/* Each run through the canner, the freezer or the dehydrator. Edit
              the count down as jars are eaten — that keeps the batch. */}
          <Section title="Batches">
            <RowList label="Pantry batches">
              {[...shown]
                .sort((left, right) => right.preservedOn.getTime() - left.preservedOn.getTime())
                .map((entry) => (
                  <LandRow
                    key={entry.id}
                    title={entry.label}
                    openLabel={`Edit ${entry.label}, ${formatDate(entry.preservedOn)}`}
                    line={[
                      quantityLabel(entry.quantity, entry.unit),
                      PRESERVATION_LABEL[entry.method],
                      formatDate(entry.preservedOn),
                      entry.storageLocation,
                    ]
                      .filter((part) => part !== undefined)
                      .join(" · ")}
                    quiet={entry.quantity === 0}
                    onOpen={() => startEdit(entry)}
                  />
                ))}
            </RowList>
          </Section>
        </>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          placement="side"
          title={editing === undefined ? "Put something by" : `Editing ${editing.label}`}
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Put it by" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined ? null : (
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const entry = editing;
                    setDraft(undefined);
                    setEditing(undefined);
                    void remove(entry);
                  }}
                >
                  Delete
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-density">
            <div className="flex flex-col gap-density sm:grid sm:grid-cols-2">
              <TextInput
                label="Label"
                required
                placeholder="Salsa, medium"
                value={draft.label}
                error={errors["label"]}
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              />
              <Select
                label="Method"
                options={PRESERVATION_OPTIONS}
                value={draft.method}
                error={errors["method"]}
                onChange={(event) =>
                  setDraft({ ...draft, method: event.target.value as PreservationMethod })
                }
              />
              <TextInput
                label="How much"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                numeric
                required
                value={draft.quantity}
                error={errors["quantity"]}
                onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
              />
              <Select
                label="Unit"
                options={PANTRY_UNIT_OPTIONS}
                value={draft.unit}
                error={errors["unit"]}
                onChange={(event) =>
                  setDraft({ ...draft, unit: event.target.value as PreservationLog["unit"] })
                }
              />
              <TextInput
                label="Put by on"
                type="date"
                required
                value={draft.preservedOn}
                error={errors["preservedOn"]}
                onChange={(event) => setDraft({ ...draft, preservedOn: event.target.value })}
              />
              <TextInput
                label="Where it is kept"
                placeholder="Pantry shelf 2"
                value={draft.storageLocation}
                error={errors["storageLocation"]}
                onChange={(event) => setDraft({ ...draft, storageLocation: event.target.value })}
              />
            </div>

            <Select
              label="From which harvest"
              hint="Optional — not everything came off these beds."
              options={[
                { value: "", label: "Not from a recorded harvest" },
                ...[...harvests]
                  .sort((left, right) => right.harvestedOn.getTime() - left.harvestedOn.getTime())
                  .map((log) => ({ value: log.id, label: harvestLabel(log) })),
              ]}
              value={draft.harvestLogId}
              error={errors["harvestLogId"]}
              onChange={(event) => setDraft({ ...draft, harvestLogId: event.target.value })}
            />

            <TextArea
              label="Notes"
              rows={3}
              placeholder="Recipe, processing time, how it turned out"
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
