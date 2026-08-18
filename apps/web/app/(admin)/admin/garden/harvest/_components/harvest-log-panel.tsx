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
  harvestLogSchema,
  preservationLogSchema,
  totalHarvest,
  type Bed,
  type Crop,
  type HarvestLog,
  type Planting,
  type PreservationLog,
  type Variety,
} from "@galaxy-farm/module-garden";

import {
  HARVEST_UNIT_OPTIONS,
  dateFromInput,
  dateInputValue,
  formatDate,
  quantityLabel,
} from "@/app/(admin)/admin/garden/_components/labels";
import { varietyLabel } from "@/lib/garden";
import { useMutations } from "@/lib/local/mutations";

/**
 * What came off, entry by entry (spec §5.5).
 *
 * A row per picking rather than a running total per planting, for §4.5's
 * reason: the total is derived from the log and the log carries the CRUD. It
 * also happens to be the only shape that answers the question worth asking —
 * "how long did it keep giving" is a question about dates, and a single total
 * has none.
 *
 * Units are per entry and are never added across. Six pounds and four bunches
 * is not ten of anything, and `totalHarvest` returns a map for exactly that
 * reason.
 */

interface Draft {
  readonly plantingId: string;
  readonly harvestedOn: string;
  readonly quantity: string;
  readonly unit: HarvestLog["unit"];
  readonly notes: string;
}

