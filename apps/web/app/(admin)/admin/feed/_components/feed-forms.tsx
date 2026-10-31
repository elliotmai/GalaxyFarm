"use client";

import { useState } from "react";

import {
  Checkbox,
  Select,
  TextInput,
  useConfirmDelete,
  useToast,
  toOptions,
} from "@galaxy-farm/ui";
import {
  displayName,
  fromDollars,
  type Animal,
  type Contact,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import {
  CONSUMPTION_KINDS,
  FEED_CATEGORIES,
  FEED_UNITS,
  feedConsumptionSchema,
  feedPurchaseSchema,
  feedTypeSchema,
  type ConsumptionKind,
  type FeedCategory,
  type FeedConsumption,
  type FeedPurchase,
  type FeedType,
  type FeedUnit,
} from "@galaxy-farm/module-feed";

import { useMutations } from "@/lib/local/mutations";

import { KitFormPanel as FormPanel } from "../../equipment/_components/kit-controls";
import { formatDate, qty, unitLabel } from "./feed-format";

/**
 * The three things the feed screen writes, each in a side panel (spec §5.3).
 *
 * A purchase, a log entry (an extra bale, a torn bag, a count of the barn) and
 * a feed type. Each mounts fresh when it opens, so its state starts from the
 * record being edited — or, for a count started from a row in the barn, from
 * that feed — and the screen behind it never moves.
 */

interface Common {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
  /** Present when editing: closes the panel and asks to delete. */
  readonly onDelete?: (() => void) | undefined;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The feeds a picker offers: the ones still bought, plus the one this record
 * already names. "Still bought" off is the feed type's own promise — it hides
 * the feed from the pickers — and an edit of an old purchase must not blank
 * its feed because that feed has since been retired.
 */
export function pickableFeeds(
  feeds: readonly FeedType[],
  current: string | undefined,
): readonly FeedType[] {
  return feeds.filter((feed) => feed.active || feed.id === current);
}

/** Blank is "not given"; anything else is a number, however it was typed. */
function optionalNumber(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

/** Blank notes are no notes, not an empty string stored forever. */
function optionalText(value: string): string | undefined {
  return value.trim() === "" ? undefined : value.trim();
}

function validationMessage(error: {
  kind: string;
  issues?: readonly { message: string }[];
}): string {
  return error.kind === "validation"
    ? (error.issues?.[0]?.message ?? "That is not valid")
    : "Could not save that";
}

/* -------------------------------------------------------------- purchases */

export function PurchaseForm({
  feeds,
  contacts,
  editing,
  propertyId,
  actorId,
  onClose,
  onDelete,
  start,
}: Common & {
  readonly feeds: readonly FeedType[];
  /** Who it came from — the feed store, or the neighbour with hay. */
  readonly contacts: readonly Contact[];
  readonly editing?: FeedPurchase | undefined;
  /** Where a new purchase starts — "Restock" from a feed's row in the shed. */
  readonly start?: { readonly feedTypeId?: Ulid } | undefined;
}) {
  const api = useMutations<FeedPurchase>(
    "feedPurchases",
    "feedPurchases",
    feedPurchaseSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [feedTypeId, setFeedTypeId] = useState<string>(
    editing?.feedTypeId ?? start?.feedTypeId ?? "",
  );
  const [quantity, setQuantity] = useState(editing === undefined ? "" : String(editing.quantity));
  const [unitCost, setUnitCost] = useState(
    editing?.unitCost === undefined ? "" : (editing.unitCost.cents / 100).toFixed(2),
  );
  const [purchasedOn, setPurchasedOn] = useState(
    editing === undefined ? today() : editing.purchasedOn.toISOString().slice(0, 10),
  );
  const [vendorContactId, setVendorContactId] = useState<string>(editing?.vendorContactId ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (feedTypeId === "") {
      setError("Choose the feed");
      return;
    }

    setBusy(true);
    try {
      const cost = optionalNumber(unitCost);
      // Every optional field is named even when blank. A patch carries the
      // fields that changed, and clearing a price has to travel as a change.
      const payload = {
        feedTypeId: feedTypeId as Ulid,
        quantity: Number(quantity),
        // Blank is "not priced yet", never $0 — see `FeedPurchase.unitCost`.
        unitCost: cost === undefined ? undefined : fromDollars(cost),
        vendorContactId: vendorContactId === "" ? undefined : (vendorContactId as Ulid),
        purchasedOn: new Date(`${purchasedOn}T12:00:00`),
        notes: optionalText(notes),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<FeedPurchase>);

      if (!result.ok) {
        setError(validationMessage(result.error));
        return;
      }

      show({ message: editing === undefined ? "Purchase recorded" : "Purchase updated" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
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
        label="Feed"
        className="sm:col-span-2"
        value={feedTypeId}
        placeholder="Choose a feed"
        options={pickableFeeds(feeds, editing?.feedTypeId ?? start?.feedTypeId).map((feed) => ({
          value: feed.id,
          label: `${feed.name} (${unitLabel(feed.unit)})`,
        }))}
        onChange={(event) => setFeedTypeId(event.target.value)}
        required
      />
      <TextInput
        label="Quantity"
        hint="In the feed's own unit — bales, bags, tons."
        type="number"
        inputMode="decimal"
        numeric
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        required
      />
      <TextInput
        label="Cost each"
        hint="Leave blank until the bill comes."
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        numeric
        value={unitCost}
        onChange={(event) => setUnitCost(event.target.value)}
      />
      <TextInput
        label="Bought"
        type="date"
        value={purchasedOn}
        onChange={(event) => setPurchasedOn(event.target.value)}
        required
      />
      <Select
        label="From"
        value={vendorContactId}
        placeholder="Not recorded"
        options={contacts.map((contact) => ({ value: contact.id, label: contact.name }))}
        onChange={(event) => setVendorContactId(event.target.value)}
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

export function UseForm({
  feeds,
  animals,
  zones,
  editing,
  start,
  propertyId,
  actorId,
  onClose,
  onDelete,
}: Common & {
  readonly feeds: readonly FeedType[];
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly editing?: FeedConsumption | undefined;
  /** Where a new entry starts — "count the hay" from the hay's row. */
  readonly start?: { readonly feedTypeId?: Ulid; readonly kind?: ConsumptionKind } | undefined;
}) {
  const api = useMutations<FeedConsumption>(
    "feedConsumption",
    "feedConsumption",
    feedConsumptionSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const [feedTypeId, setFeedTypeId] = useState<string>(
    editing?.feedTypeId ?? start?.feedTypeId ?? "",
  );
  const [quantity, setQuantity] = useState(editing === undefined ? "" : String(editing.quantity));
  const [kind, setKind] = useState<ConsumptionKind>(editing?.kind ?? start?.kind ?? "extra");
  const [usedOn, setUsedOn] = useState(
    editing === undefined ? today() : editing.usedOn.toISOString().slice(0, 10),
  );
  const [zoneId, setZoneId] = useState<string>(editing?.zoneId ?? "");
  const [animalId, setAnimalId] = useState<string>(editing?.animalId ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (feedTypeId === "") {
      setError("Choose the feed");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        feedTypeId: feedTypeId as Ulid,
        quantity: Number(quantity),
        kind,
        usedOn: new Date(`${usedOn}T12:00:00`),
        zoneId: zoneId === "" ? undefined : (zoneId as Ulid),
        animalId: animalId === "" ? undefined : (animalId as Ulid),
        notes: optionalText(notes),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<FeedConsumption>);

      if (!result.ok) {
        setError(validationMessage(result.error));
        return;
      }

      show({
        message:
          kind === "correction"
            ? "Counted. The projection restarts from today."
            : "Recorded against the barn",
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const counting = kind === "correction";

  return (
    <FormPanel
      title={editing !== undefined ? "Edit this entry" : counting ? "Count the barn" : "Log feed"}
      submitLabel={editing === undefined ? (counting ? "Record count" : "Log it") : "Save entry"}
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
      onDelete={onDelete}
    >
      <Select
        label="Feed"
        value={feedTypeId}
        placeholder="Choose a feed"
        options={pickableFeeds(feeds, editing?.feedTypeId ?? start?.feedTypeId).map((feed) => ({
          value: feed.id,
          label: `${feed.name} (${unitLabel(feed.unit)})`,
        }))}
        onChange={(event) => setFeedTypeId(event.target.value)}
        required
      />
      <Select
        label="Kind"
        // The one easy mistake here: a correction is a count, not a use.
        hint="A correction is a count of the barn: what is there now. The projection restarts from it."
        value={kind}
        options={toOptions(CONSUMPTION_KINDS)}
        onChange={(event) => setKind(event.target.value as ConsumptionKind)}
      />
      <TextInput
        label={counting ? "On hand" : "Quantity"}
        // Zero is a real count: the shed is empty.
        hint={counting ? "What you counted, in the feed's own unit. 0 if it is gone." : undefined}
        type="number"
        inputMode="decimal"
        min="0"
        numeric
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        required
      />
      <TextInput
        label="When"
        type="date"
        value={usedOn}
        onChange={(event) => setUsedOn(event.target.value)}
        required
      />
      <Select
        label="Pen"
        value={zoneId}
        placeholder="Not against a pen"
        options={zones
          .filter((zone) => zone.active)
          .map((zone) => ({ value: zone.id, label: zone.name }))}
        onChange={(event) => setZoneId(event.target.value)}
      />
      <Select
        label="Animal"
        value={animalId}
        placeholder="Not against an animal"
        options={animals
          .filter((animal) => animal.status === "active")
          .map((animal) => ({ value: animal.id, label: displayName(animal) }))}
        onChange={(event) => setAnimalId(event.target.value)}
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

/* ------------------------------------------------------------ feed types */

const BLANK_TYPE = {
  name: "",
  category: "hay" as FeedCategory,
  unit: "round_bale" as FeedUnit,
  estWeightLbPerUnit: "",
  reorderLeadDays: "7",
  reorderThreshold: "",
  active: true,
  notes: "",
};

/** What a blank lead time means: a week, the commonest answer at a feed store. */
const DEFAULT_LEAD_DAYS = 7;

export function TypeForm({
  editing,
  propertyId,
  actorId,
  onClose,
  onDelete,
}: Common & { readonly editing?: FeedType | undefined }) {
  const api = useMutations<FeedType>("feedTypes", "feedTypes", feedTypeSchema, propertyId, actorId);
  const { show } = useToast();

  const [draft, setDraft] = useState(() =>
    editing === undefined
      ? BLANK_TYPE
      : {
          name: editing.name,
          category: editing.category,
          unit: editing.unit,
          estWeightLbPerUnit:
            editing.estWeightLbPerUnit === undefined ? "" : String(editing.estWeightLbPerUnit),
          reorderLeadDays: String(editing.reorderLeadDays),
          reorderThreshold:
            editing.reorderThreshold === undefined ? "" : String(editing.reorderThreshold),
          active: editing.active,
          notes: editing.notes ?? "",
        },
  );
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);

    try {
      const payload = {
        name: draft.name.trim(),
        category: draft.category,
        unit: draft.unit,
        estWeightLbPerUnit: optionalNumber(draft.estWeightLbPerUnit),
        reorderLeadDays: optionalNumber(draft.reorderLeadDays) ?? DEFAULT_LEAD_DAYS,
        reorderThreshold: optionalNumber(draft.reorderThreshold),
        active: draft.active,
        notes: optionalText(draft.notes),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<FeedType>);

      if (!result.ok) {
        setError(validationMessage(result.error));
        return;
      }

      show({ message: editing === undefined ? `${payload.name} added` : "Feed updated" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormPanel
      title={editing === undefined ? "Add a feed" : `Edit ${editing.name}`}
      submitLabel={editing === undefined ? "Add feed" : "Save feed"}
      busy={busy}
      error={error}
      onSubmit={(event) => void submit(event)}
      onClose={onClose}
      onDelete={onDelete}
    >
      <TextInput
        label="Name"
        className="sm:col-span-2"
        value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        required
      />
      <Select
        label="Category"
        value={draft.category}
        options={toOptions(FEED_CATEGORIES)}
        onChange={(event) => setDraft({ ...draft, category: event.target.value as FeedCategory })}
      />
      <Select
        label="Bought in"
        value={draft.unit}
        options={FEED_UNITS.map((value) => ({ value, label: unitLabel(value) }))}
        onChange={(event) => setDraft({ ...draft, unit: event.target.value as FeedUnit })}
      />
      <TextInput
        label="Pounds per unit"
        hint="Blank when the unit is already a weight."
        type="number"
        inputMode="decimal"
        numeric
        value={draft.estWeightLbPerUnit}
        onChange={(event) => setDraft({ ...draft, estWeightLbPerUnit: event.target.value })}
      />
      <TextInput
        label="Reorder lead (days)"
        hint="How long the supplier takes. Blank is a week."
        type="number"
        inputMode="numeric"
        min="0"
        numeric
        value={draft.reorderLeadDays}
        onChange={(event) => setDraft({ ...draft, reorderLeadDays: event.target.value })}
      />
      <TextInput
        label="Reorder threshold"
        hint="At or below this is low stock."
        type="number"
        inputMode="decimal"
        numeric
        value={draft.reorderThreshold}
        onChange={(event) => setDraft({ ...draft, reorderThreshold: event.target.value })}
      />
      <Checkbox
        label="Still bought"
        hint="Off hides it from the pickers and keeps every record that names it."
        checked={draft.active}
        onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
      />
      <TextInput
        label="Notes"
        className="sm:col-span-2"
        value={draft.notes}
        onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
      />
    </FormPanel>
  );
}

/* --------------------------------------------------------------- deletes */

/**
 * The three deletes, each behind its confirmation.
 *
 * Owned by the screen rather than the panels, because a panel closes before
 * its confirmation opens — the dialog has to belong to something still there.
 */
export function useFeedRemovals({
  feeds,
  usage,
  propertyId,
  actorId,
}: {
  readonly feeds: readonly FeedType[];
  readonly usage: ReadonlyMap<Ulid, readonly string[]>;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const purchasesApi = useMutations<FeedPurchase>(
    "feedPurchases",
    "feedPurchases",
    feedPurchaseSchema,
    propertyId,
    actorId,
  );
  const consumptionApi = useMutations<FeedConsumption>(
    "feedConsumption",
    "feedConsumption",
    feedConsumptionSchema,
    propertyId,
    actorId,
  );
  const typesApi = useMutations<FeedType>(
    "feedTypes",
    "feedTypes",
    feedTypeSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();
  const nameOf = (feedTypeId: Ulid) => feeds.find((feed) => feed.id === feedTypeId)?.name;

  async function removePurchase(purchase: FeedPurchase) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${qty(purchase.quantity)} ${nameOf(purchase.feedTypeId) ?? "feed"} on ${formatDate(purchase.purchasedOn)}`,
      entity: "purchase",
      // Deleting a purchase moves the on-hand count and, through the weighted
      // average, every cost-per-head figure that used it.
      dependents: [
        { entity: "On-hand count", label: "recomputed", effect: "deleted" as const },
        { entity: "Cost per head", label: "recomputed", effect: "deleted" as const },
      ],
      action: "Delete",
    });
    if (!confirmed) return;

    await purchasesApi.remove(purchase.id, "Removed from the feed purchases");
    show({ message: "Purchase deleted", tone: "danger" });
  }

  async function removeEntry(entry: FeedConsumption) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${qty(entry.quantity)} ${nameOf(entry.feedTypeId) ?? "feed"} on ${formatDate(entry.usedOn)}`,
      entity: "feed entry",
      dependents: [{ entity: "On-hand count", label: "recomputed", effect: "deleted" as const }],
      consequence:
        entry.kind === "correction"
          ? "This is a count of the barn. Deleting it moves the projection back to the count before it."
          : undefined,
      action: "Delete",
    });
    if (!confirmed) return;

    await consumptionApi.remove(entry.id, "Removed from the feed log");
    show({ message: "Entry deleted", tone: "danger" });
  }

  /**
   * Deleting a feed is **restrict**, not cascade (§5.3, issue #18).
   *
   * A feed type is named by every purchase, every plan line and every entry in
   * the log — cascading would take a year of what you paid for hay with it,
   * and there is no version of that anybody wants. The alternative is in the
   * same panel: mark it inactive and it stops appearing in the pickers while
   * the history stays where it is.
   */
  async function removeType(feed: FeedType) {
    const named = [...new Set(usage.get(feed.id) ?? [])];

    if (named.length > 0) {
      show({
        message: `${feed.name} is named by ${named.join(", ")}. Mark it inactive instead — the history stays.`,
        tone: "warning",
      });
      return;
    }

    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: feed.name,
      entity: "feed type",
      dependents: [],
      consequence: "Nothing has been bought, fed or planned against it.",
      action: "Delete",
    });
    if (!confirmed) return;

    await typesApi.remove(feed.id, "Removed from the feed types");
    show({ message: `${feed.name} deleted`, tone: "danger" });
  }

  return { removePurchase, removeEntry, removeType };
}
