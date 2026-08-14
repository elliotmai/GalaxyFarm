"use client";

import { useMemo, useState } from "react";

import {
  Button,
  Callout,
  Card,
  CardGrid,
  Checkbox,
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
  openAssignments,
  type Animal,
  type FeedingPlan,
  type Money,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import {
  allocateFeedCost,
  costPerHead,
  CONSUMPTION_KINDS,
  FEED_CATEGORIES,
  FEED_UNITS,
  feedConsumptionSchema,
  feedPurchaseSchema,
  feedTypeSchema,
  projectFeed,
  herdDemand,
  resolvedDemandFor,
  weightedAverageCost,
  type ConsumptionKind,
  type FeedCategory,
  type FeedConsumption,
  type FeedProjection,
  type FeedPurchase,
  type FeedType,
  type FeedUnit,
} from "@galaxy-farm/module-feed";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * The barn, and when it runs out (spec §5.3, issue #18).
 *
 * The thing this screen exists to say is a date: when does the hay run out,
 * and when do I have to order to still have some. §5.3 is explicit that daily
 * demand is **derived from the active feeding plans and never typed in** — so
 * there is no "how much do you feed a day" field anywhere here. Type one and
 * it would be wrong the day a plan changed, and nobody would know which of the
 * two numbers was the real one.
 *
 * The consequence is that ordinary feeding is never logged. Nobody records
 * forty pounds a head twice a day; the plans already say so. What does get
 * logged is what the plans do not know about — a torn bag, an extra bale in a
 * cold snap, or somebody counting the barn and finding it does not match.
 * On-hand is purchases, less those entries, less what the plans imply since
 * the last count.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function money(value: Money | undefined): string {
  return value === undefined ? "—" : formatMoney(value);
}

/** Round to a tenth — feed is bales and bags, not milligrams. */
function qty(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString();
}

const TABS = [
  { id: "barn", label: "In the barn" },
  { id: "types", label: "Feed types" },
  { id: "purchases", label: "Purchases" },
  { id: "used", label: "Used and counted" },
  { id: "cost", label: "Cost per head" },
] as const;

export function FeedScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: feeds, loading } = useRecords<FeedType>("feedTypes", query);
  const { records: purchases } = useRecords<FeedPurchase>("feedPurchases", query);
  const { records: consumption } = useRecords<FeedConsumption>("feedConsumption", query);
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);

  const now = new Date();
  const activePlans = useMemo(() => plans.filter((plan) => plan.active), [plans]);
  const liveAnimals = useMemo(
    () => animals.filter((animal) => animal.status === "active"),
    [animals],
  );

  /** Each animal with the pens it is standing in — both slots, outside and in. */
  const animalScopes = useMemo(
    () =>
      liveAnimals.map((animal) => ({
        id: animal.id,
        zoneIds: openAssignments(assignments, animal.id).map((entry) => entry.zoneId),
      })),
    [liveAnimals, assignments],
  );

  /**
   * Daily demand per feed type, summed over the herd (§5.3).
   *
   * Derived, never entered. Each animal resolves its own plans — animal over
   * zone over group — and the herd's demand is the sum of what each one is
   * actually on. Two cows on the same pen plan contribute twice, which is what
   * makes a pen of forty run the barn down forty times as fast.
   */
  const demand = useMemo(
    () => herdDemand({ plans: activePlans, feeds, animals: animalScopes, propertyId }),
    [animalScopes, activePlans, feeds, propertyId],
  );
  const demandByFeedType = demand.perDay;

  // Not memoised. It depends on `now`, which is a new object every render, so
  // a memo would recompute anyway while looking as though it did not. This is
  // a dozen feed types over a few hundred purchases — the honest cheap thing.
  const projections = feeds
    .filter((feed) => feed.active)
    .map((feed) => ({
      feed,
      projection: projectFeed(feed, purchases, consumption, demandByFeedType, now),
    }))
    .sort((left, right) => {
      // Soonest problem first: something to order today outranks a bale count
      // that is fine for another two months.
      const l = left.projection.orderBy?.getTime() ?? Number.POSITIVE_INFINITY;
      const r = right.projection.orderBy?.getTime() ?? Number.POSITIVE_INFINITY;
      return l - r;
    });

  const toOrder = projections.filter(
    ({ projection }) => projection.orderNow || projection.belowThreshold,
  );

  const spend = purchases.reduce(
    (total, purchase) => total + purchase.unitCost.cents * purchase.quantity,
    0,
  );

  return (
    <PageBody>
      <PageHeader
        eyebrow="Feed"
        title="Feed inventory"
        subtitle="What is in the barn, what the plans are eating through it, and the date you have to order by. Daily demand comes from the plans — it is never typed in."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Feed types" value={feeds.filter((feed) => feed.active).length} />
        <Tile
          label="To order now"
          value={toOrder.length}
          tone={toOrder.length > 0 ? "danger" : "calm"}
          emphasis={toOrder.length > 0}
          hint={toOrder.length > 0 ? "Lead time has caught up" : "Nothing pressing"}
        />
        <Tile
          label="Head being fed"
          value={
            animalScopes.filter(
              (scope) =>
                resolvedDemandFor(activePlans, scope.id, scope.zoneIds, [propertyId]).size > 0,
            ).length
          }
          tone="identity"
        />
        <Tile label="Spent on feed" value={money({ cents: Math.round(spend) })} />
      </div>

      {demand.unconvertible.length === 0 ? null : (
        <Callout
          tone="danger"
          title={`${demand.unconvertible.length} ration${demand.unconvertible.length === 1 ? "" : "s"} is not counted against the barn`}
        >
          {demand.unconvertible
            .map((feedTypeId) => feeds.find((feed) => feed.id === feedTypeId)?.name ?? "a feed")
            .join(", ")}
          . The plan is written in one unit and the feed is counted in another, and nothing says
          what one of those weighs. Give the feed its <em>lb each</em> on the Feed plans screen —
          until then the run-out date below leaves it out rather than counting it wrongly.
        </Callout>
      )}

      {toOrder.length === 0 ? null : (
        <Callout
          tone="danger"
          title={`${toOrder.length} feed${toOrder.length === 1 ? "" : "s"} to order`}
        >
          {toOrder.map(({ feed }) => feed.name).join(", ")}. The order-by date is the run-out date
          less the lead time — ordering on the run-out date is ordering a week late.
        </Callout>
      )}

      <Tabs tabs={TABS} label="Feed">
        {(active) => (
          <div className="pt-density">
            {active === "barn" ? (
              loading ? (
                <p className="text-muted">Looking…</p>
              ) : (
                <Barn projections={projections} now={now} />
              )
            ) : active === "types" ? (
              <Types
                feeds={feeds}
                purchases={purchases}
                consumption={consumption}
                plans={plans}
                propertyId={propertyId}
                actorId={actorId}
              />
            ) : active === "purchases" ? (
              <Purchases
                feeds={feeds}
                purchases={purchases}
                propertyId={propertyId}
                actorId={actorId}
              />
            ) : active === "used" ? (
              <Used
                feeds={feeds}
                consumption={consumption}
                animals={animals}
                zones={zones}
                propertyId={propertyId}
                actorId={actorId}
              />
            ) : (
              <CostPerHead
                feeds={feeds}
                plans={activePlans}
                purchases={purchases}
                animals={liveAnimals}
                scopes={animalScopes}
                propertyId={propertyId}
              />
            )}
          </div>
        )}
      </Tabs>
    </PageBody>
  );
}

