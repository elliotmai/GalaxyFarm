"use client";

import { useState } from "react";

import { Select, TextInput, useConfirmDelete, useToast, optionLabel } from "@galaxy-farm/ui";
import {
  displayName,
  fromDollars,
  UNITS,
  type Animal,
  type Contact,
  type Ulid,
  type Unit,
  type Zone,
} from "@galaxy-farm/core";
import {
  DURABLE_CONDITIONS,
  durableAssignmentSchema,
  SUPPLY_CATEGORIES,
  SUPPLY_KINDS,
  supplyItemSchema,
  supplyPurchaseSchema,
  supplyUsageSchema,
  type DurableAssignment,
  type DurableCondition,
  type SupplyCategory,
  type SupplyItem,
  type SupplyKind,
  type SupplyPurchase,
  type SupplyUsage,
} from "@galaxy-farm/module-supplies";

import { useMutations } from "@/lib/local/mutations";

import { KitFormPanel as FormPanel } from "../../equipment/_components/kit-controls";
import {
  atNoon,
  errorMessage,
  formatDate,
  isEnding,
  qty,
  today,
  unitLabel,
} from "./supplies-format";

/**
 * The four things the supplies screen writes, each in a side panel (§5.11).
 *
 * An item, a purchase, a use, and a durable's assignment or retirement. Each
 * mounts fresh when it opens, so its state starts from the record being
 * edited — or, for one started from a row on the shelf, from that item — and
 * the list behind it never moves.
 */

interface Common {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
  /** Present when editing: closes the panel and asks to delete. */
  readonly onDelete?: (() => void) | undefined;
}

/* ------------------------------------------------------------------ items */

