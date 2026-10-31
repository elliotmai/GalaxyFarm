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
import {
  addCalendarDays,
  endOfDay,
  formatMoney,
  fromDollars,
  startOfDay,
  type Contact,
  type CrudError,
  type Ulid,
} from "@galaxy-farm/core";
import {
  dispositionTotals,
  eggDispositionSchema,
  EGG_DISPOSITIONS,
  type EggDisposition,
  type EggDispositionKind,
} from "@galaxy-farm/module-poultry";

import { ListRow, RowList } from "@/app/(admin)/admin/horses/_components/list-row";
import { useMutations } from "@/lib/local/mutations";

/**
 * Where the eggs went (spec §5.4).
 *
 * §5.4 calls this "lightweight, optional" and says why: it "keeps the door
 * open for real sales without pretending it's a business". So there is no
 * invoice, no customer, no price list — a date, a count, one of three things
 * that happened to them, and the money if any changed hands.
 *
 * The price is what that lot brought, not a price per egg or per dozen. A
 * per-unit price is the first step into pretending, and the entry can always
 * be split in two when a morning went two ways.
 */

const KIND_LABEL: Readonly<Record<EggDispositionKind, string>> = {
  kept: "Kept",
  given: "Given away",
  sold: "Sold",
};

const KIND_OPTIONS = EGG_DISPOSITIONS.map((kind) => ({ value: kind, label: KIND_LABEL[kind] }));

function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

interface Draft {
  readonly disposedOn: string;
  readonly quantity: string;
  readonly kind: EggDispositionKind;
  readonly contactId: string;
  readonly price: string;
  readonly notes: string;
}

function blank(): Draft {
  return {
    disposedOn: new Date().toISOString().slice(0, 10),
    quantity: "12",
    kind: "kept",
    contactId: "",
    price: "",
    notes: "",
  };
}

