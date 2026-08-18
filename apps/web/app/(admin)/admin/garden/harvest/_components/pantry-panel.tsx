"use client";

import { useState } from "react";

import {
  Button,
  CardGrid,
  EmptyState,
  Modal,
  Pill,
  RecordCard,
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
import { pantryByMethod, pantryShelf, varietyLabel } from "@/lib/garden";
import { useMutations } from "@/lib/local/mutations";

/**
 * The pantry (spec §5.5).
 *
 * §5.5 calls this "your pantry inventory", and an inventory is not a log. The
 * shelf above is folded on label, method and unit, because twelve entries of
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

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="On the shelf"
        description="Everything put by, folded together by label. This is the inventory — the batches that made it up are below."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              label="Method"
              hideLabel
              options={[{ value: "all", label: "Everything" }, ...PRESERVATION_OPTIONS]}
              value={method}
              onChange={(event) => setMethod(event.target.value as PreservationMethod | "all")}
            />
            <Button variant="primary" onClick={startCreate}>
              Put something by
            </Button>
          </div>
        }
      >
        {pantry.length === 0 ? (
          <EmptyState
            title="Nothing put by yet"
            detail="Record a batch as it comes out of the canner. The label and where it is stored are what turn this into something you can stand in a doorway and read."
            action={
              <Button variant="primary" onClick={startCreate}>
                Record the first batch
              </Button>
            }
          />
        ) : (
          <>
            <div className="mb-density flex flex-wrap gap-2">
              {PRESERVATION_METHODS.map((each) => (
                <Pill key={each} tone={byMethod.get(each) === undefined ? "neutral" : "calm"}>
                  {PRESERVATION_LABEL[each]}: {byMethod.get(each) ?? 0}
                </Pill>
              ))}
            </div>

            {shelf.length === 0 ? (
              <EmptyState
                title="Nothing under that method"
                detail="Switch the filter back to everything."
              />
            ) : (
              <CardGrid columns={3}>
                {shelf.map((line) => (
                  <RecordCard
                    key={`${line.label}-${line.method}-${line.unit}`}
                    tone="calm"
                    title={line.label}
                    subtitle={
                      line.locations.length === 0
                        ? "No storage place recorded"
                        : line.locations.join(" · ")
                    }
                    meta={
                      <>
                        <Pill tone="identity">{quantityLabel(line.quantity, line.unit)}</Pill>
                        <Pill tone="neutral">{PRESERVATION_LABEL[line.method]}</Pill>
                        <Pill tone="neutral">last put by {formatDate(line.latest)}</Pill>
                      </>
                    }
                  />
                ))}
              </CardGrid>
            )}
          </>
        )}
      </Section>

      {pantry.length === 0 ? null : (
        <Section
          title="Batches"
          description="Each run through the canner, the freezer or the dehydrator. Edit the count down as jars are eaten — that keeps the record of the batch."
        >
          <div className="flex flex-col divide-y divide-rule">
            {[...pantry]
              .sort((left, right) => right.preservedOn.getTime() - left.preservedOn.getTime())
              .map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-density text-ink">{entry.label}</span>
                    <Pill tone="identity">{quantityLabel(entry.quantity, entry.unit)}</Pill>
                    <Pill tone="neutral">{PRESERVATION_LABEL[entry.method]}</Pill>
                    <span className="text-sm text-muted">{formatDate(entry.preservedOn)}</span>
                    {entry.storageLocation === undefined ? null : (
                      <span className="text-sm text-muted">· {entry.storageLocation}</span>
                    )}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => startEdit(entry)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(entry)}>
                      Delete
                    </Button>
                  </span>
                </div>
              ))}
          </div>
        </Section>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          size="wide"
          title={editing === undefined ? "Put something by" : `Editing ${editing.label}`}
          description="What is written on the jar, how much of it there is, and where it went."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <TextInput
                label="Label"
                required
                hint="What you would write on the lid — &ldquo;Salsa, medium&rdquo;, &ldquo;Green beans&rdquo;."
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
                hint="&ldquo;Pantry shelf 2&rdquo;, &ldquo;chest freezer&rdquo;, &ldquo;cellar&rdquo;."
                value={draft.storageLocation}
                error={errors["storageLocation"]}
                onChange={(event) => setDraft({ ...draft, storageLocation: event.target.value })}
              />
            </div>

            <Select
              label="From which harvest"
              hint="Optional — plenty of what gets put by never came off these beds."
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
              hint="The recipe, the processing time, how it turned out."
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Put it by" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
