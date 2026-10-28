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
import { type CrudError, type Ulid } from "@galaxy-farm/core";
import {
  eggLogSchema,
  type EggBreakdown,
  type EggLog,
  type Flock,
} from "@galaxy-farm/module-poultry";

import {
  BreakdownEditor,
  breakdownSum,
  describeBreakdown,
} from "@/app/(admin)/admin/chickens/eggs/_components/breakdown-editor";
import {
  ChipRow,
  FilteredLine,
  ListRow,
  RowList,
} from "@/app/(admin)/admin/horses/_components/list-row";
import { useMutations } from "@/lib/local/mutations";

/**
 * Every collection, and the way to correct one (spec §4.5 clause 1).
 *
 * The Collect tab writes; this one is the rest of the surface that clause 1
 * asks for — find it, read it, fix it, remove it. Nothing on this screen is a
 * derived read model, so every number the header and the trends show can be
 * traced back to a row here and corrected at the source. A row is the count,
 * the day and one line; it opens its editor, which is where delete lives.
 */

function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

interface Draft {
  readonly flockId: string;
  readonly collectedOn: string;
  readonly total: string;
  readonly breakdown: readonly EggBreakdown[];
  readonly notes: string;
}

export function EggLogPanel({
  logs,
  flocks,
  loading,
  propertyId,
  actorId,
}: {
  readonly logs: readonly EggLog[];
  readonly flocks: readonly Flock[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const mutations = useMutations<EggLog>("eggLogs", "eggLogs", eggLogSchema, propertyId, actorId);
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<EggLog | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("all");

  const flockName = (id: Ulid | undefined) =>
    id === undefined ? undefined : flocks.find((flock) => flock.id === id)?.name;

  const shown =
    filter === "all"
      ? logs
      : filter === "none"
        ? logs.filter((log) => log.flockId === undefined)
        : logs.filter((log) => log.flockId === filter);

  const history = [...shown].sort(
    (left, right) => right.collectedOn.getTime() - left.collectedOn.getTime(),
  );

  function startEdit(log: EggLog) {
    setEditing(log);
    setDraft({
      flockId: log.flockId ?? "",
      collectedOn: log.collectedOn.toISOString().slice(0, 10),
      total: String(log.total),
      breakdown: log.breakdown,
      notes: log.notes ?? "",
    });
    setErrors({});
  }

  function closeEdit() {
    setEditing(undefined);
    setDraft(undefined);
    setErrors({});
  }

  function reportErrors(error: CrudError) {
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { total: "Could not save. Check the fields and try again." },
    );
  }

  async function saveEdit() {
    if (editing === undefined || draft === undefined) return;
    setErrors({});

    const flock = flocks.find((entry) => entry.id === draft.flockId);

    const result = await mutations.update(editing.id, {
      flockId: draft.flockId === "" ? undefined : (draft.flockId as Ulid),
      // Follows the flock, as it does on the way in. A log moved to another
      // coop that kept the first coop's zone would be wrong in both places.
      zoneId: flock?.zoneId,
      collectedOn: new Date(`${draft.collectedOn}T12:00:00`),
      total:
        draft.breakdown.length > 0
          ? breakdownSum(draft.breakdown)
          : draft.total.trim() === ""
            ? Number.NaN
            : Number(draft.total),
      breakdown: [...draft.breakdown],
      notes: draft.notes.trim() === "" ? undefined : draft.notes.trim(),
    });

    if (!result.ok) {
      reportErrors(result.error);
      return;
    }

    show({ message: "Collection saved", tone: "success" });
    closeEdit();
  }

  async function removeLog(log: EggLog) {
    const from = flockName(log.flockId);

    const confirmed = await confirmDelete({
      // Standard tier: one morning's basket, with nothing hanging off it.
      tier: "standard",
      recordName: `${log.total} egg${log.total === 1 ? "" : "s"}${from === undefined ? "" : ` from ${from}`} on ${formatDate(log.collectedOn)}`,
      entity: "egg log",
      dependents: [],
      consequence:
        "It comes out of the trends, the lay rate and the basket, which all read straight off these rows.",
      action: "Delete",
    });
    if (!confirmed) return;

    if (editing?.id === log.id) closeEdit();

    const result = await mutations.remove(log.id);
    if (!result.ok) {
      show({ message: "Could not delete that collection", tone: "danger" });
      return;
    }

    show({
      message: "Collection deleted",
      action: { label: "Undo", onAct: () => void mutations.restoreRecord(log.id) },
    });
  }

  /** The chips: every flock, each one, and the logs that named none. */
  const chips = [
    { key: "all", label: "Every flock" },
    ...flocks.map((flock) => ({ key: flock.id as string, label: flock.name })),
    ...(logs.some((log) => log.flockId === undefined)
      ? [{ key: "none", label: "No flock named" }]
      : []),
  ];

  if (loading) return <p className="text-muted">Loading the egg log…</p>;

  return (
    <div className="flex flex-col gap-density">
      {chips.length <= 2 ? null : (
        <ChipRow label="Filter by flock" chips={chips} value={filter} onChange={setFilter} />
      )}

      {filter === "all" ? null : (
        <FilteredLine
          shown={history.length}
          total={logs.length}
          what={chips.find((chip) => chip.key === filter)?.label ?? ""}
          onClear={() => setFilter("all")}
        />
      )}

      {history.length === 0 ? (
        <EmptyState
          title="Nothing collected yet"
          detail="Log a basket on the Collect tab and it appears here."
        />
      ) : (
        <RowList label="Egg collections">
          {history.map((log) => (
            <ListRow
              key={log.id}
              lead={log.total}
              title={formatDate(log.collectedOn)}
              line={[
                flockName(log.flockId) ?? "Whole place",
                log.breakdown.length === 0 ? undefined : describeBreakdown(log.breakdown),
                log.notes,
              ]}
              label={`Edit ${log.total} egg${log.total === 1 ? "" : "s"} on ${formatDate(log.collectedOn)}`}
              onOpen={() => startEdit(log)}
            />
          ))}
        </RowList>
      )}

      {draft === undefined || editing === undefined ? null : (
        <Modal
          key={editing.id}
          placement="side"
          title={`Editing ${formatDate(editing.collectedOn)}`}
          description="Correct the count, the day, or which coop it came from."
          onClose={closeEdit}
          footer={
            <>
              <Button variant="primary" onClick={() => void saveEdit()}>
                Save changes
              </Button>
              <Button onClick={closeEdit}>Cancel</Button>
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  // The editor closes first, so the confirmation is the
                  // only dialog on screen.
                  const log = editing;
                  closeEdit();
                  void removeLog(log);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-density">
            <Select
              label="Flock"
              value={draft.flockId}
              options={[
                { value: "", label: "Whole place" },
                ...flocks.map((flock) => ({ value: flock.id, label: flock.name })),
              ]}
              error={errors["flockId"]}
              onChange={(event) => setDraft({ ...draft, flockId: event.target.value })}
            />
            <div className="grid grid-cols-2 gap-density">
              <TextInput
                label="Collected"
                type="date"
                value={draft.collectedOn}
                error={errors["collectedOn"]}
                onChange={(event) => setDraft({ ...draft, collectedOn: event.target.value })}
              />
              <TextInput
                label="Total"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                numeric
                disabled={draft.breakdown.length > 0}
                hint={draft.breakdown.length > 0 ? "From the breakdown." : undefined}
                value={
                  draft.breakdown.length > 0 ? String(breakdownSum(draft.breakdown)) : draft.total
                }
                error={errors["total"]}
                onChange={(event) => setDraft({ ...draft, total: event.target.value })}
              />
            </div>

            <BreakdownEditor
              rows={draft.breakdown}
              onChange={(breakdown) => setDraft({ ...draft, breakdown })}
              error={errors["breakdown"]}
            />

            <TextArea
              label="Note"
              rows={3}
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
