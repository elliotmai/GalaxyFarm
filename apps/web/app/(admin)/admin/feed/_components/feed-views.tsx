"use client";

import { useMemo, useState, type ReactNode } from "react";

import { Button, DataTable, EmptyState, Pill, Select, type Column } from "@galaxy-farm/ui";
import {
  displayName,
  type Animal,
  type FeedingPlan,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import {
  allocateFeedCost,
  costPerHead,
  weightedAverageCost,
  type FeedConsumption,
  type FeedProjection,
  type FeedPurchase,
  type FeedType,
} from "@galaxy-farm/module-feed";

import { KitGauge as Gauge, KitList, KitRow } from "../../equipment/_components/kit-controls";
import { formatDate, line, money, qty, unitLabel } from "./feed-format";

/**
 * The tabs of the feed screen, as lists (spec §5.3).
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

/* ------------------------------------------------------------------- barn */

export function BarnTab({
  projections,
  now,
  onCount,
}: {
  readonly projections: readonly { feed: FeedType; projection: FeedProjection }[];
  readonly now: Date;
  /** Count one feed — a correction, which is where the projection restarts. */
  readonly onCount: (feed?: FeedType) => void;
}) {
  if (projections.length === 0) {
    return (
      <EmptyState
        title="No feed on file"
        detail="Add a feed type, then record what you bought. The run-out date follows from the plans."
      />
    );
  }

  /**
   * The one chip: the thing to do about this feed, if anything. Order now
   * outranks low stock; a feed no plan is eating says so, quietly; a feed
   * that is fine says nothing.
   */
  function chipFor(projection: FeedProjection) {
    if (projection.onHand < 0) return <Pill tone="danger">Count it</Pill>;
    if (projection.orderNow)
      return (
        <Pill tone="danger" dot>
          Order now
        </Pill>
      );
    if (projection.belowThreshold) return <Pill tone="action">Below reorder</Pill>;
    if (projection.dailyDemand === 0) return <Pill>No plan</Pill>;
    return null;
  }

  return (
    <div className="flex flex-col gap-density">
      <TabHead
        // On hand is what was bought, less what was logged, less what the plans
        // say has gone out since the last count.
        facts="Bought, less logged, less what the plans ate since the last count"
        action={<Button onClick={() => onCount()}>Count the barn</Button>}
      />
      <KitList label="In the barn">
        {projections.map(({ feed, projection }) => {
          const days =
            projection.runsOutOn === undefined
              ? undefined
              : Math.ceil((projection.runsOutOn.getTime() - now.getTime()) / 86_400_000);
          return (
            <KitRow
              key={feed.id}
              title={feed.name}
              lead={
                <Gauge
                  value={
                    feed.reorderThreshold === undefined || feed.reorderThreshold <= 0
                      ? 0
                      : projection.onHand / (feed.reorderThreshold * 3)
                  }
                  danger={projection.orderNow || projection.onHand < 0}
                />
              }
              line={line(
                // Deliberately not clamped at zero. A negative count means the
                // records disagree with the barn, which is worth seeing.
                `${qty(projection.onHand)} ${unitLabel(feed.unit)}`,
                projection.dailyDemand === 0 ? undefined : `${qty(projection.dailyDemand)} a day`,
                projection.runsOutOn === undefined
                  ? undefined
                  : `runs out ${formatDate(projection.runsOutOn)}${
                      days !== undefined && days <= 7 ? ` (${Math.max(0, days)} d)` : ""
                    }`,
                projection.orderBy === undefined
                  ? undefined
                  : `order by ${formatDate(projection.orderBy)}`,
                projection.reconciledOn === undefined
                  ? "never counted"
                  : `counted ${formatDate(projection.reconciledOn)}`,
              )}
              chip={chipFor(projection)}
              onOpen={() => onCount(feed)}
              openLabel={`Count ${feed.name}`}
            />
          );
        })}
      </KitList>
      {projections.some(({ projection }) => projection.onHand < 0) ? (
        <p className="text-sm text-danger">
          Below zero means the records disagree with the barn. Count it and log a correction — that
          keeps the discrepancy rather than papering over it.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- purchases */

export function PurchasesTab({
  feeds,
  purchases,
  onAdd,
  onEdit,
}: {
  readonly feeds: readonly FeedType[];
  readonly purchases: readonly FeedPurchase[];
  readonly onAdd: () => void;
  readonly onEdit: (purchase: FeedPurchase) => void;
}) {
  const byId = useMemo(() => new Map(feeds.map((feed) => [feed.id, feed])), [feeds]);

  return (
    <div className="flex flex-col gap-density">
      <TabHead
        facts={`${purchases.length} purchase${purchases.length === 1 ? "" : "s"}`}
        action={<Button onClick={onAdd}>Record a purchase</Button>}
      />
      {purchases.length === 0 ? (
        <EmptyState
          title="Nothing bought yet"
          detail="Until something is bought, on-hand is nothing and there is no cost to allocate."
        />
      ) : (
        <KitList label="Feed purchases">
          {[...purchases]
            .sort((a, b) => b.purchasedOn.getTime() - a.purchasedOn.getTime())
            .map((purchase) => {
              const feed = byId.get(purchase.feedTypeId);
              return (
                <KitRow
                  key={purchase.id}
                  title={feed?.name ?? "Unknown feed"}
                  line={line(
                    formatDate(purchase.purchasedOn),
                    `${qty(purchase.quantity)} × ${money(purchase.unitCost)}`,
                    money({ cents: Math.round(purchase.unitCost.cents * purchase.quantity) }),
                  )}
                  onOpen={() => onEdit(purchase)}
                  openLabel={`Edit the ${feed?.name ?? "feed"} purchase of ${formatDate(purchase.purchasedOn)}`}
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
  feeds,
  consumption,
  animals,
  zones,
  onAdd,
  onEdit,
}: {
  readonly feeds: readonly FeedType[];
  readonly consumption: readonly FeedConsumption[];
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly onAdd: () => void;
  readonly onEdit: (entry: FeedConsumption) => void;
}) {
  const byId = useMemo(() => new Map(feeds.map((feed) => [feed.id, feed])), [feeds]);

  return (
    <div className="flex flex-col gap-density">
      <TabHead
        // The ordinary case is an empty list: the plans account for daily
        // feeding, and this holds only what they cannot know.
        facts="Only what the plans cannot know"
        action={<Button onClick={onAdd}>Log feed</Button>}
      />
      {consumption.length === 0 ? (
        <EmptyState
          title="Nothing logged"
          detail="That is the ordinary case. The plans account for daily feeding."
        />
      ) : (
        <KitList label="Feed used and counted">
          {[...consumption]
            .sort((a, b) => b.usedOn.getTime() - a.usedOn.getTime())
            .map((entry) => {
              const feed = byId.get(entry.feedTypeId);
              const zone = zones.find((candidate) => candidate.id === entry.zoneId);
              const animal = animals.find((candidate) => candidate.id === entry.animalId);
              return (
                <KitRow
                  key={entry.id}
                  title={feed?.name ?? "Unknown feed"}
                  line={line(
                    formatDate(entry.usedOn),
                    entry.kind === "correction"
                      ? `${qty(entry.quantity)} on hand`
                      : qty(entry.quantity),
                    animal === undefined ? zone?.name : displayName(animal),
                  )}
                  chip={
                    <Pill tone={entry.kind === "correction" ? "identity" : "neutral"}>
                      {entry.kind === "correction" ? "count" : entry.kind}
                    </Pill>
                  }
                  onOpen={() => onEdit(entry)}
                  openLabel={`Edit the ${feed?.name ?? "feed"} entry of ${formatDate(entry.usedOn)}`}
                />
              );
            })}
        </KitList>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ feed types */

export function TypesTab({
  feeds,
  usage,
  onAdd,
  onEdit,
}: {
  readonly feeds: readonly FeedType[];
  readonly usage: ReadonlyMap<Ulid, readonly string[]>;
  readonly onAdd: () => void;
  readonly onEdit: (feed: FeedType) => void;
}) {
  return (
    <div className="flex flex-col gap-density">
      <TabHead
        facts={`${feeds.filter((feed) => feed.active).length} still bought`}
        action={<Button onClick={onAdd}>Add a feed</Button>}
      />
      {feeds.length === 0 ? (
        <EmptyState
          title="No feed on file"
          detail="Add the hay, the grain and the mineral you actually buy. Everything else here hangs off these."
        />
      ) : (
        <KitList label="Feed types">
          {[...feeds]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((feed) => {
              const named = [...new Set(usage.get(feed.id) ?? [])];
              return (
                <KitRow
                  key={feed.id}
                  title={feed.name}
                  line={line(
                    feed.category,
                    unitLabel(feed.unit),
                    feed.estWeightLbPerUnit === undefined
                      ? undefined
                      : `${qty(feed.estWeightLbPerUnit)} lb each`,
                    `${feed.reorderLeadDays} d lead`,
                    named.length === 0 ? "named by nothing yet" : `named by ${named.join(", ")}`,
                  )}
                  chip={feed.active ? null : <Pill>inactive</Pill>}
                  onOpen={() => onEdit(feed)}
                  openLabel={`Edit ${feed.name}`}
                />
              );
            })}
        </KitList>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- cost per head */

const PERIODS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last year" },
] as const;

/**
 * What the feed cost, per animal (§5.3, §6).
 *
 * Each animal is charged its own resolved demand, so a headcount split falls
 * out rather than being computed: four head on one pen plan each resolve to
 * the same per-head quantity and nothing divides anything.
 *
 * A client calf's allocation is tagged rather than merged into the herd
 * average, because §5.7 says the owner pays feed and supplies — that number
 * ends up on somebody's invoice and has to be defensible line by line.
 */
export function CostPerHeadTab({
  feeds,
  plans,
  purchases,
  animals,
  scopes,
  propertyId,
}: {
  readonly feeds: readonly FeedType[];
  readonly plans: readonly FeedingPlan[];
  readonly purchases: readonly FeedPurchase[];
  readonly animals: readonly Animal[];
  readonly scopes: readonly { id: Ulid; zoneIds: readonly Ulid[] }[];
  readonly propertyId: Ulid;
}) {
  const [days, setDays] = useState(30);

  const allocations = useMemo(
    () => allocateFeedCost({ plans, purchases, feeds, animals: scopes, propertyId, days }),
    [plans, purchases, feeds, scopes, propertyId, days],
  );

  const byId = useMemo(() => new Map(animals.map((animal) => [animal.id, animal])), [animals]);
  const feedById = useMemo(() => new Map(feeds.map((feed) => [feed.id, feed])), [feeds]);

  const fed = allocations.filter((allocation) => allocation.quantityByFeedType.size > 0);
  const clientCalves = fed.filter((a) => byId.get(a.animalId)?.ownership === "client");
  const perHead = costPerHead(fed);
  const incomplete = fed.filter((allocation) => !allocation.costComplete);

  const columns: readonly Column<(typeof fed)[number]>[] = [
    {
      key: "animal",
      header: "Animal",
      primary: true,
      render: (row) => {
        const animal = byId.get(row.animalId);
        return animal === undefined ? (
          <span className="text-muted">Unknown</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            {displayName(animal)}
            {animal.ownership === "client" ? <Pill tone="identity">client</Pill> : null}
          </span>
        );
      },
    },
    {
      key: "feeds",
      header: "On",
      render: (row) =>
        [...row.quantityByFeedType]
          .map(
            ([feedTypeId, quantity]) =>
              `${qty(quantity)} ${feedById.get(feedTypeId)?.name ?? "feed"}`,
          )
          .join(", "),
    },
    {
      key: "cost",
      header: "Cost",
      numeric: true,
      render: (row) =>
        row.costComplete ? (
          money(row.cost)
        ) : (
          // Feed with no purchase behind it is valued at nothing, which
          // understates the animal rather than overstating it. Saying so beats
          // showing a confident wrong number.
          <span className="text-muted">{money(row.cost)}, a feed has no purchase</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      <div className="flex flex-wrap items-end justify-between gap-2">
        {/* The four tiles, as one line of facts. */}
        <p className="text-sm text-muted">
          {line(
            `${money(perHead)} a head`,
            `${fed.length} fed`,
            clientCalves.length === 0
              ? undefined
              : `${clientCalves.length} client, billed to the owner`,
            incomplete.length === 0 ? undefined : `${incomplete.length} missing a cost`,
          )}
        </p>
        <Select
          label="Over"
          hideLabel
          value={String(days)}
          options={PERIODS.map((period) => ({ value: period.value, label: period.label }))}
          onChange={(event) => setDays(Number(event.target.value))}
        />
      </div>

      <div className="sm:rounded-density sm:border sm:border-rule sm:bg-panel sm:px-density">
        <DataTable
          caption="Feed cost per animal"
          columns={columns}
          rows={[...fed].sort((left, right) => right.cost.cents - left.cost.cents)}
          rowKey={(row) => row.animalId}
          empty={
            <EmptyState
              title="Nothing is being fed"
              detail="Activate a feeding plan against a pen or an animal, and the cost follows from what was bought."
            />
          }
        />
      </div>

      {/* Weighted average of what was actually paid, not the last price — a
          barn holds bales bought at three prices. */}
      <h2 className="pt-density text-density font-semibold text-ink">What a unit is worth</h2>
      <KitList label="What a unit is worth">
        {feeds
          .filter((feed) => feed.active)
          .map((feed) => (
            <KitRow
              key={feed.id}
              title={feed.name}
              line={`${money(weightedAverageCost(feed.id, purchases))} a ${unitLabel(feed.unit)}, on average paid`}
            />
          ))}
      </KitList>
    </div>
  );
}