export function HarvestLogPanel({
  harvests,
  pantry,
  plantings,
  beds,
  varieties,
  crops,
  loading,
  propertyId,
  actorId,
  onPreserve,
}: {
  readonly harvests: readonly HarvestLog[];
  readonly pantry: readonly PreservationLog[];
  readonly plantings: readonly Planting[];
  readonly beds: readonly Bed[];
  readonly varieties: readonly Variety[];
  readonly crops: readonly Crop[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onPreserve: () => void;
}) {
  const api = useMutations<HarvestLog>(
    "harvestLogs",
    "harvestLogs",
    harvestLogSchema,
    propertyId,
    actorId,
  );
  // Deleting a harvest lets go of the jars that named it — a write to the
  // pantry table.
  const pantryApi = useMutations<PreservationLog>(
    "preservationLogs",
    "preservationLogs",
    preservationLogSchema,
    propertyId,
    actorId,
  );

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<HarvestLog | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const plantingLabel = (id: Ulid) => {
    const planting = plantings.find((row) => row.id === id);
    if (planting === undefined) return "A planting that has been deleted";
    const variety = varieties.find((row) => row.id === planting.varietyId);
    const bed = beds.find((row) => row.id === planting.bedId)?.name;
    return `${varietyLabel(variety, crops)}${bed === undefined ? "" : ` · ${bed}`}`;
  };

  /**
   * What can still be picked from.
   *
   * Everything but planned and failed. A finished planting stays on the list
   * because the last picking is often recorded after somebody has already
   * pulled the plants and marked it finished.
   */
  const pickable = plantings.filter(
    (planting) => planting.status !== "planned" && planting.status !== "failed",
  );

  function startCreate() {
    setEditing(undefined);
    setDraft({
      plantingId: pickable[0]?.id ?? "",
      harvestedOn: dateInputValue(new Date()),
      quantity: "",
      unit: "lb",
      notes: "",
    });
    setErrors({});
  }

  function startEdit(log: HarvestLog) {
    setEditing(log);
    setDraft({
      plantingId: log.plantingId,
      harvestedOn: dateInputValue(log.harvestedOn),
      quantity: String(log.quantity),
      unit: log.unit,
      notes: log.notes ?? "",
    });
    setErrors({});
  }

  function reportErrors(error: CrudError) {
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { plantingId: "Could not save. Check the fields and try again." },
    );
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});

    const fields = {
      plantingId: draft.plantingId as Ulid,
      harvestedOn: dateFromInput(draft.harvestedOn) ?? new Date(),
      quantity: draft.quantity.trim() === "" ? Number.NaN : Number(draft.quantity),
      unit: draft.unit,
      notes: draft.notes.trim() === "" ? undefined : draft.notes.trim(),
    };

    const result =
      editing === undefined
        ? await api.create(fields as never)
        : await api.update(editing.id, fields as Partial<HarvestLog>);

    if (!result.ok) {
      reportErrors(result.error);
      return;
    }

    show({
      message: editing === undefined ? "Harvest recorded" : "Harvest saved",
      tone: "success",
    });
    setDraft(undefined);
    setEditing(undefined);
  }

  /**
   * Delete one picking.
   *
   * Jars that point at it **detach** rather than cascade: six quarts of salsa
   * on a shelf are six quarts of salsa whatever happened to the log entry
   * saying where the tomatoes came from. They lose the link and keep the jars.
   */
  async function remove(log: HarvestLog) {
    const jars = pantry.filter((entry) => entry.harvestLogId === log.id);
    const label = `${quantityLabel(log.quantity, log.unit)} of ${plantingLabel(log.plantingId)}`;

    const confirmed = await confirmDelete({
      tier: jars.length > 0 ? "elevated" : "standard",
      recordName: label,
      entity: "harvest entry",
      dependents: jars.map((entry) => ({
        entity: "Pantry",
        label: `${entry.label} — ${quantityLabel(entry.quantity, entry.unit)}`,
        effect: "detached" as const,
      })),
      consequence:
        jars.length === 0
          ? "Nothing in the pantry points at it."
          : "The jars stay on the shelf; they stop saying which picking they came from.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await api.remove(log.id, "Harvest entry removed");
    if (!result.ok) {
      show({ message: "Could not delete that entry", tone: "danger" });
      return;
    }

    for (const entry of jars) await pantryApi.update(entry.id, { harvestLogId: undefined });

    show({
      message: "Harvest entry deleted",
      action: {
        label: "Undo",
        onAct: () => {
          void (async () => {
            await api.restoreRecord(log.id);
            for (const entry of jars) await pantryApi.update(entry.id, { harvestLogId: log.id });
          })();
        },
      },
    });
  }

  const columns: readonly Column<HarvestLog>[] = [
    {
      key: "harvestedOn",
      header: "Picked",
      primary: true,
      render: (row) => formatDate(row.harvestedOn),
    },
    { key: "planting", header: "From", render: (row) => plantingLabel(row.plantingId) },
    {
      key: "quantity",
      header: "How much",
      numeric: true,
      render: (row) => quantityLabel(row.quantity, row.unit),
    },
    {
      key: "preserved",
      header: "Put by",
      render: (row) => {
        const jars = pantry.filter((entry) => entry.harvestLogId === row.id);
        return jars.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {jars.map((entry) => (
              <Pill key={entry.id} tone="calm">
                {entry.label}
              </Pill>
            ))}
          </span>
        );
      },
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

  if (loading) return <p className="text-muted">Loading the harvest log…</p>;

  /** What each planting has given in total, for the summary above the table. */
  const yields = pickable
    .map((planting) => ({ planting, totals: totalHarvest(harvests, planting.id) }))
    .filter((row) => row.totals.size > 0)
    .sort((left, right) =>
      plantingLabel(left.planting.id).localeCompare(plantingLabel(right.planting.id)),
    );

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Harvest log"
        description="One entry per picking. Kept as a log rather than a total because the dates are what tell you how long a variety kept giving."
        actions={
          <Button variant="primary" onClick={startCreate} disabled={pickable.length === 0}>
            Record a harvest
          </Button>
        }
      >
        {pickable.length === 0 ? (
          <EmptyState
            title="Nothing to harvest from"
            detail="A harvest is a harvest of a planting. Record what is in the ground first."
          />
        ) : harvests.length === 0 ? (
          <EmptyState
            title="Nothing picked yet"
            detail="Record what comes off as it comes off — a weight and a date is enough."
            action={
              <Button variant="primary" onClick={startCreate}>
                Record the first harvest
              </Button>
            }
          />
        ) : (
          <>
            {yields.length === 0 ? null : (
              <div className="mb-density flex flex-wrap gap-2">
                {yields.map(({ planting, totals }) => (
                  <Pill key={planting.id} tone="identity">
                    {plantingLabel(planting.id)}:{" "}
                    {[...totals.entries()]
                      .map(([unit, amount]) => quantityLabel(amount, unit))
                      .join(", ")}
                  </Pill>
                ))}
              </div>
            )}

            <DataTable
              rows={[...harvests].sort(
                (left, right) => right.harvestedOn.getTime() - left.harvestedOn.getTime(),
              )}
              columns={columns}
              rowKey={(row) => row.id}
              caption="Harvest log"
              empty="Nothing picked yet."
            />

            <div className="mt-density">
              <Button variant="ghost" onClick={onPreserve}>
                Put some of it by →
              </Button>
            </div>
          </>
        )}
      </Section>

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          size="wide"
          title={editing === undefined ? "Record a harvest" : "Editing a harvest entry"}
          description="What came off, from what, and when."
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <Select
                label="From"
                required
                options={[
                  { value: "", label: "Pick one" },
                  ...pickable.map((planting) => ({
                    value: planting.id,
                    label: plantingLabel(planting.id),
                  })),
                ]}
                value={draft.plantingId}
                error={errors["plantingId"]}
                onChange={(event) => setDraft({ ...draft, plantingId: event.target.value })}
              />
              <TextInput
                label="Picked on"
                type="date"
                required
                value={draft.harvestedOn}
                error={errors["harvestedOn"]}
                onChange={(event) => setDraft({ ...draft, harvestedOn: event.target.value })}
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
                hint="Whatever you actually measured in. Units are never added together."
                options={HARVEST_UNIT_OPTIONS}
                value={draft.unit}
                error={errors["unit"]}
                onChange={(event) =>
                  setDraft({ ...draft, unit: event.target.value as HarvestLog["unit"] })
                }
              />
            </div>

            <TextArea
              label="Notes"
              rows={3}
              hint="Size, quality, whether it split — what you would want to read next January."
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
