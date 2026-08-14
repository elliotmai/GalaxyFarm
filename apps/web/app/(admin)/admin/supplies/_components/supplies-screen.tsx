"use client";

import { useMemo, useState } from "react";

import {
  Button,
  Callout,
  Card,
  CardGrid,
  DataTable,
  EmptyState,
  Meter,
  PageBody,
  PageHeader,
  Pill,
  RecordCard,
  Section,
  Select,
  Tabs,
  TextInput,
  Tile,
  useConfirmDelete,
  useToast,
  type Column,
  Modal,
} from "@galaxy-farm/ui";
import {
  displayName,
  formatMoney,
  fromDollars,
  UNITS,
  type Animal,
  type Contact,
  type Money,
  type Ulid,
  type Unit,
  type Zone,
} from "@galaxy-farm/core";
import {
  currentlyAssigned,
  DURABLE_CONDITIONS,
  durableAssignmentSchema,
  inService,
  isLowStock,
  stockOnHand,
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
import { useRecords } from "@/lib/local/use-records";

/**
 * The shelf (spec §5.11, §7's `/admin/supplies`).
 *
 * Everything the ranch runs on that is not feed, medicine, or engine-bearing:
 * shavings through show sticks. Two kinds in one screen because "what have we
 * got and where is it" is the same question for a bale of shavings and a show
 * halter — what differs is what happens next. A consumable is drawn down and
 * reordered; a durable is counted, assigned to a calf or a pen, and eventually
 * retired.
 *
 * On-hand is derived, never stored: the opening count plus purchases less
 * usage. Correcting last month's purchase moves the total, which is the whole
 * reason not to keep a number somebody has to remember to fix.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function qty(value: number): string {
  return (Math.round(value * 100) / 100).toLocaleString();
}

function unitLabel(unit: Unit): string {
  return unit.replace(/_/g, " ");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function atNoon(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

function errorMessage(error: { kind: string; issues?: readonly { message: string }[] }): string {
  return error.kind === "validation"
    ? (error.issues?.[0]?.message ?? "That is not valid")
    : "Could not save that";
}

const TABS = [
  { id: "shelf", label: "On the shelf" },
  { id: "items", label: "Items" },
  { id: "purchases", label: "Purchases" },
  { id: "used", label: "Used" },
  { id: "durables", label: "Durables" },
] as const;

export function SuppliesScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: items, loading } = useRecords<SupplyItem>("supplyItems", query);
  const { records: purchases } = useRecords<SupplyPurchase>("supplyPurchases", query);
  const { records: usage } = useRecords<SupplyUsage>("supplyUsage", query);
  const { records: assignments } = useRecords<DurableAssignment>("durableAssignments", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: contacts } = useRecords<Contact>("contacts", query);

  const now = new Date();

  const onHand = useMemo(
    () => new Map(items.map((item) => [item.id, stockOnHand(item, purchases, usage)] as const)),
    [items, purchases, usage],
  );

  const low = items.filter((item) => isLowStock(item, onHand.get(item.id) ?? 0));

  const spend: Money = {
    cents: Math.round(
      purchases.reduce((total, purchase) => total + purchase.unitCost.cents * purchase.quantity, 0),
    ),
  };

  const durablesOut = currentlyAssigned(assignments, now).filter(
    (assignment) => assignment.condition !== "retired" && assignment.condition !== "lost",
  ).length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Kit"
        title="Supplies"
        subtitle="Shavings through show sticks. On hand is the opening count plus what was bought, less what was used — so correcting a purchase moves the total by itself."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Items" value={items.length} />
        <Tile
          label="At the reorder point"
          value={low.length}
          tone={low.length > 0 ? "danger" : "calm"}
          emphasis={low.length > 0}
          hint={low.length > 0 ? low.map((item) => item.name).join(", ") : "Nothing pressing"}
        />
        <Tile label="Spent on supplies" value={formatMoney(spend)} />
        <Tile
          label="Durables out"
          value={durablesOut}
          tone="identity"
          hint="Assigned to a calf or a pen right now"
        />
      </div>

      {low.length === 0 ? null : (
        <Callout tone="danger" title={`${low.length} to reorder`}>
          {low
            .map(
              (item) => `${item.name} — ${qty(onHand.get(item.id) ?? 0)} ${unitLabel(item.unit)}`,
            )
            .join("; ")}
          . The threshold is the point at which there is still time to buy some, not the point at
          which there is none.
        </Callout>
      )}

      <Tabs tabs={TABS} label="Supplies">
        {(active) =>
          active === "shelf" ? (
            loading ? (
              <p className="text-muted">Looking…</p>
            ) : (
              <Shelf items={items} onHand={onHand} assignments={assignments} now={now} />
            )
          ) : active === "items" ? (
            <Items
              items={items}
              purchases={purchases}
              usage={usage}
              assignments={assignments}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : active === "purchases" ? (
            <Purchases
              items={items}
              purchases={purchases}
              contacts={contacts}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : active === "used" ? (
            <Used
              items={items}
              usage={usage}
              animals={animals}
              zones={zones}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : (
            <Durables
              items={items}
              assignments={assignments}
              onHand={onHand}
              animals={animals}
              zones={zones}
              now={now}
              propertyId={propertyId}
              actorId={actorId}
            />
          )
        }
      </Tabs>
    </PageBody>
  );
}

/* ------------------------------------------------------------------ shelf */

function Shelf({
  items,
  onHand,
  assignments,
  now,
}: {
  readonly items: readonly SupplyItem[];
  readonly onHand: ReadonlyMap<Ulid, number>;
  readonly assignments: readonly DurableAssignment[];
  readonly now: Date;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing on the shelf"
        detail="Add the shavings, the nesting pads, the panels and the show halters under Items. Once something is here, what you buy and what you use draw the count by themselves."
      />
    );
  }

  return (
    <Section
      title="What is here"
      description="Consumables count down toward their reorder point. Durables count what is still in service, which is not the same as what was bought."
    >
      <CardGrid columns={3}>
        {[...items]
          .sort((left, right) => {
            const rank = (item: SupplyItem) => (isLowStock(item, onHand.get(item.id) ?? 0) ? 0 : 1);
            return rank(left) - rank(right) || left.name.localeCompare(right.name);
          })
          .map((item) => {
            const stock = onHand.get(item.id) ?? 0;
            const short = isLowStock(item, stock);
            const usable = item.kind === "durable" ? inService(item.id, stock, assignments) : stock;
            const out = currentlyAssigned(assignments, now).filter(
              (assignment) => assignment.supplyItemId === item.id,
            );

            return (
              <RecordCard
                key={item.id}
                tone={short ? "danger" : item.kind === "durable" ? "identity" : "calm"}
                title={item.name}
                subtitle={item.storageLocation}
                actions={
                  <Pill tone={short ? "danger" : "neutral"} dot={short}>
                    {qty(usable)} {unitLabel(item.unit)}
                  </Pill>
                }
                meta={
                  <>
                    <Pill tone="identity">{item.category.replace(/_/g, " ")}</Pill>
                    <Pill>{item.kind}</Pill>
                    {item.kind === "durable" && usable !== stock ? (
                      <Pill tone="action">{qty(stock - usable)} retired or lost</Pill>
                    ) : null}
                    {out.length === 0 ? null : <Pill tone="action">{out.length} assigned</Pill>}
                  </>
                }
              >
                {item.kind === "consumable" && item.reorderThreshold !== undefined ? (
                  <Meter
                    value={
                      item.reorderThreshold <= 0
                        ? 0
                        : Math.min(1, stock / (item.reorderThreshold * 3))
                    }
                    tone={short ? "danger" : "calm"}
                    label="Against three times the reorder point"
                    detail={`Reorder at ${qty(item.reorderThreshold)} ${unitLabel(item.unit)}`}
                  />
                ) : item.kind === "consumable" ? (
                  <p className="text-sm text-muted">
                    No reorder point set, so nothing will ever say it is running low.
                  </p>
                ) : (
                  <p className="text-sm text-muted">
                    {out.length === 0
                      ? "None assigned out."
                      : `Out with ${out.length} ${out.length === 1 ? "calf or pen" : "calves or pens"}.`}
                  </p>
                )}
              </RecordCard>
            );
          })}
      </CardGrid>
    </Section>
  );
}

