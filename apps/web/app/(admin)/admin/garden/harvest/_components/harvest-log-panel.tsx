"use client";

import { useState } from "react";

import {
  Button,
  EmptyState,
  Modal,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
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
import { AddAction, LandRow, RowList } from "@/app/(admin)/admin/pastures/_components/land-kit";
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

  if (loading) return <p className="text-muted">Loading the harvest log…</p>;

  /** What each planting has given in total, for the summary under the list. */
  const yields = pickable
    .map((planting) => ({ planting, totals: totalHarvest(harvests, planting.id) }))
    .filter((row) => row.totals.size > 0)
    .sort((left, right) =>
      plantingLabel(left.planting.id).localeCompare(plantingLabel(right.planting.id)),
    );

  /** The one line: when, how much, what it became, anything noted. */
  function lineFor(log: HarvestLog): string {
    const jars = pantry.filter((entry) => entry.harvestLogId === log.id);
    return [
      formatDate(log.harvestedOn),
      quantityLabel(log.quantity, log.unit),
      jars.length === 0 ? undefined : `put by: ${jars.map((entry) => entry.label).join(", ")}`,
      log.notes,
    ]
      .filter((part) => part !== undefined)
      .join(" · ");
  }

  return (
    // One entry per picking — a log rather than a total, because the dates
    // are what tell you how long a variety kept giving.
    <div className="flex flex-col gap-density pb-20 sm:pb-0">
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
          <div className="flex flex-wrap items-center justify-between gap-density">
            <button
              type="button"
              onClick={onPreserve}
              className="inline-flex min-h-target items-center text-sm font-semibold text-action underline-offset-2 hover:underline"
            >
              Put some of it by →
            </button>
            <AddAction label="Record harvest" onClick={startCreate} />
          </div>

          <RowList label="Harvest log">
            {[...harvests]
              .sort((left, right) => right.harvestedOn.getTime() - left.harvestedOn.getTime())
              .map((log) => (
                <LandRow
                  key={log.id}
                  title={plantingLabel(log.plantingId)}
                  openLabel={`Edit ${quantityLabel(log.quantity, log.unit)} of ${plantingLabel(log.plantingId)}, ${formatDate(log.harvestedOn)}`}
                  line={lineFor(log)}
                  onOpen={() => startEdit(log)}
                />
              ))}
          </RowList>

          {/* Totals per planting, folded: read at the end of a season, not
              every time somebody records a picking. Units never add across. */}
          {yields.length === 0 ? null : (
            <details className="group text-sm">
              <summary className="inline-flex min-h-target cursor-pointer list-none items-center gap-1 font-semibold text-action [&::-webkit-details-marker]:hidden">
                Totals by planting
                <span aria-hidden="true" className="transition-transform group-open:rotate-90">
                  ›
                </span>
              </summary>
              <ul className="flex flex-col gap-1 pt-1 text-muted">
                {yields.map(({ planting, totals }) => (
                  <li key={planting.id}>
                    <span className="font-medium text-ink">{plantingLabel(planting.id)}</span> ·{" "}
                    {[...totals.entries()]
                      .map(([unit, amount]) => quantityLabel(amount, unit))
                      .join(", ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          placement="side"
          title={editing === undefined ? "Record a harvest" : "Editing a harvest entry"}
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Record it" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined ? null : (
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const log = editing;
                    setDraft(undefined);
                    setEditing(undefined);
                    void remove(log);
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
                hint="What you measured in. Units are never added together."
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
              placeholder="Size, quality, whether it split"
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
