"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, PageBody, Tabs } from "@galaxy-farm/ui";
import {
  openAssignments,
  type Animal,
  type FeedingPlan,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import { penAssignments } from "@galaxy-farm/module-pets";
import {
  herdDemand,
  projectFeed,
  resolvedDemandFor,
  type ConsumptionKind,
  type FeedConsumption,
  type FeedPurchase,
  type FeedType,
} from "@galaxy-farm/module-feed";

import { useRecords } from "@/lib/local/use-records";

import { AddFab, KitHeader } from "../../equipment/_components/kit-controls";
import { feedUsage, line, money } from "./feed-format";
import { PurchaseForm, TypeForm, UseForm, useFeedRemovals } from "./feed-forms";
import { BarnTab, CostPerHeadTab, PurchasesTab, TypesTab, UsedTab } from "./feed-views";

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
 *
 * This file is the frame — the facts, the two lines worth interrupting for,
 * the tabs, and which side panel is open. The tabs are lists
 * (`feed-views.tsx`) and every write is a panel (`feed-forms.tsx`).
 */

/** Which side panel is open, and on what. */
type Panel =
  | { readonly kind: "purchase"; readonly purchase?: FeedPurchase }
  | {
      readonly kind: "use";
      readonly entry?: FeedConsumption;
      readonly start?: { readonly feedTypeId?: Ulid; readonly kind?: ConsumptionKind };
    }
  | { readonly kind: "type"; readonly feed?: FeedType };

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

  const [panel, setPanel] = useState<Panel | undefined>();

  const now = new Date();
  const activePlans = useMemo(() => plans.filter((plan) => plan.active), [plans]);
  const liveAnimals = useMemo(
    () => animals.filter((animal) => animal.status === "active"),
    [animals],
  );

  /**
   * Each animal with the pens it is standing in — both slots, outside and in.
   *
   * Pets bring none (§5.8): a dog has no pen, so a placement naming one — the
   * property map used to let somebody drag him onto a pasture — would put him
   * on that pen's ration and add a dog's worth of range cubes to what the herd
   * is projected to eat. His own bowl is an animal-target plan and is unaffected.
   */
  const animalScopes = useMemo(() => {
    const placements = penAssignments(assignments, liveAnimals);
    return liveAnimals.map((animal) => ({
      id: animal.id,
      zoneIds: openAssignments(placements, animal.id).map((entry) => entry.zoneId),
    }));
  }, [liveAnimals, assignments]);

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

  const usage = useMemo(
    () => feedUsage(purchases, consumption, plans),
    [purchases, consumption, plans],
  );
  const { removePurchase, removeEntry, removeType } = useFeedRemovals({
    feeds,
    usage,
    propertyId,
    actorId,
  });

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

  const headFed = animalScopes.filter(
    (scope) => resolvedDemandFor(activePlans, scope.id, scope.zoneIds, [propertyId]).size > 0,
  ).length;

  /** The tiles, said once beside the title. */
  const facts = line(
    `${feeds.filter((feed) => feed.active).length} feeds`,
    `${headFed} head fed`,
    spend > 0 ? `${money({ cents: Math.round(spend) })} spent` : undefined,
  );

  const addPurchase = () => setPanel({ kind: "purchase" });

  return (
    <PageBody>
      {/* Bottom clearance on a phone for the floating add button. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <KitHeader
          eyebrow="Kit"
          title="Feed inventory"
          facts={loading ? undefined : facts}
          action={
            <Button variant="primary" onClick={addPurchase}>
              <span aria-hidden="true">+</span> Record purchase
            </Button>
          }
        />

        {/*
          The two things worth interrupting for, one line each. The order-by
          date is the run-out date less the lead time — ordering on the run-out
          date is ordering a week late — so that is the date the line names.
        */}
        {toOrder.length === 0 ? null : (
          <p className="text-sm text-danger">
            To order: {toOrder.map(({ feed }) => feed.name).join(", ")}
          </p>
        )}
        {demand.unconvertible.length === 0 ? null : (
          // A plan written in one unit for a feed counted in another, with
          // nothing saying what one weighs. Left out of the run-out date rather
          // than counted wrongly; the fix is the feed's "lb each".
          <p className="text-sm text-danger">
            Not counted against the barn:{" "}
            {demand.unconvertible
              .map((feedTypeId) => feeds.find((feed) => feed.id === feedTypeId)?.name ?? "a feed")
              .join(", ")}
            . Give {demand.unconvertible.length === 1 ? "it" : "each"} a weight per unit on{" "}
            <Link href="/admin/cattle/feed" className="font-semibold underline underline-offset-2">
              Feed plans
            </Link>
            .
          </p>
        )}

        <Tabs tabs={TABS} label="Feed">
          {(active) => (
            <div className="pt-density">
              {active === "barn" ? (
                loading ? (
                  <p className="text-muted">Looking…</p>
                ) : (
                  <BarnTab
                    projections={projections}
                    now={now}
                    onCount={(feed) =>
                      setPanel({
                        kind: "use",
                        start: {
                          kind: "correction",
                          ...(feed === undefined ? {} : { feedTypeId: feed.id }),
                        },
                      })
                    }
                  />
                )
              ) : active === "types" ? (
                <TypesTab
                  feeds={feeds}
                  usage={usage}
                  onAdd={() => setPanel({ kind: "type" })}
                  onEdit={(feed) => setPanel({ kind: "type", feed })}
                />
              ) : active === "purchases" ? (
                <PurchasesTab
                  feeds={feeds}
                  purchases={purchases}
                  onAdd={addPurchase}
                  onEdit={(purchase) => setPanel({ kind: "purchase", purchase })}
                />
              ) : active === "used" ? (
                <UsedTab
                  feeds={feeds}
                  consumption={consumption}
                  animals={animals}
                  zones={zones}
                  onAdd={() => setPanel({ kind: "use" })}
                  onEdit={(entry) => setPanel({ kind: "use", entry })}
                />
              ) : (
                <CostPerHeadTab
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

        <AddFab label="Record purchase" onClick={addPurchase} />
      </div>

      {panel?.kind === "purchase" ? (
        <PurchaseForm
          key={panel.purchase?.id ?? "new"}
          feeds={feeds}
          editing={panel.purchase}
          propertyId={propertyId}
          actorId={actorId}
          onClose={close}
          onDelete={closeThenRun(panel.purchase, removePurchase)}
        />
      ) : panel?.kind === "use" ? (
        <UseForm
          key={panel.entry?.id ?? `new-${panel.start?.feedTypeId ?? ""}`}
          feeds={feeds}
          animals={animals}
          zones={zones}
          editing={panel.entry}
          start={panel.start}
          propertyId={propertyId}
          actorId={actorId}
          onClose={close}
          onDelete={closeThenRun(panel.entry, removeEntry)}
        />
      ) : panel?.kind === "type" ? (
        <TypeForm
          key={panel.feed?.id ?? "new"}
          editing={panel.feed}
          propertyId={propertyId}
          actorId={actorId}
          onClose={close}
          onDelete={closeThenRun(panel.feed, removeType)}
        />
      ) : null}
    </PageBody>
  );
}