/* ------------------------------------------------------------------- barn */

function Barn({
  projections,
  now,
}: {
  readonly projections: readonly { feed: FeedType; projection: FeedProjection }[];
  readonly now: Date;
}) {
  if (projections.length === 0) {
    return (
      <EmptyState
        title="No feed on file"
        detail="Add a feed type on the cattle feed-plan screen, then record what you bought. The run-out date follows from the plans."
      />
    );
  }

  return (
    <Section
      title="In the barn"
      description="On hand is what was bought, less what was logged, less what the plans say has gone out since the last count."
    >
      <CardGrid columns={3}>
        {projections.map(({ feed, projection }) => {
          const days =
            projection.runsOutOn === undefined
              ? undefined
              : Math.ceil((projection.runsOutOn.getTime() - now.getTime()) / 86_400_000);

          return (
            <RecordCard
              key={feed.id}
              tone={projection.orderNow ? "danger" : projection.belowThreshold ? "action" : "calm"}
              title={feed.name}
              subtitle={`${feed.category} · ${feed.unit.replace(/_/g, " ")}`}
              actions={
                <Pill tone={projection.orderNow ? "danger" : "neutral"} dot={projection.orderNow}>
                  {qty(projection.onHand)} {feed.unit.replace(/_/g, " ")}
                </Pill>
              }
              meta={
                <>
                  {projection.dailyDemand === 0 ? (
                    <Pill tone="neutral">no plan is feeding it</Pill>
                  ) : (
                    <Pill tone="identity">{qty(projection.dailyDemand)} a day</Pill>
                  )}
                  {projection.runsOutOn === undefined ? null : (
                    <Pill tone={days !== undefined && days <= 7 ? "danger" : "action"}>
                      runs out {formatDate(projection.runsOutOn)}
                    </Pill>
                  )}
                  {projection.orderBy === undefined ? null : (
                    <Pill tone={projection.orderNow ? "danger" : "neutral"}>
                      order by {formatDate(projection.orderBy)}
                    </Pill>
                  )}
                  {projection.belowThreshold ? <Pill tone="action">below reorder</Pill> : null}
                </>
              }
            >
              {projection.onHand < 0 ? (
                // Deliberately not clamped at zero. A negative count means the
                // records disagree with the barn, which is worth seeing.
                <p className="text-sm text-danger">
                  The records say less than nothing is left. Count the barn and log a correction —
                  that keeps the discrepancy rather than papering over it.
                </p>
              ) : (
                <Meter
                  value={
                    feed.reorderThreshold === undefined || feed.reorderThreshold <= 0
                      ? 0
                      : Math.min(1, projection.onHand / (feed.reorderThreshold * 3))
                  }
                  tone={projection.orderNow ? "danger" : "calm"}
                  label="Against three times the reorder point"
                  detail={
                    projection.reconciledOn === undefined
                      ? "Never counted"
                      : `Counted ${formatDate(projection.reconciledOn)}`
                  }
                />
              )}
            </RecordCard>
          );
        })}
      </CardGrid>
    </Section>
  );
}