export function ItemForm({
  editing,
  propertyId,
  actorId,
  onClose,
  onDelete,
}: Common & { readonly editing?: SupplyItem | undefined }) {
  const api = useMutations<SupplyItem>(
    "supplyItems",
    "supplyItems",
    supplyItemSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [draft, setDraft] = useState(() => ({
    name: editing?.name ?? "",
    kind: editing?.kind ?? ("consumable" as SupplyKind),
    category: editing?.category ?? ("general" as SupplyCategory),
    unit: editing?.unit ?? ("each" as Unit),
    openingQty: editing === undefined ? "0" : String(editing.openingQty),
    reorderThreshold:
      editing?.reorderThreshold === undefined ? "" : String(editing.reorderThreshold),
    storageLocation: editing?.storageLocation ?? "",
    notes: editing?.notes ?? "",
  }));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        name: draft.name.trim(),
        kind: draft.kind,
        category: draft.category,
        unit: draft.unit,
        openingQty: Number(draft.openingQty || "0"),
        // A durable carries none: you do not reorder show halters when you are
        // down to two, you buy one when one breaks. The schema refuses it, so
        // the form does not offer it either.
        reorderThreshold:
          draft.kind === "durable" || draft.reorderThreshold === ""
            ? undefined
            : Number(draft.reorderThreshold),
        storageLocation:
          draft.storageLocation.trim() === "" ? undefined : draft.storageLocation.trim(),
        notes: draft.notes.trim() === "" ? undefined : draft.notes.trim(),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<SupplyItem>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({ message: editing === undefined ? "Item added" : "Item updated" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPanel
      title={editing === undefined ? "Add an item" : `Edit ${editing.name}`}
      // The one thing about the count that is easy to get wrong.
      description="The opening count is what is on the shelf today. After that it is purchases and use."
      submitLabel={editing === undefined ? "Add item" : "Save item"}
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
      onDelete={onDelete}
    >
      <TextInput
        label="Name"
        className="sm:col-span-2"
        placeholder="Pine shavings"
        value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        required
      />
      <Select
        label="Kind"
        hint="Drawn down, or counted and assigned."
        value={draft.kind}
        onChange={(event) => setDraft({ ...draft, kind: event.target.value as SupplyKind })}
        options={SUPPLY_KINDS.map((value) => ({ value, label: value }))}
      />
      <Select
        label="Category"
        value={draft.category}
        onChange={(event) => setDraft({ ...draft, category: event.target.value as SupplyCategory })}
        options={SUPPLY_CATEGORIES.map((value) => ({
          value,
          label: optionLabel(value),
        }))}
      />
      <Select
        label="Unit"
        value={draft.unit}
        onChange={(event) => setDraft({ ...draft, unit: event.target.value as Unit })}
        options={UNITS.map((value) => ({ value, label: unitLabel(value) }))}
      />
      <TextInput
        label="Opening count"
        type="number"
        inputMode="decimal"
        numeric
        value={draft.openingQty}
        onChange={(event) => setDraft({ ...draft, openingQty: event.target.value })}
        required
      />
      {draft.kind === "consumable" ? (
        <TextInput
          label="Reorder at"
          hint="Where there is still time to buy some."
          type="number"
          inputMode="decimal"
          numeric
          value={draft.reorderThreshold}
          onChange={(event) => setDraft({ ...draft, reorderThreshold: event.target.value })}
        />
      ) : null}
      <TextInput
        label="Where it lives"
        value={draft.storageLocation}
        onChange={(event) => setDraft({ ...draft, storageLocation: event.target.value })}
      />
      <TextInput
        label="Notes"
        value={draft.notes}
        onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
      />
    </FormPanel>
  );
}

/* -------------------------------------------------------------- purchases */

export function PurchaseForm({
  items,
  contacts,
  editing,
  start,
  propertyId,
  actorId,
  onClose,
  onDelete,
}: Common & {
  readonly items: readonly SupplyItem[];
  readonly contacts: readonly Contact[];
  readonly editing?: SupplyPurchase | undefined;
  /** The item a new purchase starts on. */
  readonly start?: Ulid | undefined;
}) {
  const api = useMutations<SupplyPurchase>(
    "supplyPurchases",
    "supplyPurchases",
    supplyPurchaseSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [supplyItemId, setSupplyItemId] = useState<string>(editing?.supplyItemId ?? start ?? "");
  const [quantity, setQuantity] = useState(editing === undefined ? "" : String(editing.quantity));
  const [unitCost, setUnitCost] = useState(
    editing === undefined ? "" : (editing.unitCost.cents / 100).toFixed(2),
  );
  const [vendorContactId, setVendorContactId] = useState<string>(editing?.vendorContactId ?? "");
  const [purchasedOn, setPurchasedOn] = useState(
    editing === undefined ? today() : editing.purchasedOn.toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (supplyItemId === "") {
      setError("Choose the item");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        supplyItemId: supplyItemId as Ulid,
        quantity: Number(quantity),
        unitCost: fromDollars(Number(unitCost)),
        vendorContactId: vendorContactId === "" ? undefined : (vendorContactId as Ulid),
        purchasedOn: atNoon(purchasedOn),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<SupplyPurchase>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({ message: editing === undefined ? "Purchase recorded" : "Purchase updated" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    // The same shape as feed on purpose: both land on the same boarding
    // invoice, and a client would notice if the two were costed differently.
    <FormPanel
      title={editing === undefined ? "Record a purchase" : "Edit this purchase"}
      submitLabel={editing === undefined ? "Record purchase" : "Save purchase"}
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
      onDelete={onDelete}
    >
      <Select
        label="Item"
        className="sm:col-span-2"
        value={supplyItemId}
        placeholder="Choose an item"
        onChange={(event) => setSupplyItemId(event.target.value)}
        options={items.map((item) => ({
          value: item.id,
          label: `${item.name} (${unitLabel(item.unit)})`,
        }))}
        required
      />
      <TextInput
        label="Quantity"
        type="number"
        inputMode="decimal"
        numeric
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        required
      />
      <TextInput
        label="Cost each ($)"
        type="number"
        inputMode="decimal"
        step="0.01"
        numeric
        value={unitCost}
        onChange={(event) => setUnitCost(event.target.value)}
        required
      />
      <Select
        label="Vendor"
        value={vendorContactId}
        placeholder="Not recorded"
        onChange={(event) => setVendorContactId(event.target.value)}
        options={contacts.map((contact) => ({ value: contact.id, label: contact.name }))}
      />
      <TextInput
        label="Bought"
        type="date"
        value={purchasedOn}
        onChange={(event) => setPurchasedOn(event.target.value)}
        required
      />
      <TextInput
        label="Notes"
        className="sm:col-span-2"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
    </FormPanel>
  );
}

/* ------------------------------------------------------------------- used */

export function UsageForm({
  items,
  animals,
  zones,
  editing,
  start,
  propertyId,
  actorId,
  onClose,
  onDelete,
}: Common & {
  readonly items: readonly SupplyItem[];
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly editing?: SupplyUsage | undefined;
  /** The item a new entry starts on — "used some shavings" from their row. */
  readonly start?: Ulid | undefined;
}) {
  const api = useMutations<SupplyUsage>(
    "supplyUsage",
    "supplyUsage",
    supplyUsageSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [supplyItemId, setSupplyItemId] = useState<string>(editing?.supplyItemId ?? start ?? "");
  const [quantity, setQuantity] = useState(editing === undefined ? "" : String(editing.quantity));
  const [usedOn, setUsedOn] = useState(
    editing === undefined ? today() : editing.usedOn.toISOString().slice(0, 10),
  );
  const [animalId, setAnimalId] = useState<string>(editing?.animalId ?? "");
  const [zoneId, setZoneId] = useState<string>(editing?.zoneId ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (supplyItemId === "") {
      setError("Choose the item");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        supplyItemId: supplyItemId as Ulid,
        quantity: Number(quantity),
        usedOn: atNoon(usedOn),
        animalId: animalId === "" ? undefined : (animalId as Ulid),
        zoneId: zoneId === "" ? undefined : (zoneId as Ulid),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<SupplyUsage>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({
        message:
          animalId === ""
            ? "Recorded against the shelf"
            : "Recorded — it goes on that calf's costs",
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPanel
      title={editing === undefined ? "Record what was used" : "Edit this entry"}
      // Naming the calf is the mechanism behind the rule that owners pay for
      // feed and supplies, so it is the one thing said up front.
      description="Naming the calf puts it on that calf's costs."
      submitLabel={editing === undefined ? "Record usage" : "Save entry"}
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
      onDelete={onDelete}
    >
      <Select
        label="Item"
        className="sm:col-span-2"
        value={supplyItemId}
        placeholder="Choose an item"
        onChange={(event) => setSupplyItemId(event.target.value)}
        options={items
          .filter((item) => item.kind === "consumable")
          .map((item) => ({
            value: item.id,
            label: `${item.name} (${unitLabel(item.unit)})`,
          }))}
        required
      />
      <TextInput
        label="Quantity"
        type="number"
        inputMode="decimal"
        numeric
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        required
      />
      <TextInput
        label="Used"
        type="date"
        value={usedOn}
        onChange={(event) => setUsedOn(event.target.value)}
        required
      />
      <Select
        label="On which animal"
        value={animalId}
        placeholder="Not one in particular"
        onChange={(event) => setAnimalId(event.target.value)}
        options={animals
          .filter((animal) => animal.status === "active")
          .map((animal) => ({ value: animal.id, label: displayName(animal) }))}
      />
      <Select
        label="…or which pen"
        value={zoneId}
        placeholder="Not one in particular"
        onChange={(event) => setZoneId(event.target.value)}
        options={zones.map((zone) => ({ value: zone.id, label: zone.name }))}
      />
      <TextInput
        label="Notes"
        className="sm:col-span-2"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
    </FormPanel>
  );
}

/* --------------------------------------------------------------- durables */

export function DurableForm({
  durables,
  animals,
  zones,
  editing,
  start,
  propertyId,
  actorId,
  onClose,
  onDelete,
}: Common & {
  readonly durables: readonly SupplyItem[];
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly editing?: DurableAssignment | undefined;
  /** The durable a new assignment starts on. */
  readonly start?: Ulid | undefined;
}) {
  const api = useMutations<DurableAssignment>(
    "durableAssignments",
    "durableAssignments",
    durableAssignmentSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [supplyItemId, setSupplyItemId] = useState<string>(editing?.supplyItemId ?? start ?? "");
  const [quantity, setQuantity] = useState(editing === undefined ? "1" : String(editing.quantity));
  const [condition, setCondition] = useState<DurableCondition>(editing?.condition ?? "good");
  const [animalId, setAnimalId] = useState<string>(editing?.animalId ?? "");
  const [zoneId, setZoneId] = useState<string>(editing?.zoneId ?? "");
  const [from, setFrom] = useState(
    editing === undefined ? today() : editing.periodFrom.toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(
    editing?.periodTo === undefined ? "" : editing.periodTo.toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const closing = isEnding({ condition });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (supplyItemId === "") {
      setError("Choose the item");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        supplyItemId: supplyItemId as Ulid,
        quantity: Number(quantity),
        condition,
        animalId: animalId === "" ? undefined : (animalId as Ulid),
        zoneId: zoneId === "" ? undefined : (zoneId as Ulid),
        periodFrom: atNoon(from),
        // Retiring something without closing the assignment leaves a scrapped
        // halter still showing as being on a calf; the schema refuses it, and
        // today is the answer somebody means anyway.
        periodTo: to === "" ? (closing ? new Date() : undefined) : atNoon(to),
        notes: notes.trim() === "" ? undefined : notes.trim(),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<DurableAssignment>);

      if (!result.ok) {
        setError(errorMessage(result.error));
        return;
      }

      show({ message: editing === undefined ? "Assigned" : "Assignment updated" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPanel
      title={editing === undefined ? "Assign, or retire" : "Edit this assignment"}
      description="Retired or lost takes it off the in-service count and closes the assignment."
      submitLabel={editing === undefined ? "Record it" : "Save assignment"}
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
      onDelete={onDelete}
    >
      <Select
        label="Item"
        className="sm:col-span-2"
        value={supplyItemId}
        placeholder="Choose a durable"
        onChange={(event) => setSupplyItemId(event.target.value)}
        options={durables.map((item) => ({ value: item.id, label: item.name }))}
        required
      />
      <TextInput
        label="How many"
        type="number"
        inputMode="numeric"
        numeric
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        required
      />
      <Select
        label="Condition"
        value={condition}
        onChange={(event) => setCondition(event.target.value as DurableCondition)}
        options={DURABLE_CONDITIONS.map((value) => ({ value, label: value }))}
      />
      <Select
        label="With which animal"
        value={animalId}
        placeholder="Nobody in particular"
        onChange={(event) => setAnimalId(event.target.value)}
        options={animals
          .filter((animal) => animal.status === "active")
          .map((animal) => ({ value: animal.id, label: displayName(animal) }))}
      />
      <Select
        label="…or which pen"
        value={zoneId}
        placeholder="Nowhere in particular"
        onChange={(event) => setZoneId(event.target.value)}
        options={zones.map((zone) => ({ value: zone.id, label: zone.name }))}
      />
      <TextInput
        label="From"
        type="date"
        value={from}
        onChange={(event) => setFrom(event.target.value)}
        required
      />
      <TextInput
        label="Until"
        hint={closing ? "Today if left blank." : "Blank while it is still out."}
        type="date"
        value={to}
        onChange={(event) => setTo(event.target.value)}
      />
      <TextInput
        label="Notes"
        className="sm:col-span-2"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
    </FormPanel>
  );
}

/* --------------------------------------------------------------- deletes */

/**
 * The deletes, each behind its confirmation, and bringing a durable back.
 *
 * Owned by the screen rather than the panels, because a panel closes before
 * its confirmation opens — the dialog has to belong to something still there.
 */
export function useSupplyActions({
  items,
  holds,
  propertyId,
  actorId,
}: {
  readonly items: readonly SupplyItem[];
  readonly holds: ReadonlyMap<Ulid, readonly string[]>;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const itemsApi = useMutations<SupplyItem>(
    "supplyItems",
    "supplyItems",
    supplyItemSchema,
    propertyId,
    actorId,
  );
  const purchasesApi = useMutations<SupplyPurchase>(
    "supplyPurchases",
    "supplyPurchases",
    supplyPurchaseSchema,
    propertyId,
    actorId,
  );
  const usageApi = useMutations<SupplyUsage>(
    "supplyUsage",
    "supplyUsage",
    supplyUsageSchema,
    propertyId,
    actorId,
  );
  const assignmentsApi = useMutations<DurableAssignment>(
    "durableAssignments",
    "durableAssignments",
    durableAssignmentSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();
  const nameOf = (id: Ulid) => items.find((item) => item.id === id)?.name;

  /**
   * Deleting an item is **restrict**, not cascade — every purchase and every
   * usage entry names one by id, and cascading would take a year of what the
   * ranch spent with it. Nothing here is ever really retired: a halter that
   * breaks is a durable assignment marked damaged, which keeps the count honest.
   */
  async function removeItem(item: SupplyItem) {
    const named = holds.get(item.id) ?? [];
    if (named.length > 0) {
      show({
        message: `${item.name} is named by ${named.length} record${named.length === 1 ? "" : "s"} — delete those first, or leave it here where its history stays readable`,
        tone: "warning",
      });
      return;
    }

    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: item.name,
      entity: "supply",
      dependents: [],
      action: "Delete",
    });
    if (!confirmed) return;

    await itemsApi.remove(item.id, "Removed from the supply catalog");
    show({
      message: "Item deleted",
      tone: "danger",
      action: { label: "Undo", onAct: () => void itemsApi.restoreRecord(item.id) },
    });
  }

  async function removePurchase(purchase: SupplyPurchase) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${qty(purchase.quantity)} ${nameOf(purchase.supplyItemId) ?? "supply"} on ${formatDate(purchase.purchasedOn)}`,
      entity: "purchase",
      dependents: [
        { entity: "On-hand count", label: "recomputed", effect: "deleted" as const },
        { entity: "Usage cost", label: "recomputed", effect: "deleted" as const },
      ],
      action: "Delete",
    });
    if (!confirmed) return;

    await purchasesApi.remove(purchase.id, "Removed from the supply purchases");
    show({ message: "Purchase deleted", tone: "danger" });
  }

  async function removeUsage(entry: SupplyUsage) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${qty(entry.quantity)} ${nameOf(entry.supplyItemId) ?? "supply"} on ${formatDate(entry.usedOn)}`,
      entity: "usage entry",
      dependents: [
        { entity: "On-hand count", label: "recomputed", effect: "deleted" as const },
        ...(entry.animalId === undefined
          ? []
          : [
              {
                entity: "Cost against that animal",
                label: "recomputed",
                effect: "deleted" as const,
              },
            ]),
      ],
      action: "Delete",
    });
    if (!confirmed) return;

    await usageApi.remove(entry.id, "Removed from the supply usage log");
    show({ message: "Entry deleted", tone: "danger" });
  }

  async function removeAssignment(assignment: DurableAssignment) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${qty(assignment.quantity)} ${nameOf(assignment.supplyItemId) ?? "durable"} from ${formatDate(assignment.periodFrom)}`,
      entity: "assignment",
      dependents: isEnding(assignment)
        ? [{ entity: "In-service count", label: "recomputed", effect: "deleted" as const }]
        : [],
      consequence: isEnding(assignment)
        ? "This is what takes them off the count. Deleting it puts them back in service."
        : "Ending it keeps the record of where it was. Deleting loses that.",
      action: "Delete",
    });
    if (!confirmed) return;

    await assignmentsApi.remove(assignment.id, "Removed from the durable log");
    show({ message: "Assignment deleted", tone: "danger" });
  }

  /** End an assignment without deleting it — the halter came back. */
  async function bringBack(assignment: DurableAssignment) {
    await assignmentsApi.update(assignment.id, {
      periodTo: new Date(),
    } as Partial<DurableAssignment>);
    show({ message: "Back on the shelf" });
  }

  return { removeItem, removePurchase, removeUsage, removeAssignment, bringBack };
}
