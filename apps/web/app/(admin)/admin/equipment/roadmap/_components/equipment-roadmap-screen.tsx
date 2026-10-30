"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, EmptyState, PageBody, Pill, useConfirmDelete, useToast } from "@galaxy-farm/ui";
import {
  byPriority,
  compareToBudget,
  formatMoney,
  isActive,
  isPriced,
  isRoadmapOpen,
  roadmapItemSchema,
  totalAcquisitionCost,
  type Money,
  type Priority,
  type PurchaseCandidate,
  type RoadmapItem,
  type RoadmapStatus,
  type Ulid,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

import { AddFab, ChipRow, KitHeader, KitList, KitRow } from "../../_components/kit-controls";
import { RoadmapForm } from "./roadmap-form";

/**
 * One formatter, built once. `toLocaleDateString` with options builds a new
 * `Intl.DateTimeFormat` on every call — about a tenth of a millisecond each,
 * which on a list of a few hundred rows, dated twice a row, was most of the
 * time a save spent re-rendering the list behind its panel.
 */
const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * What the place still needs (spec §5.6, §7's `/admin/equipment/roadmap`).
 *
 * The same generic Roadmap aggregate the herd and the horses use, filtered to
 * `domain: equipment` — §5.6 adds one thing to it, which is that **candidates
 * hang off these items**. So the truck line does not just say "truck, need,
 * ASAP": it accumulates the actual trucks that have been looked at, and shows
 * the cheapest all-in figure among them against the budget written here.
 *
 * That comparison is the point. A wishlist with a budget and no candidates is
 * a wish; a budget with three real trucks under it is a decision that can be
 * made — which is why it is the muted line on every row, and "over budget" is
 * the one thing a row will put in a chip besides a need.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined ? "—" : DAY.format(value);
}

const PRIORITY_TONE: Record<Priority, "danger" | "action" | "neutral"> = {
  need: "danger",
  want: "action",
  someday: "neutral",
};

export function EquipmentRoadmapScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: allItems, loading } = useRecords<RoadmapItem>("roadmapItems", query);
  const { records: allCandidates } = useRecords<PurchaseCandidate>("purchaseCandidates", query);

  const api = useMutations<RoadmapItem>(
    "roadmapItems",
    "roadmapItems",
    roadmapItemSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  /**
   * The open panel: adding a line, or editing one. The draft lives in the
   * panel, so typing in it re-renders the panel and not the roadmap behind it.
   */
  const [panel, setPanel] = useState<
    { readonly kind: "add" } | { readonly kind: "edit"; readonly item: RoadmapItem } | undefined
  >();
  /** A priority, "closed", or "" for everything still open. */
  const [view, setView] = useState("");

  // One aggregate serves cattle, horses and equipment (§5.1). This screen owns
  // the equipment slice of it and nothing else.
  const items = useMemo(() => allItems.filter((item) => item.domain === "equipment"), [allItems]);
  const candidates = useMemo(
    () => allCandidates.filter((entry) => entry.domain === "equipment"),
    [allCandidates],
  );

  const open = items.filter(isRoadmapOpen);

  const budgeted: Money = {
    cents: open.reduce((total, item) => total + (item.budgetEstimate?.cents ?? 0), 0),
  };

  const openEditor = () => setPanel({ kind: "add" });
  const close = () => setPanel(undefined);

  async function setStatus(item: RoadmapItem, status: RoadmapStatus) {
    await api.update(item.id, { status } as Partial<RoadmapItem>);
    show({
      message: `${item.title} · ${status.replace(/_/g, " ")}`,
      tone: status === "achieved" ? "success" : status === "dropped" ? "warning" : "info",
    });
  }

  /**
   * Detach, not cascade (§4.5).
   *
   * A candidate outlives the want it was found for: the trucks you looked at
   * and passed on are worth as much next year as the wishlist line that sent
   * you looking, and deleting the line should not take the record of what you
   * turned down with it.
   *
   * Nothing is written to the candidates to achieve that. They keep pointing
   * at a tombstone, which reads as unattached everywhere because every screen
   * resolves the reference against the live items — and it is what makes the
   * undo whole rather than leaving five candidates orphaned behind a restored
   * wishlist line.
   */
  async function remove(item: RoadmapItem) {
    const attached = candidates.filter((entry) => entry.roadmapItemId === item.id);

    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: item.title,
      entity: "roadmap item",
      dependents: attached.map((entry) => ({
        entity: "Candidate",
        label: entry.title,
        effect: "detached" as const,
      })),
      consequence:
        attached.length === 0
          ? undefined
          : "The candidates stay, with their prices and their notes. They stop being counted against this budget, and are counted again if you restore it.",
      action: "Delete",
    });
    if (!confirmed) return;

    await api.remove(item.id, "Removed from the equipment roadmap");
    show({
      message: `${item.title} deleted`,
      tone: "danger",
      action: { label: "Undo", onAct: () => void api.restoreRecord(item.id) },
    });
  }

  const closed = items.filter((item) => !isRoadmapOpen(item));
  const count = (priority: Priority) => open.filter((item) => item.priority === priority).length;

  /**
   * The priority chips replace the tiles and the "show achieved" box: the
   * counts are the filter, and "Closed" is the way to the things that are
   * done or dropped, kept one press away rather than mixed into the list.
   */
  const chips = [
    { key: "", label: "Open", count: open.length },
    { key: "need", label: "Needs", count: count("need") },
    { key: "want", label: "Wants", count: count("want") },
    { key: "someday", label: "Somedays", count: count("someday") },
    ...(closed.length === 0 && view !== "closed"
      ? []
      : [{ key: "closed", label: "Achieved or dropped", count: closed.length }]),
  ];

  const visible = (
    view === "closed" ? closed : view === "" ? open : open.filter((item) => item.priority === view)
  )
    .slice()
    .sort(byPriority);

  /**
   * What the candidates under each line add up to, against its budget.
   *
   * Grouped once per change to the candidates, not filtered per row: the row,
   * its chip and its Compare link each asked, so every render walked every
   * candidate three times for every line on the roadmap.
   *
   * Unpriced candidates are counted as looked at but never as the cheapest —
   * "no price yet" is not $0, and a budget beaten by a blank is not beaten.
   */
  const shoppingByItem = useMemo(() => {
    const live = new Map<Ulid, PurchaseCandidate[]>();
    for (const entry of candidates) {
      if (entry.roadmapItemId === undefined || !isActive(entry)) continue;
      const held = live.get(entry.roadmapItemId);
      if (held === undefined) live.set(entry.roadmapItemId, [entry]);
      else held.push(entry);
    }
    return live;
  }, [candidates]);

  function shopping(item: RoadmapItem) {
    const live = shoppingByItem.get(item.id) ?? [];
    const cheapest = live
      .filter(isPriced)
      .map((entry) => ({ entry, total: totalAcquisitionCost(entry) }))
      .sort((left, right) => left.total.cents - right.total.cents)[0];
    const against =
      item.budgetEstimate === undefined || cheapest === undefined
        ? undefined
        : compareToBudget(cheapest.entry, item.budgetEstimate);
    return { live, cheapest, against };
  }

  /** The one muted line: budget, when, and what has been found against it. */
  function lineFor(item: RoadmapItem): string {
    const { live, cheapest, against } = shopping(item);
    return [
      item.priority === "need" ? undefined : item.priority,
      item.type === "wishlist" ? undefined : item.type.replace(/_/g, " "),
      item.budgetEstimate === undefined ? undefined : `${formatMoney(item.budgetEstimate)} budget`,
      item.targetDate === undefined ? undefined : `by ${formatDate(item.targetDate)}`,
      item.targetSeason,
      live.length === 0
        ? undefined
        : cheapest === undefined
          ? `${live.length} looked at, no price yet`
          : `${live.length} looked at, cheapest ${formatMoney(cheapest.total)}` +
            (against === undefined
              ? ""
              : against.overBudget
                ? ` (${formatMoney({ cents: against.difference.cents })} over)`
                : ` (${formatMoney({ cents: -against.difference.cents })} under)`),
    ]
      .filter((part): part is string => part !== undefined && part !== "")
      .join(" · ");
  }

  /** One chip: closed lines say how they closed; a need says so; an over-budget find says so. */
  function chipFor(item: RoadmapItem) {
    if (!isRoadmapOpen(item)) return <Pill>{item.status.replace(/_/g, " ")}</Pill>;
    if (shopping(item).against?.overBudget === true) return <Pill tone="danger">Over budget</Pill>;
    if (item.priority === "need") return <Pill tone={PRIORITY_TONE.need}>Need</Pill>;
    return null;
  }

  const facts = [
    count("need") > 0 ? `${count("need")} need${count("need") === 1 ? "" : "s"}` : undefined,
    `${open.length} open`,
    budgeted.cents > 0 ? `${formatMoney(budgeted)} budgeted` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");

  return (
    <PageBody>
      {/* Bottom clearance on a phone for the floating add button. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <KitHeader
          eyebrow="Farm"
          title="Equipment roadmap"
          facts={loading ? undefined : facts}
          action={
            <Button variant="primary" onClick={openEditor}>
              <span aria-hidden="true">+</span> Add to roadmap
            </Button>
          }
        />

        {items.length === 0 ? null : (
          <ChipRow label="Filter by priority" chips={chips} value={view} onChange={setView} />
        )}

        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : visible.length === 0 ? (
          <EmptyState
            title={
              items.length === 0
                ? "Nothing on the roadmap"
                : view === "closed"
                  ? "Nothing achieved or dropped yet"
                  : "Nothing open here"
            }
            detail={
              items.length === 0
                ? "The truck, the tractor, the ATV — with a budget, a candidate is judged against something rather than a feeling."
                : undefined
            }
            {...(items.length === 0
              ? {
                  action: (
                    <Button variant="primary" onClick={openEditor}>
                      Add the first line
                    </Button>
                  ),
                }
              : view !== ""
                ? { action: <Button onClick={() => setView("")}>Show everything open</Button> }
                : {})}
          />
        ) : (
          <KitList label="The equipment roadmap">
            {visible.map((item) => {
              const { live } = shopping(item);
              return (
                <KitRow
                  key={item.id}
                  title={item.title}
                  line={lineFor(item)}
                  chip={chipFor(item)}
                  onOpen={() => setPanel({ kind: "edit", item })}
                  openLabel={`Edit ${item.title}`}
                  trailing={
                    <Link
                      href={`/admin/equipment/candidates?item=${item.id}`}
                      className="inline-flex min-h-target items-center whitespace-nowrap rounded-density px-2 text-sm font-semibold text-action hover:bg-raised"
                    >
                      {live.length === 0 ? "Find one" : `Compare ${live.length}`}
                    </Link>
                  }
                />
              );
            })}
          </KitList>
        )}

        <AddFab label="Add to roadmap" onClick={openEditor} />
      </div>

      {panel === undefined ? null : (
        <RoadmapForm
          key={panel.kind === "edit" ? panel.item.id : "new"}
          editing={panel.kind === "edit" ? panel.item : undefined}
          propertyId={propertyId}
          actorId={actorId}
          onClose={close}
          // The panel closes first, so the confirmation is the only dialog on
          // screen rather than a second one stacked on this.
          onDelete={
            panel.kind === "edit"
              ? () => {
                  close();
                  void remove(panel.item);
                }
              : undefined
          }
          onFinish={
            panel.kind === "edit" && isRoadmapOpen(panel.item)
              ? (status) => {
                  const item = panel.item;
                  close();
                  void setStatus(item, status);
                }
              : undefined
          }
        />
      )}
    </PageBody>
  );
}