/* ------------------------------------------------------------------ items */

interface ItemDraft {
  readonly name: string;
  readonly kind: SupplyKind;
  readonly category: SupplyCategory;
  readonly unit: Unit;
  readonly openingQty: string;
  readonly reorderThreshold: string;
  readonly storageLocation: string;
  readonly notes: string;
}

const BLANK_ITEM: ItemDraft = {
  name: "",
  kind: "consumable",
  category: "general",
  unit: "each",
  openingQty: "0",
  reorderThreshold: "",
  storageLocation: "",
  notes: "",
};

/**
 * The catalogue.
 *
 * Deleting an item is **restrict**, not cascade — every purchase and every
 * usage entry names one by id, and cascading would take a year of what the
 * ranch spent with it. Nothing here is ever really retired: a halter that
 * breaks is a durable assignment marked damaged, which keeps the count honest.
 */
function Items({
  items,
  purchases,
  usage,
  assignments,
  propertyId,
  actorId,
}: {
  readonly items: readonly SupplyItem[];
  readonly purchases: readonly SupplyPurchase[];
  readonly usage: readonly SupplyUsage[];
  readonly assignments: readonly DurableAssignment[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<SupplyItem>(
    "supplyItems",
    "supplyItems",
    supplyItemSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<SupplyItem | undefined>();
  const [draft, setDraft] = useState<ItemDraft>(BLANK_ITEM);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // The editor is a side dialog now, so it has an open state of its own —
  // `editing` alone cannot express "adding a new one".
  const [editorOpen, setEditorOpen] = useState(false);

  /** What names each item, so restrict can say what rather than count. */
  const held = useMemo(() => {
    const map = new Map<Ulid, string[]>();
    const note = (id: Ulid, label: string) => map.set(id, [...(map.get(id) ?? []), label]);
    for (const purchase of purchases) note(purchase.supplyItemId, "a purchase");
    for (const entry of usage) note(entry.supplyItemId, "a usage entry");
    for (const assignment of assignments) note(assignment.supplyItemId, "an assignment");
    return map;
  }, [purchases, usage, assignments]);

  function reset() {
    setEditorOpen(false);
    setEditing(undefined);
    setDraft(BLANK_ITEM);
    setError(undefined);
  }

  function openEditor(): void {
    setEditorOpen(true);
  }

  function startEdit(item: SupplyItem) {
    setEditorOpen(true);
    setEditing(item);
    setDraft({
      name: item.name,
      kind: item.kind,
      category: item.category,
      unit: item.unit,
      openingQty: String(item.openingQty),
      reorderThreshold: item.reorderThreshold === undefined ? "" : String(item.reorderThreshold),
      storageLocation: item.storageLocation ?? "",
      notes: item.notes ?? "",
    });
    setError(undefined);
  }

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
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: SupplyItem) {
    const named = held.get(item.id) ?? [];
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

    if (editing?.id === item.id) reset();
    await api.remove(item.id, "Removed from the supply catalogue");
    show({
      message: "Item deleted",
      tone: "danger",
      action: { label: "Undo", onAct: () => void api.restoreRecord(item.id) },
    });
  }

  const columns: readonly Column<SupplyItem>[] = [
    { key: "name", header: "Item", primary: true, render: (row) => row.name },
    { key: "kind", header: "Kind", render: (row) => <Pill>{row.kind}</Pill> },
    {
      key: "category",
      header: "Category",
      render: (row) => row.category.replace(/_/g, " "),
    },
    { key: "unit", header: "Unit", render: (row) => unitLabel(row.unit) },
    {
      key: "opening",
      header: "Opening",
      numeric: true,
      render: (row) => qty(row.openingQty),
    },
    {
      key: "reorder",
      header: "Reorder at",
      numeric: true,
      render: (row) => (row.reorderThreshold === undefined ? "—" : qty(row.reorderThreshold)),
    },
    { key: "where", header: "Where", render: (row) => row.storageLocation ?? "—" },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex gap-2">
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

  return (
    <div className="flex flex-col gap-density">
      {editorOpen || editing !== undefined ? (
        <Modal
          placement="side"
          title={editing === undefined ? "Add an item" : `Edit ${editing.name}`}
          description="The opening count is what is on the shelf the day you write it down. Everything after that is purchases and usage."
          onClose={reset}
        >
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-4">
              <TextInput
                label="Name"
                hint="&ldquo;Pine shavings&rdquo;, &ldquo;Show halter&rdquo;, &ldquo;Revive&rdquo;"
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
                onChange={(event) =>
                  setDraft({ ...draft, category: event.target.value as SupplyCategory })
                }
                options={SUPPLY_CATEGORIES.map((value) => ({
                  value,
                  label: value.replace(/_/g, " "),
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
            </div>

            {error === undefined ? null : (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={busy}>
                {editing === undefined ? "Add item" : "Save item"}
              </Button>
              {editing === undefined ? null : (
                <Button variant="ghost" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Modal>
      ) : null}

      <Section title="The catalogue" actions={<Button onClick={openEditor}>Add an item</Button>}>
        <Card>
          <DataTable
            caption="Supply items"
            columns={columns}
            rows={[...items].sort((a, b) => a.name.localeCompare(b.name))}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="Nothing here yet"
                detail="Shavings and nesting pads are consumables; panels, halters and show sticks are durables. Both live here, and what happens to them after that is what differs."
              />
            }
          />
        </Card>
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------- purchases */

function Purchases({
  items,
  purchases,
  contacts,
  propertyId,
  actorId,
}: {
  readonly items: readonly SupplyItem[];
  readonly purchases: readonly SupplyPurchase[];
  readonly contacts: readonly Contact[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<SupplyPurchase>(
    "supplyPurchases",
    "supplyPurchases",
    supplyPurchaseSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const [editing, setEditing] = useState<SupplyPurchase | undefined>();
  const [supplyItemId, setSupplyItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [vendorContactId, setVendorContactId] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // The editor is a side dialog now, so it has an open state of its own —
  // `editing` alone cannot express "adding a new one".
  const [editorOpen, setEditorOpen] = useState(false);

  function reset() {
    setEditorOpen(false);
    setEditing(undefined);
    setQuantity("");
    setUnitCost("");
    setNotes("");
    setError(undefined);
  }

  function openEditor(): void {
    setEditorOpen(true);
  }

  function startEdit(purchase: SupplyPurchase) {
    setEditorOpen(true);
    setEditing(purchase);
    setSupplyItemId(purchase.supplyItemId);
    setQuantity(String(purchase.quantity));
    setUnitCost((purchase.unitCost.cents / 100).toFixed(2));
    setVendorContactId(purchase.vendorContactId ?? "");
    setPurchasedOn(purchase.purchasedOn.toISOString().slice(0, 10));
    setNotes(purchase.notes ?? "");
    setError(undefined);
  }

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
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function remove(purchase: SupplyPurchase) {
    const item = byId.get(purchase.supplyItemId);
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${qty(purchase.quantity)} ${item?.name ?? "supply"} on ${formatDate(purchase.purchasedOn)}`,
      entity: "purchase",
      dependents: [
        { entity: "On-hand count", label: "recomputed", effect: "deleted" as const },
        { entity: "Usage cost", label: "recomputed", effect: "deleted" as const },
      ],
      action: "Delete",
    });
    if (!confirmed) return;

    if (editing?.id === purchase.id) reset();
    await api.remove(purchase.id, "Removed from the supply purchases");
    show({ message: "Purchase deleted", tone: "danger" });
  }

  const columns: readonly Column<SupplyPurchase>[] = [
    {
      key: "item",
      header: "Item",
      primary: true,
      render: (row) =>
        byId.get(row.supplyItemId)?.name ?? <span className="text-muted">Unknown</span>,
    },
    { key: "when", header: "Bought", render: (row) => formatDate(row.purchasedOn) },
    { key: "qty", header: "Quantity", numeric: true, render: (row) => qty(row.quantity) },
    { key: "each", header: "Each", numeric: true, render: (row) => formatMoney(row.unitCost) },
    {
      key: "total",
      header: "Total",
      numeric: true,
      render: (row) => formatMoney({ cents: Math.round(row.unitCost.cents * row.quantity) }),
    },
    {
      key: "vendor",
      header: "From",
      render: (row) => contacts.find((contact) => contact.id === row.vendorContactId)?.name ?? "—",
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex gap-2">
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

  return (
    <div className="flex flex-col gap-density">
      {editorOpen || editing !== undefined ? (
        <Modal
          placement="side"
          title={editing === undefined ? "Record a purchase" : "Edit this purchase"}
          description="The same shape as feed on purpose: both land on the same boarding invoice, and a client would notice if the two were costed differently."
          onClose={reset}
        >
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
              <Select
                label="Item"
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
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>

            {error === undefined ? null : (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={busy}>
                {editing === undefined ? "Record purchase" : "Save purchase"}
              </Button>
              {editing === undefined ? null : (
                <Button variant="ghost" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Modal>
      ) : null}

      <Section
        title="Every purchase"
        actions={<Button onClick={openEditor}>Record a purchase</Button>}
      >
        <Card>
          <DataTable
            caption="Supply purchases"
            columns={columns}
            rows={[...purchases].sort((a, b) => b.purchasedOn.getTime() - a.purchasedOn.getTime())}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="Nothing bought yet"
                detail="Until something is bought, on hand is the opening count and there is no cost to put against a calf."
              />
            }
          />
        </Card>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------- used */

function Used({
  items,
  usage,
  animals,
  zones,
  propertyId,
  actorId,
}: {
  readonly items: readonly SupplyItem[];
  readonly usage: readonly SupplyUsage[];
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<SupplyUsage>(
    "supplyUsage",
    "supplyUsage",
    supplyUsageSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const [editing, setEditing] = useState<SupplyUsage | undefined>();
  const [supplyItemId, setSupplyItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [usedOn, setUsedOn] = useState(today);
  const [animalId, setAnimalId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // The editor is a side dialog now, so it has an open state of its own —
  // `editing` alone cannot express "adding a new one".
  const [editorOpen, setEditorOpen] = useState(false);

  function reset() {
    setEditorOpen(false);
    setEditing(undefined);
    setQuantity("");
    setAnimalId("");
    setZoneId("");
    setNotes("");
    setError(undefined);
  }

  function openEditor(): void {
    setEditorOpen(true);
  }

  function startEdit(entry: SupplyUsage) {
    setEditorOpen(true);
    setEditing(entry);
    setSupplyItemId(entry.supplyItemId);
    setQuantity(String(entry.quantity));
    setUsedOn(entry.usedOn.toISOString().slice(0, 10));
    setAnimalId(entry.animalId ?? "");
    setZoneId(entry.zoneId ?? "");
    setNotes(entry.notes ?? "");
    setError(undefined);
  }

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
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: SupplyUsage) {
    const item = byId.get(entry.supplyItemId);
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${qty(entry.quantity)} ${item?.name ?? "supply"} on ${formatDate(entry.usedOn)}`,
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

    if (editing?.id === entry.id) reset();
    await api.remove(entry.id, "Removed from the supply usage log");
    show({ message: "Entry deleted", tone: "danger" });
  }

  const columns: readonly Column<SupplyUsage>[] = [
    {
      key: "item",
      header: "Item",
      primary: true,
      render: (row) =>
        byId.get(row.supplyItemId)?.name ?? <span className="text-muted">Unknown</span>,
    },
    { key: "when", header: "When", render: (row) => formatDate(row.usedOn) },
    { key: "qty", header: "Quantity", numeric: true, render: (row) => qty(row.quantity) },
    {
      key: "where",
      header: "On what",
      render: (row) => {
        const animal = animals.find((entry) => entry.id === row.animalId);
        const zone = zones.find((entry) => entry.id === row.zoneId);
        return animal !== undefined ? (
          displayName(animal)
        ) : zone !== undefined ? (
          zone.name
        ) : (
          <span className="text-muted">the place generally</span>
        );
      },
    },
    { key: "notes", header: "Note", render: (row) => row.notes ?? "—" },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex gap-2">
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

  return (
    <div className="flex flex-col gap-density">
      {editorOpen || editing !== undefined ? (
        <Modal
          placement="side"
          title={editing === undefined ? "Record what was used" : "Edit this entry"}
          description="Naming the calf is what puts shavings and fitting products on its costs — the mechanism behind the rule that owners pay for feed and supplies."
          onClose={reset}
        >
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
              <Select
                label="Item"
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
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>

            {error === undefined ? null : (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={busy}>
                {editing === undefined ? "Record usage" : "Save entry"}
              </Button>
              {editing === undefined ? null : (
                <Button variant="ghost" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Modal>
      ) : null}

      <Section
        title="What has gone out"
        actions={<Button onClick={openEditor}>Record usage</Button>}
      >
        <Card>
          <DataTable
            caption="Supply usage"
            columns={columns}
            rows={[...usage].sort((a, b) => b.usedOn.getTime() - a.usedOn.getTime())}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="Nothing logged"
                detail="Until something is drawn down, on hand is everything ever bought — and nothing will ever reach a reorder point."
              />
            }
          />
        </Card>
      </Section>
    </div>
  );
}

/* --------------------------------------------------------------- durables */

/**
 * Which halter is on which calf (§5.11).
 *
 * A log rather than a field on the item, for the same reason a zone assignment
 * is a log: "which halter was on that calf at the show" is a question about the
 * past, and a field only ever answers about now.
 */
function Durables({
  items,
  assignments,
  onHand,
  animals,
  zones,
  now,
  propertyId,
  actorId,
}: {
  readonly items: readonly SupplyItem[];
  readonly assignments: readonly DurableAssignment[];
  readonly onHand: ReadonlyMap<Ulid, number>;
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly now: Date;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<DurableAssignment>(
    "durableAssignments",
    "durableAssignments",
    durableAssignmentSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const durables = items.filter((item) => item.kind === "durable");
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const [editing, setEditing] = useState<DurableAssignment | undefined>();
  const [supplyItemId, setSupplyItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [condition, setCondition] = useState<DurableCondition>("good");
  const [animalId, setAnimalId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // The editor is a side dialog now, so it has an open state of its own —
  // `editing` alone cannot express "adding a new one".
  const [editorOpen, setEditorOpen] = useState(false);

  const closing = condition === "retired" || condition === "lost";

  function reset() {
    setEditorOpen(false);
    setEditing(undefined);
    setQuantity("1");
    setCondition("good");
    setAnimalId("");
    setZoneId("");
    setFrom(today());
    setTo("");
    setNotes("");
    setError(undefined);
  }

  function openEditor(): void {
    setEditorOpen(true);
  }

  function startEdit(assignment: DurableAssignment) {
    setEditorOpen(true);
    setEditing(assignment);
    setSupplyItemId(assignment.supplyItemId);
    setQuantity(String(assignment.quantity));
    setCondition(assignment.condition);
    setAnimalId(assignment.animalId ?? "");
    setZoneId(assignment.zoneId ?? "");
    setFrom(assignment.periodFrom.toISOString().slice(0, 10));
    setTo(assignment.periodTo === undefined ? "" : assignment.periodTo.toISOString().slice(0, 10));
    setNotes(assignment.notes ?? "");
    setError(undefined);
  }

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
      reset();
    } finally {
      setBusy(false);
    }
  }

  /** End an assignment without deleting it — the halter came back. */
  async function bringBack(assignment: DurableAssignment) {
    await api.update(assignment.id, { periodTo: new Date() } as Partial<DurableAssignment>);
    show({ message: "Back on the shelf" });
  }

  async function remove(assignment: DurableAssignment) {
    const item = byId.get(assignment.supplyItemId);
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${qty(assignment.quantity)} ${item?.name ?? "durable"} from ${formatDate(assignment.periodFrom)}`,
      entity: "assignment",
      dependents:
        assignment.condition === "retired" || assignment.condition === "lost"
          ? [{ entity: "In-service count", label: "recomputed", effect: "deleted" as const }]
          : [],
      consequence:
        assignment.condition === "retired" || assignment.condition === "lost"
          ? "This is what takes them off the count. Deleting it puts them back in service."
          : "Ending it keeps the record of where it was. Deleting loses that.",
      action: "Delete",
    });
    if (!confirmed) return;

    if (editing?.id === assignment.id) reset();
    await api.remove(assignment.id, "Removed from the durable log");
    show({ message: "Assignment deleted", tone: "danger" });
  }

  const columns: readonly Column<DurableAssignment>[] = [
    {
      key: "item",
      header: "Item",
      primary: true,
      render: (row) =>
        byId.get(row.supplyItemId)?.name ?? <span className="text-muted">Unknown</span>,
    },
    { key: "count", header: "How many", numeric: true, render: (row) => qty(row.quantity) },
    {
      key: "where",
      header: "With",
      render: (row) => {
        const animal = animals.find((entry) => entry.id === row.animalId);
        const zone = zones.find((entry) => entry.id === row.zoneId);
        return animal !== undefined ? (
          displayName(animal)
        ) : zone !== undefined ? (
          zone.name
        ) : (
          <span className="text-muted">—</span>
        );
      },
    },
    {
      key: "condition",
      header: "Condition",
      render: (row) => (
        <Pill
          tone={
            row.condition === "damaged" || row.condition === "lost" || row.condition === "retired"
              ? "danger"
              : row.condition === "worn"
                ? "action"
                : "calm"
          }
        >
          {row.condition}
        </Pill>
      ),
    },
    { key: "from", header: "From", render: (row) => formatDate(row.periodFrom) },
    {
      key: "to",
      header: "Until",
      render: (row) =>
        row.periodTo === undefined ? <Pill tone="action">out now</Pill> : formatDate(row.periodTo),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex gap-2">
          {row.periodTo === undefined ? (
            <Button variant="ghost" onClick={() => void bringBack(row)}>
              Back
            </Button>
          ) : null}
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

  if (durables.length === 0) {
    return (
      <EmptyState
        title="No durables yet"
        detail="Panels, gates, feed pans, bunks, halters, neck ties, show sticks and combs are durables. Add one under Items and it can be counted, assigned and retired here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="What is still in service"
        description="Twenty-four panels with two bent into scrap is twenty-two panels, and a pen laid out against twenty-four is a pen that will not close."
      >
        <CardGrid columns={3}>
          {durables.map((item) => {
            const total = onHand.get(item.id) ?? 0;
            const usable = inService(item.id, total, assignments);
            const out = currentlyAssigned(assignments, now).filter(
              (assignment) =>
                assignment.supplyItemId === item.id &&
                assignment.condition !== "retired" &&
                assignment.condition !== "lost",
            );

            return (
              <RecordCard
                key={item.id}
                tone={usable < total ? "action" : "identity"}
                title={item.name}
                subtitle={item.storageLocation}
                actions={
                  <Pill tone="identity">
                    {qty(usable)} of {qty(total)}
                  </Pill>
                }
                meta={
                  <>
                    <Pill>{item.category.replace(/_/g, " ")}</Pill>
                    {out.length === 0 ? null : <Pill tone="action">{out.length} out</Pill>}
                    {usable < total ? (
                      <Pill tone="danger">{qty(total - usable)} retired or lost</Pill>
                    ) : null}
                  </>
                }
              />
            );
          })}
        </CardGrid>
      </Section>

      {editorOpen || editing !== undefined ? (
        <Modal
          placement="side"
          title={editing === undefined ? "Assign, or retire" : "Edit this assignment"}
          description="Where something is, and what condition it is in. Marking one retired or lost takes it off the in-service count and closes the assignment."
          onClose={reset}
        >
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Item"
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
                hint={
                  closing
                    ? "Required for retired and lost — today if left blank."
                    : "Leave blank while it is still out."
                }
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
              <TextInput
                label="Notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>

            {error === undefined ? null : (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={busy}>
                {editing === undefined ? "Record it" : "Save assignment"}
              </Button>
              {editing === undefined ? null : (
                <Button variant="ghost" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Modal>
      ) : null}

      <Section
        title="Where things have been"
        actions={<Button onClick={openEditor}>Assign, or retire</Button>}
      >
        <Card>
          <DataTable
            caption="Durable assignments"
            columns={columns}
            rows={[...assignments].sort((a, b) => b.periodFrom.getTime() - a.periodFrom.getTime())}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="Nothing assigned"
                detail="Which show halter lives with which calf is a question about the past as much as the present, which is why this is a log rather than a field."
              />
            }
          />
        </Card>
      </Section>
    </div>
  );
}
