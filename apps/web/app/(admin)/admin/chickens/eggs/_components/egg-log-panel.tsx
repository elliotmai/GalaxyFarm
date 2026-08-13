"use client";

import { useState } from "react";

import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Modal,
  Section,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
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
import { useMutations } from "@/lib/local/mutations";

/**
 * Every collection, and the way to correct one (spec §4.5 clause 1).
 *
 * The Collect tab writes; this one is the rest of the surface that clause 1
 * asks for — find it, read it, fix it, remove it. Nothing on this screen is a
 * derived read model, so every number the tiles and the trends show can be
 * traced back to a row here and corrected at the source.
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

  const columns: readonly Column<EggLog>[] = [
    {
      key: "when",
      header: "Collected",
      primary: true,
      render: (log) => formatDate(log.collectedOn),
    },
    { key: "flock", header: "Flock", render: (log) => flockName(log.flockId) ?? "Whole place" },
    { key: "total", header: "Eggs", numeric: true, render: (log) => log.total },
    {
      key: "breakdown",
      header: "Breakdown",
      render: (log) =>
        log.breakdown.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          describeBreakdown(log.breakdown)
        ),
    },
    { key: "notes", header: "Note", render: (log) => log.notes ?? "—" },
    {
      key: "actions",
      header: "",
      render: (log) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => startEdit(log)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void removeLog(log)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  if (loading) return <p className="text-muted">Loading the egg log…</p>;

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Every collection"
        actions={
          <Select
            label="Flock"
            hideLabel
            value={filter}
            options={[
              { value: "all", label: "Every flock" },
              ...flocks.map((flock) => ({ value: flock.id, label: flock.name })),
              { value: "none", label: "No flock named" },
            ]}
            onChange={(event) => setFilter(event.target.value)}
          />
        }
      >
        <Card>
          <DataTable
            caption="Egg collections"
            columns={columns}
            rows={history}
            rowKey={(log) => log.id}
            empty={
              <EmptyState
                title="Nothing collected yet"
                detail="Log a basket on the Collect tab and it appears here, where it can be corrected or removed."
              />
            }
          />
        </Card>
      </Section>

      {draft === undefined || editing === undefined ? null : (
        <Modal
          key={editing.id}
          size="wide"
          title={`Editing ${formatDate(editing.collectedOn)}`}
          description="Correct the count, the day, or which coop it came from."
          onClose={closeEdit}
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-3">
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
                hint={
                  draft.breakdown.length > 0 ? "Counted from the breakdown." : "Eggs in the basket."
                }
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

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void saveEdit()}>
                Save changes
              </Button>
              <Button onClick={closeEdit}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
