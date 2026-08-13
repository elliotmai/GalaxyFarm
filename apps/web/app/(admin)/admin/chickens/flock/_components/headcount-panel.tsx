"use client";

import { useState } from "react";

import {
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
import { endOfDay, type CrudError, type Ulid } from "@galaxy-farm/core";
import {
  ADJUSTMENT_DIRECTION,
  flockAdjustmentSchema,
  headCountOn,
  type AdjustmentReason,
  type Flock,
  type FlockAdjustment,
} from "@galaxy-farm/module-poultry";

import {
  REASON_HINT,
  REASON_LABEL,
  REASON_OPTIONS,
} from "@/app/(admin)/admin/chickens/flock/_components/reasons";
import { useMutations } from "@/lib/local/mutations";

/**
 * The headcount log (spec §4.5, §5.4).
 *
 * This is the only place a flock's count changes, and that is deliberate.
 * §4.5 puts flock headcount among the running totals maintained by a log:
 * "the log entries carry the CRUD and the total re-derives; the total itself
 * is never directly editable". A field somebody edits from 18 to 14 records
 * nothing — not when, not why, not whether it happens every spring.
 *
 * Which way each reason moves the count is the domain's business, not this
 * screen's: `ADJUSTMENT_DIRECTION` decides, so a new reason cannot arrive with
 * the sign wired up differently here than in the count everything else reads.
 */

function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "+6" or "−4", with the sign the domain gives the reason. */
function signed(entry: FlockAdjustment): string {
  return ADJUSTMENT_DIRECTION[entry.reason] > 0 ? `+${entry.quantity}` : `−${entry.quantity}`;
}

interface Draft {
  readonly flockId: string;
  readonly reason: AdjustmentReason;
  readonly quantity: string;
  readonly occurredOn: string;
  readonly notes: string;
}

function blank(flockId: string): Draft {
  return {
    flockId,
    reason: "died",
    quantity: "1",
    occurredOn: new Date().toISOString().slice(0, 10),
    notes: "",
  };
}

export function HeadcountPanel({
  flocks,
  adjustments,
  loading,
  propertyId,
  actorId,
  focusedFlockId,
}: {
  readonly flocks: readonly Flock[];
  readonly adjustments: readonly FlockAdjustment[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** The flock whose card sent us here, if that is how we arrived. */
  readonly focusedFlockId?: Ulid;
}) {
  const mutations = useMutations<FlockAdjustment>(
    "flockAdjustments",
    "flockAdjustments",
    flockAdjustmentSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const live = flocks.filter((flock) => flock.active);
  const [draft, setDraft] = useState<Draft>(() => blank(focusedFlockId ?? live[0]?.id ?? ""));
  const [editing, setEditing] = useState<FlockAdjustment | undefined>();
  const [editDraft, setEditDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>(focusedFlockId ?? "all");

  const flockName = (id: Ulid) => flocks.find((flock) => flock.id === id)?.name ?? "Unknown flock";

  /**
   * Which flock the form is actually on.
   *
   * The flocks arrive from a live query, so the first render has none of them
   * and the draft starts empty. Left as state alone the select would show the
   * first flock while the draft still held "", and pressing Record it would
   * answer "choose a flock" about the flock visibly chosen.
   */
  const chosen = live.some((flock) => flock.id === draft.flockId)
    ? draft.flockId
    : (live[0]?.id ?? "");

  const chosenFlock = flocks.find((flock) => flock.id === chosen);
  // End of today: an entry dated today is stored at midday, and a count asked
  // as of six in the morning would not include the entry just written.
  const now = endOfDay(new Date());
  const countNow =
    chosenFlock === undefined ? undefined : headCountOn(chosenFlock, adjustments, now);

  const shown = filter === "all" ? adjustments : adjustments.filter((e) => e.flockId === filter);
  const history = [...shown].sort(
    (left, right) => right.occurredOn.getTime() - left.occurredOn.getTime(),
  );

  function fields(source: Draft) {
    return {
      flockId: source.flockId as Ulid,
      reason: source.reason,
      quantity: source.quantity.trim() === "" ? Number.NaN : Number(source.quantity),
      // Midday, so a date typed here is the same day in every timezone the
      // farm's devices might be set to.
      occurredOn: new Date(`${source.occurredOn}T12:00:00`),
      notes: source.notes.trim() === "" ? undefined : source.notes.trim(),
    };
  }

  function reportErrors(error: CrudError) {
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { quantity: "Could not save. Check the fields and try again." },
    );
  }

  async function record(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});

    if (chosen === "") {
      setErrors({ flockId: "Add a flock before logging a change to one" });
      return;
    }

    setBusy(true);
    try {
      const result = await mutations.create(fields({ ...draft, flockId: chosen }) as never);
      if (!result.ok) {
        reportErrors(result.error);
        return;
      }

      // Counted against the record that was actually written, including it —
      // the live query has not come back yet, and a toast quoting the old
      // count is a toast that says the entry did not take.
      const after =
        chosenFlock === undefined
          ? undefined
          : headCountOn(chosenFlock, [...adjustments, result.value], now);

      show({
        message:
          after === undefined
            ? "Change recorded"
            : `${REASON_LABEL[draft.reason]} ${result.value.quantity} — ${chosenFlock?.name} is on ${after}`,
        tone: "success",
      });
      // The flock, the reason and the date stay: a bad night is several
      // entries in a row, and re-choosing the coop each time is where an entry
      // lands against the wrong one.
      setDraft({ ...blank(chosen), reason: draft.reason, occurredOn: draft.occurredOn });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(entry: FlockAdjustment) {
    setEditing(entry);
    setEditDraft({
      flockId: entry.flockId,
      reason: entry.reason,
      quantity: String(entry.quantity),
      occurredOn: entry.occurredOn.toISOString().slice(0, 10),
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

  async function removeEntry(entry: FlockAdjustment) {
    const confirmed = await confirmDelete({
      // Standard tier: one line in a history, with nothing hanging off it.
      tier: "standard",
      recordName: `${REASON_LABEL[entry.reason]} ${entry.quantity} — ${flockName(entry.flockId)}, ${formatDate(entry.occurredOn)}`,
      entity: "headcount entry",
      dependents: [],
      consequence: `The flock's count moves by ${signed(entry)} and stays that way.`,
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

  const columns: readonly Column<FlockAdjustment>[] = [
    {
      key: "flock",
      header: "Flock",
      primary: true,
      render: (entry) => flockName(entry.flockId),
    },
    { key: "when", header: "When", render: (entry) => formatDate(entry.occurredOn) },
    {
      key: "change",
      header: "Change",
      numeric: true,
      render: (entry) => (
        <Pill tone={ADJUSTMENT_DIRECTION[entry.reason] > 0 ? "calm" : "danger"}>
          {signed(entry)}
        </Pill>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (entry) => REASON_LABEL[entry.reason],
    },
    { key: "notes", header: "Note", render: (entry) => entry.notes ?? "—" },
    {
      key: "actions",
      header: "",
      render: (entry) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => startEdit(entry)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void removeEntry(entry)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  if (loading) return <p className="text-muted">Loading the headcount log…</p>;

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Record a change"
        description="Every bird in or out goes through here. The count on the flock follows from it and is never typed."
      >
        {live.length === 0 ? (
          <EmptyState
            title="No flocks to log against"
            detail="Add a flock first. A headcount entry belongs to one, and there is nothing yet for it to move."
          />
        ) : (
          <form onSubmit={(event) => void record(event)} className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Flock"
                value={chosen}
                error={errors["flockId"]}
                options={live.map((flock) => ({ value: flock.id, label: flock.name }))}
                onChange={(event) => setDraft({ ...draft, flockId: event.target.value })}
              />
              <Select
                label="What happened"
                value={draft.reason}
                hint={REASON_HINT[draft.reason]}
                options={REASON_OPTIONS}
                error={errors["reason"]}
                onChange={(event) =>
                  setDraft({ ...draft, reason: event.target.value as AdjustmentReason })
                }
              />
              <TextInput
                label="How many"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                numeric
                required
                value={draft.quantity}
                error={errors["quantity"]}
                onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
              />
              <TextInput
                label="When"
                type="date"
                required
                value={draft.occurredOn}
                error={errors["occurredOn"]}
                onChange={(event) => setDraft({ ...draft, occurredOn: event.target.value })}
              />
            </div>
            <TextArea
              label="Note"
              rows={2}
              hint="What got in, which bird, where the hole was. This is the half a bare number cannot hold."
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" busy={busy}>
                Record it
              </Button>
              {countNow === undefined ? null : (
                <span className="text-sm text-muted">
                  {chosenFlock?.name} has {countNow} bird{countNow === 1 ? "" : "s"} today.
                </span>
              )}
            </div>
          </form>
        )}
      </Section>

      <Section
        title="Every change"
        description="The whole history, and the only way to correct one is to correct the entry that caused it."
        actions={
          <Select
            label="Flock"
            hideLabel
            value={filter}
            options={[
              { value: "all", label: "Every flock" },
              ...flocks.map((flock) => ({ value: flock.id, label: flock.name })),
            ]}
            onChange={(event) => setFilter(event.target.value)}
          />
        }
      >
        <Card>
          <DataTable
            caption="Headcount log"
            columns={columns}
            rows={history}
            rowKey={(entry) => entry.id}
            empty={
              <EmptyState
                title="Nothing logged yet"
                detail="Birds bought, hatched, lost, culled and sold all land here, and the count on each flock follows."
              />
            }
          />
        </Card>
      </Section>

      {editDraft === undefined || editing === undefined ? null : (
        <Modal
          key={editing.id}
          size="wide"
          title={`Editing ${REASON_LABEL[editing.reason]} ${editing.quantity}`}
          description="Correct what happened, to which flock, and when."
          onClose={closeEdit}
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <Select
                label="Flock"
                value={editDraft.flockId}
                error={errors["flockId"]}
                options={flocks.map((flock) => ({ value: flock.id, label: flock.name }))}
                onChange={(event) => setEditDraft({ ...editDraft, flockId: event.target.value })}
              />
              <Select
                label="What happened"
                value={editDraft.reason}
                options={REASON_OPTIONS}
                error={errors["reason"]}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, reason: event.target.value as AdjustmentReason })
                }
              />
              <TextInput
                label="How many"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                numeric
                value={editDraft.quantity}
                error={errors["quantity"]}
                onChange={(event) => setEditDraft({ ...editDraft, quantity: event.target.value })}
              />
              <TextInput
                label="When"
                type="date"
                value={editDraft.occurredOn}
                error={errors["occurredOn"]}
                onChange={(event) => setEditDraft({ ...editDraft, occurredOn: event.target.value })}
              />
            </div>
            <TextArea
              label="Note"
              rows={3}
              value={editDraft.notes}
              error={errors["notes"]}
              onChange={(event) => setEditDraft({ ...editDraft, notes: event.target.value })}
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
