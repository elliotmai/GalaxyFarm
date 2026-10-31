"use client";

import { useMemo, type ReactNode } from "react";

import { Button, EmptyState, Pill } from "@galaxy-farm/ui";
import {
  displayName,
  formatMoney,
  type Animal,
  type Contact,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import {
  currentlyAssigned,
  goneByItem,
  isLowStock,
  purchaseTotal,
  type DurableAssignment,
  type SupplyItem,
  type SupplyPurchase,
  type SupplyUsage,
} from "@galaxy-farm/module-supplies";

import { KitGauge, KitList, KitRow } from "../../equipment/_components/kit-controls";
import { formatDate, isEnding, line, qty, unitLabel } from "./supplies-format";

/**
 * The tabs of the supplies screen, as lists (spec §5.11).
 *
 * These only show. Every write is a side panel the screen owns, reached from
 * the button at the top of a tab or from a row, so a tab is one line of what
 * it adds up to, one button, and a row per thing.
 */

/** The top of a tab: what it adds up to, and the one thing to do in it. */
function TabHead({ facts, action }: { readonly facts: ReactNode; readonly action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted">{facts}</p>
      {action}
    </div>
  );
}

/**
 * Who or where something is with, in the words a row uses.
 *
 * Built once per list as a lookup, rather than searching the herd and the pens
 * for every row: a year of usage against a full herd was a million comparisons
 * on every render of the Used tab.
 */
function useWithWhom(animals: readonly Animal[], zones: readonly Zone[]) {
  return useMemo(() => {
    const names = new Map<Ulid, string>();
    for (const zone of zones) names.set(zone.id, zone.name);
    const animalNames = new Map<Ulid, string>();
    for (const animal of animals) animalNames.set(animal.id, displayName(animal));
    return (entry: {
      readonly animalId?: Ulid | undefined;
      readonly zoneId?: Ulid | undefined;
    }): string | undefined =>
      (entry.animalId === undefined ? undefined : animalNames.get(entry.animalId)) ??
      (entry.zoneId === undefined ? undefined : names.get(entry.zoneId));
  }, [animals, zones]);
}

/** How many open assignments each item has out, keyed by item. */
function countByItem(assignments: readonly DurableAssignment[]): Map<Ulid, number> {
  const counts = new Map<Ulid, number>();
  for (const assignment of assignments) {
    counts.set(assignment.supplyItemId, (counts.get(assignment.supplyItemId) ?? 0) + 1);
  }
  return counts;
}

/* ------------------------------------------------------------------ shelf */

export function ShelfTab({
  items,
  onHand,
  assignments,
  now,
  onUse,
  onAssign,
}: {
  readonly items: readonly SupplyItem[];
  readonly onHand: ReadonlyMap<Ulid, number>;
  readonly assignments: readonly DurableAssignment[];
  readonly now: Date;
  /** A consumable's row: record some of it used. */
  readonly onUse: (item: SupplyItem) => void;
  /** A durable's row: assign it, or retire it. */
  readonly onAssign: (item: SupplyItem) => void;
}) {
  // `now` is a new Date every render, so these are linear passes rather than
  // memos that would recompute anyway.
  const out = countByItem(currentlyAssigned(assignments, now));
  const gone = useMemo(() => goneByItem(assignments), [assignments]);

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing on the shelf"
        detail="Add the shavings, the panels and the show halters under Items. After that, what you buy and use draws the count by itself."
      />
    );
  }

  return (
    <KitList label="What is here">
      {[...items]
        .sort((left, right) => {
          const rank = (item: SupplyItem) => (isLowStock(item, onHand.get(item.id) ?? 0) ? 0 : 1);
          return rank(left) - rank(right) || left.name.localeCompare(right.name);
        })
        .map((item) => {
          const stock = onHand.get(item.id) ?? 0;
          const short = isLowStock(item, stock);
          // Durables count what is still in service, which is not the same as
          // what was bought.
          const usable = item.kind === "durable" ? stock - (gone.get(item.id) ?? 0) : stock;
          const assigned = out.get(item.id) ?? 0;
          const durable = item.kind === "durable";

          return (
            <KitRow
              key={item.id}
              title={item.name}
              lead={
                !durable && item.reorderThreshold !== undefined ? (
                  <KitGauge
                    value={item.reorderThreshold <= 0 ? 0 : stock / (item.reorderThreshold * 3)}
                    danger={short}
                  />
                ) : undefined
              }
              line={line(
                `${qty(usable)} ${unitLabel(item.unit)}`,
                durable && usable !== stock ? `${qty(stock - usable)} retired or lost` : undefined,
                assigned === 0 ? undefined : `${assigned} assigned`,
                durable
                  ? undefined
                  : item.reorderThreshold === undefined
                    ? "no reorder point"
                    : `reorder at ${qty(item.reorderThreshold)}`,
                item.storageLocation,
              )}
              chip={
                short ? (
                  <Pill tone="danger" dot>
                    Reorder
                  </Pill>
                ) : durable ? (
                  <Pill tone="identity">durable</Pill>
                ) : null
              }
              onOpen={() => (durable ? onAssign(item) : onUse(item))}
              openLabel={durable ? `Assign or retire ${item.name}` : `Record ${item.name} used`}
            />
          );
        })}
    </KitList>
  );
}

