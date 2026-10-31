"use client";

import { useId, useState } from "react";

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
import {
  ChipRow,
  FilteredLine,
  ListRow,
  RowList,
} from "@/app/(admin)/admin/horses/_components/list-row";
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
 *
 * Two parts: `RecordChange`, the form a new entry is written in — a side
 * panel, opened from the header or from a flock's row, so it never pushes the
 * list down — and `HeadcountPanel`, the history as rows, each opening its own
 * editor.
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

function errorsFrom(error: CrudError): Record<string, string> {
  return error.kind === "validation"
    ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
    : { quantity: "Could not save. Check the fields and try again." };
}

/**
 * Record a change — every bird in or out goes through here.
 *
 * It stays open after an entry is written: a bad night is several entries in
 * a row, and closing on each one is a panel reopened four times.
 */
export function RecordChange({
  flocks,
  adjustments,
  propertyId,
  actorId,
  focusedFlockId,
  onClose,
}: {
  readonly flocks: readonly Flock[];
  readonly adjustments: readonly FlockAdjustment[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** The flock whose row opened this, if that is how we arrived. */
  readonly focusedFlockId?: Ulid | undefined;
  readonly onClose: () => void;
}) {
  const mutations = useMutations<FlockAdjustment>(
    "flockAdjustments",
    "flockAdjustments",
    flockAdjustmentSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const live = flocks.filter((flock) => flock.active);
  const [draft, setDraft] = useState<Draft>(() => blank(focusedFlockId ?? live[0]?.id ?? ""));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const formId = useId();

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
        setErrors(errorsFrom(result.error));
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

  return (
    <Modal
      placement="side"
      title="Record a change"
      description={
        countNow === undefined
          ? undefined
          : `${chosenFlock?.name} has ${countNow} bird${countNow === 1 ? "" : "s"} today`
      }
      onClose={onClose}
      footer={
        live.length === 0 ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            {/* A submit tied to the form by id, so Enter in a field still
                records, as it did when this was a form on the page. */}
            <Button type="submit" form={formId} variant="primary" busy={busy}>
              Record it
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        )
      }
    >
      {live.length === 0 ? (
        <EmptyState
          title="No flocks to log against"
          detail="Add a flock first. A headcount entry belongs to one."
        />
      ) : (
        <form
          id={formId}
          onSubmit={(event) => void record(event)}
          className="flex flex-col gap-density"
        >
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
          <div className="grid grid-cols-2 gap-density">
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
            hint="What got in, which bird, where the hole was."
            value={draft.notes}
            error={errors["notes"]}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </form>
      )}
    </Modal>
  );
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
  /** The flock to show the history of first, if one was picked. */
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

  const [editing, setEditing] = useState<FlockAdjustment | undefined>();
  const [editDraft, setEditDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<string>(focusedFlockId ?? "all");

  const flockName = (id: Ulid) => flocks.find((flock) => flock.id === id)?.name ?? "Unknown flock";

  const shown = filter === "all" ? adjustments : adjustments.filter((e) => e.flockId === filter);
  const history = [...shown].sort(
    (left, right) => right.occurredOn.getTime() - left.occurredOn.getTime(),
  );

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
      setErrors(errorsFrom(result.error));
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

  if (loading) return <p className="text-muted">Loading the headcount log…</p>;

  return (
    <div className="flex flex-col gap-density">
      {/*
        The flocks as chips: there are a handful, and "what happened to the
        bantams" is one press. The whole history is the default, and the only
        way to correct a count is to correct the entry that caused it.
      */}
      {flocks.length < 2 ? null : (
        <ChipRow
          label="Filter by flock"
          value={filter}
          onChange={setFilter}
          chips={[
            { key: "all", label: "Every flock" },
            ...flocks.map((flock) => ({ key: flock.id as string, label: flock.name })),
          ]}
        />
      )}

      {filter === "all" ? null : (
        <FilteredLine
          shown={history.length}
          total={adjustments.length}
          what={flockName(filter as Ulid)}
          onClear={() => setFilter("all")}
        />
      )}

      {history.length === 0 ? (
        <EmptyState
          title="Nothing logged yet"
          detail="Birds bought, hatched, lost, culled and sold all land here."
        />
      ) : (
        <RowList label="Headcount log">
          {history.map((entry) => (
            <ListRow
              key={entry.id}
              // The sign is the point of the row, so it leads, in the colour
              // that says which way the count went.
              title={
                <>
                  <span
                    className={ADJUSTMENT_DIRECTION[entry.reason] > 0 ? "text-calm" : "text-danger"}
                  >
                    {signed(entry)}
                  </span>{" "}
                  {REASON_LABEL[entry.reason]}
                </>
              }
              line={[flockName(entry.flockId), formatDate(entry.occurredOn), entry.notes]}
              onOpen={() => startEdit(entry)}
            />
          ))}
        </RowList>
      )}

      {editDraft === undefined || editing === undefined ? null : (
        <Modal
          key={editing.id}
          placement="side"
          title={`Editing ${REASON_LABEL[editing.reason]} ${editing.quantity}`}
          description="Correct what happened, to which flock, and when."
          onClose={closeEdit}
          footer={
            <>
              <Button variant="primary" onClick={() => void saveEdit()}>
                Save changes
              </Button>
              <Button onClick={closeEdit}>Cancel</Button>
              {/* The editor closes first, so the confirmation is the only
                  dialog on screen. */}
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  const entry = editing;
                  closeEdit();
                  void removeEntry(entry);
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
            <div className="grid grid-cols-2 gap-density">
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
          </div>
        </Modal>
      )}
    </div>
  );
}
