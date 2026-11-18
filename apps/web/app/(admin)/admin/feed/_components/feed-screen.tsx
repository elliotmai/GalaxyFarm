"use client";

import { useMemo, useState } from "react";

import { Fab, PageBody, Tabs, useToast } from "@galaxy-farm/ui";
import {
  choreDaySheet,
  startOfDay,
  taskSchema,
  type Animal,
  type ChoreEntry,
  type Contact,
  type FeedingPlan,
  type Task,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";

import {
  herdDemand,
  projectFeed,
  type ConsumptionKind,
  type FeedConsumption,
  type FeedPurchase,
  type FeedType,
} from "@galaxy-farm/module-feed";

import { FeedingPlanEditor, usePlanFlocks } from "@/app/(admin)/_components/feeding-plan-editor";
import { useShareSummary } from "@/app/(admin)/_components/share-button";
import { toggleChore } from "@/lib/chores";
import { feedingChoresFor, feedingChoreText } from "@/lib/feeding-chores";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

import { KitHeader } from "../../equipment/_components/kit-controls";
import { feedUsage, line } from "./feed-format";
import { PurchaseForm, TypeForm, UseForm, useFeedRemovals } from "./feed-forms";
import { PlanView } from "./feed-plan";
import { isLow, ShedView } from "./feed-shed";
import { TodayView } from "./feed-today";
import { CostPerHeadTab, PurchasesTab, TypesTab, UsedTab } from "./feed-views";

/**
 * Farm › Feed (spec §5.3, issue #18): Today, Plan and Shed.
 *
 * Feeding is three jobs, and each segment is one of them — tick off a
 * feeding, adjust who gets what, restock the shed. They share a screen
 * because they are one subject: the plans make today's feedings and eat the
 * shed down, so a change on Plan shows up on the other two at once.
 *
 * §5.3 is explicit that daily demand is **derived from the active feeding
 * plans and never typed in** — so there is no "how much do you feed a day"
 * field anywhere here. Type one and it would be wrong the day a plan changed,
 * and nobody would know which of the two numbers was the real one. The
 * consequence is that ordinary feeding is never logged as feed used; what is
 * logged is what the plans do not know about (a torn bag, a count of the
 * shed), and on-hand is purchases, less those entries, less what the plans
 * imply since the last count.
 *
 * Nothing here has a write path of its own. The tick is `toggleChore`, the one
 * the kiosk and the dashboard use; the plan editor is Cattle › Feed plans'
 * own; the purchase, count and feed-type panels are `feed-forms.tsx`.
 */

export type FeedView = "today" | "plan" | "shed";

const VIEWS: readonly { id: FeedView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "plan", label: "Plan" },
  { id: "shed", label: "Shed" },
];

const HISTORY_TABS = [
  { id: "purchases", label: "Purchases" },
  { id: "used", label: "Used and counted" },
  { id: "types", label: "Feed types" },
  { id: "cost", label: "Cost per head" },
] as const;

/** Which side panel is open, and on what. */
type Panel =
  | {
      readonly kind: "purchase";
      readonly purchase?: FeedPurchase;
      readonly start?: { readonly feedTypeId?: Ulid };
    }
  | {
      readonly kind: "use";
      readonly entry?: FeedConsumption;
      readonly start?: { readonly feedTypeId?: Ulid; readonly kind?: ConsumptionKind };
    }
  | { readonly kind: "type"; readonly feed?: FeedType }
  // Held by id, not the record: the list is a live query and a sync pull
  // mid-edit replaces every object in it.
  | { readonly kind: "plan"; readonly planId: Ulid | "new" };