export function DispositionsPanel({
  dispositions,
  contacts,
  loading,
  propertyId,
  actorId,
}: {
  readonly dispositions: readonly EggDisposition[];
  readonly contacts: readonly Contact[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const mutations = useMutations<EggDisposition>(
    "eggDispositions",
    "eggDispositions",
    eggDispositionSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<EggDisposition | undefined>();
  const [editDraft, setEditDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** Whether the log form is open. It is a side panel, so the list stays put. */
  const [logging, setLogging] = useState(false);
  const formId = useId();

  // Whole days to the end of today: an entry dated today is stored at midday,
  // and a window ending at this instant would leave this morning's out.
  const now = endOfDay(new Date());
  const month = { from: startOfDay(addCalendarDays(now, -29)), to: now };
  const { byKind, revenue } = dispositionTotals(dispositions, month);

  const contactName = (id: Ulid | undefined) =>
    id === undefined ? undefined : contacts.find((contact) => contact.id === id)?.name;

  function fields(source: Draft) {
    return {
      disposedOn: new Date(`${source.disposedOn}T12:00:00`),
      quantity: source.quantity.trim() === "" ? Number.NaN : Number(source.quantity),
      kind: source.kind,
      contactId: source.contactId === "" ? undefined : (source.contactId as Ulid),
      // Only a sale carries one — the schema refuses a price on eggs that were
      // given away, and a field left filled in after switching the kind is the
      // easiest way to meet that refusal by accident.
      price:
        source.kind !== "sold" || source.price.trim() === ""
          ? undefined
          : fromDollars(Number(source.price)),
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
    setBusy(true);

    try {
      const result = await mutations.create(fields(draft) as never);
      if (!result.ok) {
        reportErrors(result.error);
        return;
      }

      show({
        message: `${KIND_LABEL[draft.kind]} — ${result.value.quantity} eggs`,
        tone: "success",
      });
      // The kind and the date stay: a dozen to the neighbour is usually
      // followed by a dozen to somebody else.
      setDraft({ ...blank(), kind: draft.kind, disposedOn: draft.disposedOn });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(entry: EggDisposition) {
    setEditing(entry);
    setEditDraft({
      disposedOn: entry.disposedOn.toISOString().slice(0, 10),
      quantity: String(entry.quantity),
      kind: entry.kind,
      contactId: entry.contactId ?? "",
      price: entry.price === undefined ? "" : (entry.price.cents / 100).toFixed(2),
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

  async function removeEntry(entry: EggDisposition) {
    const who = contactName(entry.contactId);

    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${KIND_LABEL[entry.kind]} ${entry.quantity}${who === undefined ? "" : ` — ${who}`}, ${formatDate(entry.disposedOn)}`,
      entity: "egg disposition",
      dependents: [],
      consequence: `The basket goes back up by ${entry.quantity}${entry.price === undefined ? "" : `, and ${formatMoney(entry.price)} comes off what the eggs have brought`}.`,
      action: "Delete",
    });
    if (!confirmed) return;

    if (editing?.id === entry.id) closeEdit();

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

  const history = [...dispositions].sort(
    (left, right) => right.disposedOn.getTime() - left.disposedOn.getTime(),
  );

  if (loading) return <p className="text-muted">Loading dispositions…</p>;

  /**
   * The thirty days, as one line of facts. What is left in the basket is in
   * the screen's header rather than here — this is the thirty days, not the
   * balance, and the two would be read as the same window.
   */
  const month30 = [
    `${byKind.get("kept") ?? 0} kept`,
    `${byKind.get("given") ?? 0} given`,
    `${byKind.get("sold") ?? 0} sold`,
    `${formatMoney(revenue)} brought in`,
  ].join(" · ");

  return (
    <div className="flex flex-col gap-density">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Last 30 days: {month30}</p>
        <Button
          variant="primary"
          onClick={() => {
            setErrors({});
            setLogging(true);
          }}
        >
          <span aria-hidden="true">+</span> Log where some went
        </Button>
      </div>

      {history.length === 0 ? (
        <EmptyState
          title="Nothing logged"
          detail="Optional. Log the ones sold or given away and the basket starts telling the truth."
        />
      ) : (
        <RowList label="Egg dispositions">
          {history.map((entry) => (
            <ListRow
              key={entry.id}
              lead={entry.quantity}
              title={KIND_LABEL[entry.kind]}
              line={[
                formatDate(entry.disposedOn),
                contactName(entry.contactId),
                entry.price === undefined ? undefined : formatMoney(entry.price),
                entry.notes,
              ]}
              label={`Edit ${KIND_LABEL[entry.kind]} ${entry.quantity}, ${formatDate(entry.disposedOn)}`}
              onOpen={() => startEdit(entry)}
            />
          ))}
        </RowList>
      )}

      {/*
        Optional, and deliberately small: a date, a count, and one of three
        things that happened to them. It stays open after each entry — a
        dozen to the neighbour is usually followed by a dozen to somebody else.
      */}
      {!logging ? null : (
        <Modal
          placement="side"
          title="Log where some went"
          onClose={() => setLogging(false)}
          footer={
            <>
              <Button type="submit" form={formId} variant="primary" busy={busy}>
                Log it
              </Button>
              <Button onClick={() => setLogging(false)}>Done</Button>
            </>
          }
        >
          <form
            id={formId}
            onSubmit={(event) => void record(event)}
            className="flex flex-col gap-density"
          >
            <div className="grid grid-cols-2 gap-density">
              <TextInput
                label="When"
                type="date"
                required
                value={draft.disposedOn}
                error={errors["disposedOn"]}
                onChange={(event) => setDraft({ ...draft, disposedOn: event.target.value })}
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
            </div>
            <Select
              label="What happened"
              value={draft.kind}
              options={KIND_OPTIONS}
              error={errors["kind"]}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  kind: event.target.value as EggDispositionKind,
                  // Dropped on the way out of a sale, so switching back and
                  // forth cannot leave a price on eggs that were given away.
                  price: event.target.value === "sold" ? draft.price : "",
                })
              }
            />
            <Select
              label="Who"
              placeholder="Nobody in particular"
              options={[
                { value: "", label: "Nobody in particular" },
                ...contacts.map((contact) => ({ value: contact.id, label: contact.name })),
              ]}
              value={draft.contactId}
              error={errors["contactId"]}
              onChange={(event) => setDraft({ ...draft, contactId: event.target.value })}
            />
            <TextInput
              label="What it brought ($)"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              numeric
              disabled={draft.kind !== "sold"}
              hint={
                draft.kind === "sold"
                  ? "The total for these eggs, not a price each."
                  : "Only a sale carries a price."
              }
              value={draft.price}
              error={errors["price"]}
              onChange={(event) => setDraft({ ...draft, price: event.target.value })}
            />
            <TextArea
              label="Note"
              rows={2}
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </form>
        </Modal>
      )}

      {editDraft === undefined || editing === undefined ? null : (
        <Modal
          key={editing.id}
          placement="side"
          title={`Editing ${KIND_LABEL[editing.kind]} ${editing.quantity}`}
          description="Correct the count, the day, who, or what they brought."
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
            <div className="grid grid-cols-2 gap-density">
              <TextInput
                label="When"
                type="date"
                value={editDraft.disposedOn}
                error={errors["disposedOn"]}
                onChange={(event) => setEditDraft({ ...editDraft, disposedOn: event.target.value })}
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
            </div>
            <Select
              label="What happened"
              value={editDraft.kind}
              options={KIND_OPTIONS}
              error={errors["kind"]}
              onChange={(event) =>
                setEditDraft({
                  ...editDraft,
                  kind: event.target.value as EggDispositionKind,
                  price: event.target.value === "sold" ? editDraft.price : "",
                })
              }
            />
            <Select
              label="Who"
              options={[
                { value: "", label: "Nobody in particular" },
                ...contacts.map((contact) => ({ value: contact.id, label: contact.name })),
              ]}
              value={editDraft.contactId}
              error={errors["contactId"]}
              onChange={(event) => setEditDraft({ ...editDraft, contactId: event.target.value })}
            />
            <TextInput
              label="What it brought ($)"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              numeric
              disabled={editDraft.kind !== "sold"}
              value={editDraft.price}
              error={errors["price"]}
              onChange={(event) => setEditDraft({ ...editDraft, price: event.target.value })}
            />
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
