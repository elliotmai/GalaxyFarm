"use client";

import { useMemo, useState } from "react";

import { Button, PageBody, Tabs } from "@galaxy-farm/ui";
import { formatMoney, type Animal, type Contact, type Ulid, type Zone } from "@galaxy-farm/core";
import {
  currentlyAssigned,
  isLowStock,
  stockByItem,
  supplySpend,
  type DurableAssignment,
  type SupplyItem,
  type SupplyPurchase,
  type SupplyUsage,
} from "@galaxy-farm/module-supplies";

import { useRecords } from "@/lib/local/use-records";

import { AddFab, KitHeader } from "../../equipment/_components/kit-controls";
import { isEnding, itemHolds, line, qty, unitLabel } from "./supplies-format";
import { DurableForm, ItemForm, PurchaseForm, UsageForm, useSupplyActions } from "./supplies-forms";
import { DurablesTab, ItemsTab, PurchasesTab, ShelfTab, UsedTab } from "./supplies-views";

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
 *
 * This file is the frame — the facts, the one line worth interrupting for, the
 * tabs, and which side panel is open. The tabs are lists (`supplies-views.tsx`)
 * and every write is a panel (`supplies-forms.tsx`). Recording what was used is
 * the thing done most, so it is the primary button, and a row on the shelf is
 * the quickest way to it.
 */

const TABS = [
  { id: "shelf", label: "On the shelf" },
  { id: "items", label: "Items" },
  { id: "purchases", label: "Purchases" },
  { id: "used", label: "Used" },
  { id: "durables", label: "Durables" },
] as const;