/* -------------------------------------------------------------- purchases */

function Purchases({
  feeds,
  purchases,
  propertyId,
  actorId,
}: {
  readonly feeds: readonly FeedType[];
  readonly purchases: readonly FeedPurchase[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<FeedPurchase>(
    "feedPurchases",
    "feedPurchases",
    feedPurchaseSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const byId = useMemo(() => new Map(feeds.map((feed) => [feed.id, feed])), [feeds]);
  const [editing, setEditing] = useState<FeedPurchase | undefined>();
  // The editor is a side dialog now, so it needs an open state of its own —
  // `editing` alone cannot express \"adding a new one\".
  const [editorOpen, setEditorOpen] = useState(false);
  const [feedTypeId, setFeedTypeId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  function startEdit(purchase: FeedPurchase) {
    setEditorOpen(true);
    setEditing(purchase);
    setFeedTypeId(purchase.feedTypeId);
    setQuantity(String(purchase.quantity));
    setUnitCost((purchase.unitCost.cents / 100).toFixed(2));
    setPurchasedOn(purchase.purchasedOn.toISOString().slice(0, 10));
    setError(undefined);
  }

  function openEditor(): void {
    setEditorOpen(true);
  }

  function reset() {
    setEditorOpen(false);
    setEditing(undefined);
    setQuantity("");
    setUnitCost("");
    setError(undefined);
  }

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
        unitCost: fromDollars(Number(unitCost)),
        purchasedOn: new Date(`${purchasedOn}T12:00:00`),
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<FeedPurchase>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      show({ message: editing === undefined ? "Purchase recorded" : "Purchase updated" });
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function remove(purchase: FeedPurchase) {
    const feed = byId.get(purchase.feedTypeId);
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${qty(purchase.quantity)} ${feed?.name ?? "feed"} on ${formatDate(purchase.purchasedOn)}`,
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

    if (editing?.id === purchase.id) reset();
    await api.remove(purchase.id, "Removed from the feed purchases");
    show({ message: "Purchase deleted", tone: "danger" });
  }

  const columns: readonly Column<FeedPurchase>[] = [
    {
      key: "feed",
      header: "Feed",
      primary: true,
      render: (row) =>
        byId.get(row.feedTypeId)?.name ?? <span className="text-muted">Unknown</span>,
    },
    { key: "when", header: "Bought", render: (row) => formatDate(row.purchasedOn) },
    { key: "qty", header: "Quantity", numeric: true, render: (row) => qty(row.quantity) },
    { key: "cost", header: "Each", numeric: true, render: (row) => money(row.unitCost) },
    {
      key: "total",
      header: "Total",
      numeric: true,
      render: (row) => money({ cents: Math.round(row.unitCost.cents * row.quantity) }),
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
          onClose={reset}
        >
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Feed"
                value={feedTypeId}
                placeholder="Choose a feed"
                options={feeds.map((feed) => ({
                  value: feed.id,
                  label: `${feed.name} (${feed.unit.replace(/_/g, " ")})`,
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
                type="number"
                inputMode="decimal"
                step="0.01"
                numeric
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                required
              />
              <TextInput
                label="Bought"
                type="date"
                value={purchasedOn}
                onChange={(event) => setPurchasedOn(event.target.value)}
                required
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
            caption="Feed purchases"
            columns={columns}
            rows={[...purchases].sort((a, b) => b.purchasedOn.getTime() - a.purchasedOn.getTime())}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="Nothing bought yet"
                detail="Record what came off the trailer. Until something is bought, on-hand is nothing and there is no cost to allocate."
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
  feeds,
  consumption,
  animals,
  zones,
  propertyId,
  actorId,
}: {
  readonly feeds: readonly FeedType[];
  readonly consumption: readonly FeedConsumption[];
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<FeedConsumption>(
    "feedConsumption",
    "feedConsumption",
    feedConsumptionSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const byId = useMemo(() => new Map(feeds.map((feed) => [feed.id, feed])), [feeds]);
  const [editing, setEditing] = useState<FeedConsumption | undefined>();
  // The editor is a side dialog now, so it needs an open state of its own —
  // `editing` alone cannot express \"adding a new one\".
  const [editorOpen, setEditorOpen] = useState(false);

  function openEditor(): void {
    setEditorOpen(true);
  }
  const [feedTypeId, setFeedTypeId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [kind, setKind] = useState<ConsumptionKind>("extra");
  const [usedOn, setUsedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [zoneId, setZoneId] = useState("");
  const [animalId, setAnimalId] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  function reset() {
    setEditorOpen(false);
    setEditing(undefined);
    setQuantity("");
    setZoneId("");
    setAnimalId("");
    setError(undefined);
  }

  function startEdit(entry: FeedConsumption) {
    setEditorOpen(true);
    setEditing(entry);
    setFeedTypeId(entry.feedTypeId);
    setQuantity(String(entry.quantity));
    setKind(entry.kind);
    setUsedOn(entry.usedOn.toISOString().slice(0, 10));
    setZoneId(entry.zoneId ?? "");
    setAnimalId(entry.animalId ?? "");
    setError(undefined);
  }

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
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<FeedConsumption>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      show({
        message:
          kind === "correction"
            ? "Counted. The projection restarts from today."
            : "Recorded against the barn",
      });
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: FeedConsumption) {
    const feed = byId.get(entry.feedTypeId);
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${qty(entry.quantity)} ${feed?.name ?? "feed"} on ${formatDate(entry.usedOn)}`,
      entity: "feed entry",
      dependents: [{ entity: "On-hand count", label: "recomputed", effect: "deleted" as const }],
      consequence:
        entry.kind === "correction"
          ? "This is a count of the barn. Deleting it moves the projection back to the count before it."
          : undefined,
      action: "Delete",
    });
    if (!confirmed) return;

    if (editing?.id === entry.id) reset();
    await api.remove(entry.id, "Removed from the feed log");
    show({ message: "Entry deleted", tone: "danger" });
  }

  const columns: readonly Column<FeedConsumption>[] = [
    {
      key: "feed",
      header: "Feed",
      primary: true,
      render: (row) =>
        byId.get(row.feedTypeId)?.name ?? <span className="text-muted">Unknown</span>,
    },
    { key: "when", header: "When", render: (row) => formatDate(row.usedOn) },
    { key: "qty", header: "Quantity", numeric: true, render: (row) => qty(row.quantity) },
    {
      key: "kind",
      header: "Kind",
      render: (row) => (
        <Pill tone={row.kind === "correction" ? "identity" : "neutral"}>{row.kind}</Pill>
      ),
    },
    {
      key: "where",
      header: "Where",
      render: (row) => {
        const zone = zones.find((entry) => entry.id === row.zoneId);
        const animal = animals.find((entry) => entry.id === row.animalId);
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
        <Modal placement="side" title={"Edit"} onClose={reset}>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
              <Select
                label="Feed"
                value={feedTypeId}
                placeholder="Choose a feed"
                options={feeds.map((feed) => ({ value: feed.id, label: feed.name }))}
                onChange={(event) => setFeedTypeId(event.target.value)}
                required
              />
              <Select
                label="Kind"
                hint="A correction is you counting the barn — the projection restarts from it."
                value={kind}
                options={CONSUMPTION_KINDS.map((value) => ({ value, label: value }))}
                onChange={(event) => setKind(event.target.value as ConsumptionKind)}
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
            </div>

            {error === undefined ? null : (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={busy}>
                {editing === undefined ? "Log it" : "Save entry"}
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

      <Section title="Everything logged" actions={<Button onClick={openEditor}>Log feed</Button>}>
        <Card>
          <DataTable
            caption="Feed used and counted"
            columns={columns}
            rows={[...consumption].sort((a, b) => b.usedOn.getTime() - a.usedOn.getTime())}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="Nothing logged"
                detail="That is the ordinary case. The plans account for daily feeding, and this list holds only what they cannot know."
              />
            }
          />
        </Card>
      </Section>
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
function CostPerHead({
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
      render: (row) => (
        <span className="flex flex-wrap gap-1.5">
          {[...row.quantityByFeedType].map(([feedTypeId, quantity]) => (
            <Pill key={feedTypeId}>
              {qty(quantity)} {feedById.get(feedTypeId)?.name ?? "feed"}
            </Pill>
          ))}
        </span>
      ),
    },
    {
      key: "cost",
      header: "Cost",
      numeric: true,
      render: (row) => (
        <span className={row.costComplete ? "" : "text-muted"}>{money(row.cost)}</span>
      ),
    },
    {
      key: "complete",
      header: "",
      render: (row) =>
        row.costComplete ? null : (
          // Feed with no purchase behind it is valued at nothing, which
          // understates the animal rather than overstating it. Saying so beats
          // showing a confident wrong number.
          <Pill tone="action">a feed has no purchase behind it</Pill>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="Cost per head"
        description="Feed valued at what it was bought for, charged to the animals the plans actually fed."
        actions={
          <Select
            label="Over"
            hideLabel
            value={String(days)}
            options={PERIODS.map((period) => ({ value: period.value, label: period.label }))}
            onChange={(event) => setDays(Number(event.target.value))}
          />
        }
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Head fed" value={fed.length} />
          <Tile label="Cost per head" value={money(perHead)} tone="identity" emphasis />
          <Tile
            label="Client calves"
            value={clientCalves.length}
            tone="calm"
            hint={clientCalves.length > 0 ? "Billed to the owner" : undefined}
          />
          <Tile
            label="Missing a cost"
            value={incomplete.length}
            tone={incomplete.length > 0 ? "action" : "calm"}
            hint={incomplete.length > 0 ? "A feed has no purchase" : "Every figure complete"}
          />
        </div>

        <Card>
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
        </Card>
      </Section>

      <Section
        title="What a unit is worth"
        description="Weighted average of what was actually paid, not the last price — a barn holds bales bought at three prices."
      >
        <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
          {feeds
            .filter((feed) => feed.active)
            .map((feed) => (
              <RecordCard
                key={feed.id}
                title={feed.name}
                subtitle={feed.unit.replace(/_/g, " ")}
                actions={<Pill>{money(weightedAverageCost(feed.id, purchases))}</Pill>}
              />
            ))}
        </div>
      </Section>
    </div>
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
};

/**
 * The feeds themselves (§5.3, issue #18).
 *
 * Deleting one is **restrict**, not cascade. A feed type is named by every
 * purchase, every plan line and every entry in the log — cascading would take
 * a year of what you paid for hay with it, and there is no version of that
 * anybody wants. The alternative is on the same screen: mark it inactive and
 * it stops appearing in the pickers while the history stays where it is.
 */
function Types({
  feeds,
  purchases,
  consumption,
  plans,
  propertyId,
  actorId,
}: {
  readonly feeds: readonly FeedType[];
  readonly purchases: readonly FeedPurchase[];
  readonly consumption: readonly FeedConsumption[];
  readonly plans: readonly FeedingPlan[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<FeedType>("feedTypes", "feedTypes", feedTypeSchema, propertyId, actorId);
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<FeedType | undefined>();
  // The editor is a side dialog now, so it needs an open state of its own —
  // `editing` alone cannot express \"adding a new one\".
  const [editorOpen, setEditorOpen] = useState(false);

  function openEditor(): void {
    setEditorOpen(true);
  }
  const [draft, setDraft] = useState(BLANK_TYPE);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  /** What names each feed, so the restrict rule can say so rather than count. */
  const usage = useMemo(() => {
    const map = new Map<Ulid, string[]>();
    const note = (feedTypeId: Ulid, label: string) =>
      map.set(feedTypeId, [...(map.get(feedTypeId) ?? []), label]);

    for (const purchase of purchases) note(purchase.feedTypeId, "a purchase");
    for (const entry of consumption) note(entry.feedTypeId, "a log entry");
    for (const plan of plans) {
      for (const line of plan.lines) note(line.feedTypeId as Ulid, `the "${plan.name}" plan`);
    }
    return map;
  }, [purchases, consumption, plans]);

  function reset() {
    setEditorOpen(false);
    setEditing(undefined);
    setDraft(BLANK_TYPE);
    setError(undefined);
  }

  function startEdit(feed: FeedType) {
    setEditorOpen(true);
    setEditing(feed);
    setDraft({
      name: feed.name,
      category: feed.category,
      unit: feed.unit,
      estWeightLbPerUnit:
        feed.estWeightLbPerUnit === undefined ? "" : String(feed.estWeightLbPerUnit),
      reorderLeadDays: String(feed.reorderLeadDays),
      reorderThreshold: feed.reorderThreshold === undefined ? "" : String(feed.reorderThreshold),
      active: feed.active,
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
        category: draft.category,
        unit: draft.unit,
        estWeightLbPerUnit:
          draft.estWeightLbPerUnit === "" ? undefined : Number(draft.estWeightLbPerUnit),
        reorderLeadDays: Number(draft.reorderLeadDays),
        reorderThreshold:
          draft.reorderThreshold === "" ? undefined : Number(draft.reorderThreshold),
        active: draft.active,
      };

      const result =
        editing === undefined
          ? await api.create(payload as never)
          : await api.update(editing.id, payload as Partial<FeedType>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      show({ message: editing === undefined ? `${payload.name} added` : "Feed updated" });
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function remove(feed: FeedType) {
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

    if (editing?.id === feed.id) reset();
    await api.remove(feed.id, "Removed from the feed types");
    show({ message: `${feed.name} deleted`, tone: "danger" });
  }

  const columns: readonly Column<FeedType>[] = [
    { key: "name", header: "Feed", primary: true, render: (row) => row.name },
    { key: "category", header: "Category", render: (row) => <Pill>{row.category}</Pill> },
    { key: "unit", header: "Bought in", render: (row) => row.unit.replace(/_/g, " ") },
    {
      key: "weight",
      header: "Pounds each",
      numeric: true,
      render: (row) =>
        row.estWeightLbPerUnit === undefined ? (
          <span className="text-muted">—</span>
        ) : (
          qty(row.estWeightLbPerUnit)
        ),
    },
    {
      key: "lead",
      header: "Lead",
      numeric: true,
      render: (row) => `${row.reorderLeadDays} d`,
    },
    {
      key: "used",
      header: "Named by",
      render: (row) => {
        const named = [...new Set(usage.get(row.id) ?? [])];
        return named.length === 0 ? (
          <span className="text-muted">nothing yet</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {named.map((label) => (
              <Pill key={label}>{label}</Pill>
            ))}
          </span>
        );
      },
    },
    {
      key: "active",
      header: "",
      render: (row) => (row.active ? null : <Pill tone="neutral">inactive</Pill>),
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
        <Modal placement="side" title={"Edit"} onClose={reset}>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
              <TextInput
                label="Name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                required
              />
              <Select
                label="Category"
                value={draft.category}
                options={FEED_CATEGORIES.map((value) => ({ value, label: value }))}
                onChange={(event) =>
                  setDraft({ ...draft, category: event.target.value as FeedCategory })
                }
              />
              <Select
                label="Bought in"
                value={draft.unit}
                options={FEED_UNITS.map((value) => ({
                  value,
                  label: value.replace(/_/g, " "),
                }))}
                onChange={(event) => setDraft({ ...draft, unit: event.target.value as FeedUnit })}
              />
              <TextInput
                label="Pounds per unit"
                hint="Leave blank when the unit is already a weight."
                type="number"
                inputMode="decimal"
                numeric
                value={draft.estWeightLbPerUnit}
                onChange={(event) => setDraft({ ...draft, estWeightLbPerUnit: event.target.value })}
              />
              <TextInput
                label="Reorder lead (days)"
                hint="How long the supplier takes. The alert leads the run-out date by this."
                type="number"
                inputMode="numeric"
                numeric
                value={draft.reorderLeadDays}
                onChange={(event) => setDraft({ ...draft, reorderLeadDays: event.target.value })}
                required
              />
              <TextInput
                label="Reorder threshold"
                hint="On hand at or below this raises a low-stock warning."
                type="number"
                inputMode="decimal"
                numeric
                value={draft.reorderThreshold}
                onChange={(event) => setDraft({ ...draft, reorderThreshold: event.target.value })}
              />
            </div>

            <Checkbox
              label="Still bought"
              hint="Unticking hides it from the pickers and keeps every record that names it."
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
            />

            {error === undefined ? null : (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={busy}>
                {editing === undefined ? "Add feed" : "Save feed"}
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

      <Section title="Every feed" actions={<Button onClick={openEditor}>Add a feed</Button>}>
        <Card>
          <DataTable
            caption="Feed types"
            columns={columns}
            rows={[...feeds].sort((a, b) => a.name.localeCompare(b.name))}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                title="No feed on file"
                detail="Add the hay, the grain and the mineral you actually buy. Everything else here hangs off these."
              />
            }
          />
        </Card>
      </Section>
    </div>
  );
}