export function FeedScreen({
  propertyId,
  actorId,
  initialView = "today",
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** `?view=plan` — how Cattle › Feed plans links straight to the plans. */
  readonly initialView?: FeedView | undefined;
}) {
  const query = { propertyId };
  const { records: feeds, loading } = useRecords<FeedType>("feedTypes", query);
  const { records: purchases } = useRecords<FeedPurchase>("feedPurchases", query);
  const { records: consumption } = useRecords<FeedConsumption>("feedConsumption", query);
  const { records: plans, loading: plansLoading } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: tasks } = useRecords<Task>("tasks", query);
  const { records: contacts } = useRecords<Contact>("contacts", query);

  const [view, setView] = useState<FeedView>(initialView);
  const [panel, setPanel] = useState<Panel | undefined>();

  const now = new Date();
  /**
   * The minute, as a memo key.
   *
   * The projections below depend on the time, and a fresh `Date` every render
   * would recompute them on every render — opening a panel, a keystroke that
   * re-renders the screen, each round of a sync pull. A minute is finer than
   * anything shown (run-out is a day, "overdue" is a feeding time).
   */
  const minute = Math.floor(now.getTime() / 60_000);
  const activePlans = useMemo(() => plans.filter((plan) => plan.active), [plans]);
  const liveAnimals = useMemo(
    () => animals.filter((animal) => animal.status === "active"),
    [animals],
  );

  /** The animals on the place — the only ones a plan's feed is drawn for. */
  const animalScopes = useMemo(
    () => liveAnimals.map((animal) => ({ id: animal.id })),
    [liveAnimals],
  );
  /** Flocks and today's headcounts, for the hens' and quail's plans. */
  const flocks = usePlanFlocks(propertyId);

  /**
   * Daily demand per feed type, summed over every plan (§5.3).
   *
   * Derived, never entered: each active plan's lines × how often × its heads
   * on the place (for an "each" amount). A plan of forty runs the shed down
   * forty times as fast; a tub shared between them does not.
   */
  const demand = useMemo(
    () => herdDemand({ plans: activePlans, feeds, animals: animalScopes, flocks }),
    [animalScopes, activePlans, feeds, flocks],
  );

  // Memoised to the minute (see `minute`), so a re-render that changed none of
  // the inputs does not walk every purchase and entry once per feed again.
  const shed = useMemo(() => {
    const at = new Date(minute * 60_000);
    return feeds
      .filter((feed) => feed.active)
      .map((feed) => ({
        feed,
        projection: projectFeed(feed, purchases, consumption, demand.perDay, at),
      }))
      .sort((left, right) => {
        // Soonest problem first: something to order today outranks a bale count
        // that is fine for another two months.
        const l = left.projection.orderBy?.getTime() ?? Number.POSITIVE_INFINITY;
        const r = right.projection.orderBy?.getTime() ?? Number.POSITIVE_INFINITY;
        return l - r;
      });
  }, [feeds, purchases, consumption, demand, minute]);
  const low = shed.filter((row) => isLow(row, now));

  /* ------------------------------------------------------------- today */

  /**
   * Today's feedings: the kiosk's day sheet, narrowed to feeding.
   *
   * Built the way the kiosk and the dashboard build it — the trips the plans
   * add up to, merged by `choreDaySheet` with the rows ticks have written — so
   * all three agree. A ticked trip is a stored row carrying the trip's id as
   * its `sourceKey`, which is how it is told apart from a template's chore.
   */
  const today = startOfDay(now);
  // Memoised to the minute: `tasks` is every chore the place has ever had, and
  // this walks all of it. It used to run on every render of the screen.
  const feedings = useMemo(() => {
    const at = new Date(minute * 60_000);
    const day = startOfDay(at);
    const derived = feedingChoresFor(plans, feedingChoreText({ zones, feeds, animals }), day, at);
    // Only the feeding rows go in. The sheet otherwise carries every chore
    // still owed from any day before, to be thrown away by the filter after.
    const feedingTasks = tasks.filter((task) => task.sourceKey?.startsWith("feeding:"));
    return choreDaySheet({ tasks: feedingTasks, templates: [], derived }, day, at);
  }, [plans, zones, feeds, propertyId, tasks, minute]);
  const fed = feedings.filter((entry) => entry.completedAt !== undefined).length;

  // The feeding round, as somebody covering it needs it: when, which ration,
  // what goes in, and whether it is done yet.
  useShareSummary({
    title: "Feeding today",
    lines:
      feedings.length === 0
        ? ["No feeding plans are switched on."]
        : feedings.map(
            (entry) =>
              `${entry.completedAt === undefined ? "☐" : "☑"} ${entry.title}${
                entry.detail === undefined ? "" : ` — ${entry.detail}`
              }`,
          ),
  });

  const tasksApi = useMutations<Task>("tasks", "tasks", taskSchema, propertyId, actorId);
  const { show } = useToast();
  const [ticking, setTicking] = useState<string | undefined>();

  async function tick(entry: ChoreEntry) {
    setTicking(entry.id);
    try {
      // A feeding trip has no template behind it; `toggleChore` writes the
      // row already complete, or un-ticks the row a tick wrote.
      const result = await toggleChore(tasksApi, {
        entry,
        template: undefined,
        date: today,
        at: new Date(),
        actorId,
      });
      if (!result.ok) show({ message: "Could not tick that off", tone: "danger" });
    } finally {
      setTicking(undefined);
    }
  }

  /* ------------------------------------------------------------- panels */

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
   * confirmation (through `useConfirmDelete`) is the only dialog.
   */
  function closeThenRun<T>(entry: T | undefined, run: (entry: T) => Promise<void>) {
    return entry === undefined
      ? undefined
      : () => {
          close();
          void run(entry);
        };
  }

  const restock = (feed?: FeedType) =>
    setPanel({
      kind: "purchase",
      ...(feed === undefined ? {} : { start: { feedTypeId: feed.id } }),
    });
  const addPlan = () => setPanel({ kind: "plan", planId: "new" });

  /** One line beside the title: what each segment adds up to. */
  const facts = line(
    feedings.length > 0 && `${fed} of ${feedings.length} fed`,
    `${activePlans.length} plan${activePlans.length === 1 ? "" : "s"}`,
    low.length > 0 && `${low.length} low`,
  );

  /* ------------------------------------------------------------ views */

  function choose(next: FeedView) {
    setView(next);
    // Kept in the address so a reload, or a link sent from a phone, lands on
    // the same segment. Best effort: nothing depends on it.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("view", next);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* no history to write to */
    }
  }

  const editingPlan =
    panel?.kind === "plan" && panel.planId !== "new"
      ? plans.find((plan) => plan.id === panel.planId)
      : undefined;

  return (
    <PageBody>
      {/* Bottom clearance on a phone for the floating add button. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <KitHeader title="Feed" facts={loading ? undefined : facts} />

        {/* The shared Tabs, not a hand-built copy: same segmented look, same
            keyboard pattern, as every other page that swaps panels in place. */}
        <Tabs
          tabs={VIEWS}
          activeTab={view}
          onTabChange={(id) => choose(id as FeedView)}
          label="Feed"
        >
          {() => (
            <div className="flex flex-col gap-density">
              {view === "today" ? (
                <>
                  <TodayView
                    entries={feedings}
                    actorId={actorId}
                    busy={ticking}
                    onTick={(entry) => void tick(entry)}
                  />
                  {feedings.length === 0 ? null : (
                    <p className="text-sm text-muted">The same ticks as the barn kiosk.</p>
                  )}
                </>
              ) : view === "plan" ? (
                <PlanView
                  plans={plans}
                  feeds={feeds}
                  animals={animals}
                  zones={zones}
                  flocks={flocks}
                  loading={plansLoading}
                  onAdd={addPlan}
                  onAdjust={(plan) => setPanel({ kind: "plan", planId: plan.id })}
                />
              ) : (
                <>
                  {/*
                Worth interrupting for: a plan written in one unit for a feed
                counted in another, with nothing saying what one weighs. Left
                out of the run-out date rather than counted wrongly; the fix is
                the feed's "lb each", which the feed's own panel holds.
              */}
                  {demand.unconvertible.length === 0 ? null : (
                    <p className="text-sm text-danger">
                      Not counted against the shed:{" "}
                      {demand.unconvertible.map((feedTypeId, index) => {
                        const feed = feeds.find((candidate) => candidate.id === feedTypeId);
                        return (
                          <span key={feedTypeId}>
                            {index === 0 ? "" : ", "}
                            {feed === undefined ? (
                              "a feed"
                            ) : (
                              <button
                                type="button"
                                onClick={() => setPanel({ kind: "type", feed })}
                                className="inline-flex min-h-target items-center font-semibold underline underline-offset-2"
                              >
                                {feed.name}
                              </button>
                            )}
                          </span>
                        );
                      })}
                      . Give {demand.unconvertible.length === 1 ? "it" : "each"} its lb each.
                    </p>
                  )}
                  <ShedView
                    rows={shed}
                    now={now}
                    loading={loading}
                    onRestock={restock}
                    onAddFeed={() => setPanel({ kind: "type" })}
                    onCount={(feed) =>
                      setPanel({
                        kind: "use",
                        start: {
                          kind: "correction",
                          ...(feed === undefined ? {} : { feedTypeId: feed.id }),
                        },
                      })
                    }
                    history={
                      <Tabs tabs={HISTORY_TABS} label="Feed history">
                        {(active) =>
                          active === "purchases" ? (
                            <PurchasesTab
                              feeds={feeds}
                              purchases={purchases}
                              onAdd={() => restock()}
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
                          ) : active === "types" ? (
                            <TypesTab
                              feeds={feeds}
                              usage={usage}
                              onAdd={() => setPanel({ kind: "type" })}
                              onEdit={(feed) => setPanel({ kind: "type", feed })}
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
                          )
                        }
                      </Tabs>
                    }
                  />
                </>
              )}
            </div>
          )}
        </Tabs>

        {view === "plan" ? (
          <Fab onClick={addPlan}>Add plan</Fab>
        ) : view === "shed" ? (
          <Fab onClick={() => restock()}>Record purchase</Fab>
        ) : null}
      </div>

      {panel?.kind === "purchase" ? (
        <PurchaseForm
          key={panel.purchase?.id ?? `new-${panel.start?.feedTypeId ?? ""}`}
          feeds={feeds}
          contacts={contacts}
          editing={panel.purchase}
          start={panel.start}
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
      ) : panel?.kind === "plan" && (panel.planId === "new" || editingPlan !== undefined) ? (
        // The editor Cattle › Feed plans opens, against every species here.
        <FeedingPlanEditor
          key={editingPlan?.id ?? "new"}
          plan={editingPlan}
          animals={animals}
          flocks={flocks}
          zones={zones}
          feeds={feeds}
          propertyId={propertyId}
          actorId={actorId}
          onClose={close}
        />
      ) : null}
    </PageBody>
  );
}