/* ------------------------------------------------------------------ items */

export function ItemsTab({
  items,
  onAdd,
  onEdit,
}: {
  readonly items: readonly SupplyItem[];
  readonly onAdd: () => void;
  readonly onEdit: (item: SupplyItem) => void;
}) {
  return (
    <div className="flex flex-col gap-density">
      <TabHead
        facts={`${items.length} item${items.length === 1 ? "" : "s"}`}
        action={<Button onClick={onAdd}>Add an item</Button>}
      />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          detail="Shavings and nesting pads are consumables; panels, halters and show sticks are durables."
        />
      ) : (
        <KitList label="Supply items">
          {[...items]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((item) => (
              <KitRow
                key={item.id}
                title={item.name}
                line={line(
                  item.kind,
                  item.category.replace(/_/g, " "),
                  `opened at ${qty(item.openingQty)} ${unitLabel(item.unit)}`,
                  item.reorderThreshold === undefined
                    ? undefined
                    : `reorder at ${qty(item.reorderThreshold)}`,
                  item.storageLocation,
                )}
                onOpen={() => onEdit(item)}
                openLabel={`Edit ${item.name}`}
              />
            ))}
        </KitList>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- purchases */

export function PurchasesTab({
  items,
  purchases,
  contacts,
  onAdd,
  onEdit,
}: {
  readonly items: readonly SupplyItem[];
  readonly purchases: readonly SupplyPurchase[];
  readonly contacts: readonly Contact[];
  readonly onAdd: () => void;
  readonly onEdit: (purchase: SupplyPurchase) => void;
}) {
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const vendors = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact.name])),
    [contacts],
  );

  return (
    <div className="flex flex-col gap-density">
      <TabHead
        facts={`${purchases.length} purchase${purchases.length === 1 ? "" : "s"}`}
        action={<Button onClick={onAdd}>Record a purchase</Button>}
      />
      {purchases.length === 0 ? (
        <EmptyState
          title="Nothing bought yet"
          detail="Until something is bought, on hand is the opening count and there is no cost to put against a calf."
        />
      ) : (
        <KitList label="Supply purchases">
          {[...purchases]
            .sort((a, b) => b.purchasedOn.getTime() - a.purchasedOn.getTime())
            .map((purchase) => {
              const name = byId.get(purchase.supplyItemId)?.name ?? "Unknown item";
              const total = purchaseTotal(purchase);
              return (
                <KitRow
                  key={purchase.id}
                  title={name}
                  line={line(
                    formatDate(purchase.purchasedOn),
                    // No price is said as such — never as $0, which reads as free.
                    purchase.unitCost === undefined
                      ? `${qty(purchase.quantity)} · no price`
                      : `${qty(purchase.quantity)} × ${formatMoney(purchase.unitCost)}`,
                    total === undefined ? undefined : formatMoney(total),
                    purchase.vendorContactId === undefined
                      ? undefined
                      : vendors.get(purchase.vendorContactId),
                  )}
                  onOpen={() => onEdit(purchase)}
                  openLabel={`Edit the ${name} purchase of ${formatDate(purchase.purchasedOn)}`}
                />
              );
            })}
        </KitList>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- used */

export function UsedTab({
  items,
  usage,
  animals,
  zones,
  onAdd,
  onEdit,
}: {
  readonly items: readonly SupplyItem[];
  readonly usage: readonly SupplyUsage[];
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly onAdd: () => void;
  readonly onEdit: (entry: SupplyUsage) => void;
}) {
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const withWhom = useWithWhom(animals, zones);

  return (
    <div className="flex flex-col gap-density">
      <TabHead
        facts={`${usage.length} entr${usage.length === 1 ? "y" : "ies"}`}
        action={<Button onClick={onAdd}>Record usage</Button>}
      />
      {usage.length === 0 ? (
        <EmptyState
          title="Nothing logged"
          detail="Until something is drawn down, on hand is everything ever bought — and nothing will ever reach a reorder point."
        />
      ) : (
        <KitList label="Supply usage">
          {[...usage]
            .sort((a, b) => b.usedOn.getTime() - a.usedOn.getTime())
            .map((entry) => {
              const name = byId.get(entry.supplyItemId)?.name ?? "Unknown item";
              return (
                <KitRow
                  key={entry.id}
                  title={name}
                  line={line(
                    formatDate(entry.usedOn),
                    qty(entry.quantity),
                    withWhom(entry) ?? "the place generally",
                    entry.notes,
                  )}
                  onOpen={() => onEdit(entry)}
                  openLabel={`Edit the ${name} entry of ${formatDate(entry.usedOn)}`}
                />
              );
            })}
        </KitList>
      )}
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
export function DurablesTab({
  items,
  assignments,
  onHand,
  animals,
  zones,
  now,
  onAdd,
  onEdit,
  onBack,
}: {
  readonly items: readonly SupplyItem[];
  readonly assignments: readonly DurableAssignment[];
  readonly onHand: ReadonlyMap<Ulid, number>;
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly now: Date;
  readonly onAdd: (item?: SupplyItem) => void;
  readonly onEdit: (assignment: DurableAssignment) => void;
  readonly onBack: (assignment: DurableAssignment) => void;
}) {
  const durables = items.filter((item) => item.kind === "durable");
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const withWhom = useWithWhom(animals, zones);
  const gone = useMemo(() => goneByItem(assignments), [assignments]);
  const outNow = currentlyAssigned(assignments, now).filter((assignment) => !isEnding(assignment));
  const lentByItem = countByItem(outNow);

  if (durables.length === 0) {
    return (
      <EmptyState
        title="No durables yet"
        detail="Panels, gates, feed pans, halters and show sticks are durables. Add one under Items and it can be counted, assigned and retired here."
      />
    );
  }

  /** One chip on an assignment: how it ended, or that it is still out. */
  function chipFor(assignment: DurableAssignment) {
    if (isEnding(assignment)) return <Pill tone="danger">{assignment.condition}</Pill>;
    if (assignment.periodTo === undefined) return <Pill tone="action">out now</Pill>;
    return null;
  }

  return (
    <div className="flex flex-col gap-density">
      <TabHead
        // Twenty-four panels with two bent into scrap is twenty-two panels,
        // and a pen laid out against twenty-four will not close.
        facts={`${outNow.length} out right now`}
        action={<Button onClick={() => onAdd()}>Assign, or retire</Button>}
      />
      <KitList label="What is still in service">
        {durables.map((item) => {
          const total = onHand.get(item.id) ?? 0;
          const usable = total - (gone.get(item.id) ?? 0);
          const lent = lentByItem.get(item.id) ?? 0;
          return (
            <KitRow
              key={item.id}
              title={item.name}
              line={line(
                `${qty(usable)} of ${qty(total)} in service`,
                lent === 0 ? undefined : `${lent} out`,
                usable < total ? `${qty(total - usable)} retired or lost` : undefined,
                item.category.replace(/_/g, " "),
                item.storageLocation,
              )}
              onOpen={() => onAdd(item)}
              openLabel={`Assign or retire ${item.name}`}
            />
          );
        })}
      </KitList>

      <h2 className="pt-density text-density font-semibold text-ink">Where things have been</h2>
      {assignments.length === 0 ? (
        <EmptyState
          title="Nothing assigned"
          detail="Which show halter lives with which calf is a question about the past as much as the present."
        />
      ) : (
        <KitList label="Durable assignments">
          {[...assignments]
            .sort((a, b) => b.periodFrom.getTime() - a.periodFrom.getTime())
            .map((assignment) => {
              const name = byId.get(assignment.supplyItemId)?.name ?? "Unknown item";
              return (
                <KitRow
                  key={assignment.id}
                  title={name}
                  line={line(
                    qty(assignment.quantity),
                    withWhom(assignment),
                    isEnding(assignment) ? undefined : assignment.condition,
                    assignment.periodTo === undefined
                      ? `since ${formatDate(assignment.periodFrom)}`
                      : `${formatDate(assignment.periodFrom)} – ${formatDate(assignment.periodTo)}`,
                  )}
                  chip={chipFor(assignment)}
                  onOpen={() => onEdit(assignment)}
                  openLabel={`Edit the ${name} assignment from ${formatDate(assignment.periodFrom)}`}
                  trailing={
                    assignment.periodTo === undefined ? (
                      <Button
                        variant="ghost"
                        aria-label={`Bring ${name} back`}
                        onClick={() => onBack(assignment)}
                      >
                        Back
                      </Button>
                    ) : undefined
                  }
                />
              );
            })}
        </KitList>
      )}
    </div>
  );
}