/** Which side panel is open, and on what. `start` is the item a new one begins on. */
type Panel =
  | { readonly kind: "item"; readonly item?: SupplyItem }
  | { readonly kind: "purchase"; readonly purchase?: SupplyPurchase; readonly start?: Ulid }
  | { readonly kind: "use"; readonly entry?: SupplyUsage; readonly start?: Ulid }
  | { readonly kind: "durable"; readonly assignment?: DurableAssignment; readonly start?: Ulid };

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

  const [tab, setTab] = useState<string>("shelf");
  const [panel, setPanel] = useState<Panel | undefined>();

  const now = new Date();

  // One pass over each ledger for the whole shelf, not one per item.
  const onHand = useMemo(() => stockByItem(items, purchases, usage), [items, purchases, usage]);

  const holds = useMemo(
    () => itemHolds(purchases, usage, assignments),
    [purchases, usage, assignments],
  );
  const { removeItem, removePurchase, removeUsage, removeAssignment, bringBack } = useSupplyActions(
    { items, holds, propertyId, actorId },
  );

  const low = items.filter((item) => isLowStock(item, onHand.get(item.id) ?? 0));

  // Priced purchases only: one with no price is not a free one.
  const spend = useMemo(() => supplySpend(purchases), [purchases]);

  const durablesOut = currentlyAssigned(assignments, now).filter(
    (assignment) => !isEnding(assignment),
  ).length;

  const close = () => setPanel(undefined);

  /**
   * Delete from inside a panel: the panel closes first, so the removal's own
   * confirmation (in the forms file, through `useConfirmDelete`) is the only dialog.
   */
  function closeThenRun<T>(entry: T | undefined, run: (entry: T) => Promise<void>) {
    return entry === undefined
      ? undefined
      : () => {
          close();
          void run(entry);
        };
  }

  /** The tiles, said once beside the title. */
  const facts = line(
    `${items.length} item${items.length === 1 ? "" : "s"}`,
    durablesOut === 0 ? undefined : `${durablesOut} durables out`,
    spend.cents > 0 ? `${formatMoney(spend)} spent` : undefined,
  );

  const recordUse = () => setPanel({ kind: "use" });

  return (
    <PageBody>
      {/* Bottom clearance on a phone for the floating add button. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <KitHeader
          eyebrow="Farm"
          title="Supplies"
          facts={loading ? undefined : facts}
          action={
            <Button variant="primary" onClick={recordUse}>
              <span aria-hidden="true">+</span> Record use
            </Button>
          }
        />

        {/*
          The one thing worth interrupting for, as one line. The threshold is
          the point at which there is still time to buy some, not the point at
          which there is none — so the line names the count, and the button is
          the purchase.
        */}
        {low.length === 0 ? null : (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-danger">
            <span>
              To reorder:{" "}
              {low
                .map(
                  (item) =>
                    `${item.name} (${qty(onHand.get(item.id) ?? 0)} ${unitLabel(item.unit)})`,
                )
                .join(", ")}
            </span>
            <button
              type="button"
              onClick={() =>
                setPanel({
                  kind: "purchase",
                  ...(low.length === 1 && low[0] !== undefined ? { start: low[0].id } : {}),
                })
              }
              className="inline-flex min-h-target items-center font-semibold text-action underline-offset-2 hover:underline"
            >
              Record a purchase
            </button>
          </p>
        )}

        <Tabs tabs={TABS} label="Supplies" activeTab={tab} onTabChange={setTab}>
          {(active) =>
            active === "shelf" ? (
              loading ? (
                <p className="text-muted">Looking…</p>
              ) : (
                <ShelfTab
                  items={items}
                  onHand={onHand}
                  assignments={assignments}
                  now={now}
                  onUse={(item) => setPanel({ kind: "use", start: item.id })}
                  onAssign={(item) => setPanel({ kind: "durable", start: item.id })}
                />
              )
            ) : active === "items" ? (
              <ItemsTab
                items={items}
                onAdd={() => setPanel({ kind: "item" })}
                onEdit={(item) => setPanel({ kind: "item", item })}
              />
            ) : active === "purchases" ? (
              <PurchasesTab
                items={items}
                purchases={purchases}
                contacts={contacts}
                onAdd={() => setPanel({ kind: "purchase" })}
                onEdit={(purchase) => setPanel({ kind: "purchase", purchase })}
              />
            ) : active === "used" ? (
              <UsedTab
                items={items}
                usage={usage}
                animals={animals}
                zones={zones}
                onAdd={recordUse}
                onEdit={(entry) => setPanel({ kind: "use", entry })}
              />
            ) : (
              <DurablesTab
                items={items}
                assignments={assignments}
                onHand={onHand}
                animals={animals}
                zones={zones}
                now={now}
                onAdd={(item) =>
                  setPanel({ kind: "durable", ...(item === undefined ? {} : { start: item.id }) })
                }
                onEdit={(assignment) => setPanel({ kind: "durable", assignment })}
                onBack={(assignment) => void bringBack(assignment)}
              />
            )
          }
        </Tabs>

        <AddFab label="Record use" onClick={recordUse} />
      </div>

      {panel?.kind === "item" ? (
        <ItemForm
          key={panel.item?.id ?? "new"}
          editing={panel.item}
          propertyId={propertyId}
          actorId={actorId}
          onClose={close}
          onDelete={closeThenRun(panel.item, removeItem)}
        />
      ) : panel?.kind === "purchase" ? (
        <PurchaseForm
          key={panel.purchase?.id ?? `new-${panel.start ?? ""}`}
          items={items}
          contacts={contacts}
          editing={panel.purchase}
          start={panel.start}
          propertyId={propertyId}
          actorId={actorId}
          onClose={close}
          onDelete={closeThenRun(panel.purchase, removePurchase)}
        />
      ) : panel?.kind === "use" ? (
        <UsageForm
          key={panel.entry?.id ?? `new-${panel.start ?? ""}`}
          items={items}
          animals={animals}
          zones={zones}
          editing={panel.entry}
          start={panel.start}
          propertyId={propertyId}
          actorId={actorId}
          onClose={close}
          onDelete={closeThenRun(panel.entry, removeUsage)}
        />
      ) : panel?.kind === "durable" ? (
        <DurableForm
          key={panel.assignment?.id ?? `new-${panel.start ?? ""}`}
          durables={items.filter((item) => item.kind === "durable")}
          animals={animals}
          zones={zones}
          editing={panel.assignment}
          start={panel.start}
          propertyId={propertyId}
          actorId={actorId}
          onClose={close}
          onDelete={closeThenRun(panel.assignment, removeAssignment)}
        />
      ) : null}
    </PageBody>
  );
}
