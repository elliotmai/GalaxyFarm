"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { PageBody, Tabs, useToast } from "@galaxy-farm/ui";
import {
  choreDaySheet,
  openAssignments,
  startOfDay,
  taskSchema,
  type Animal,
  type ChoreEntry,
  type FeedingPlan,
  type Task,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import { penAssignments } from "@galaxy-farm/module-pets";
import {
  herdDemand,
  projectFeed,
  type ConsumptionKind,
  type FeedConsumption,
  type FeedPurchase,
  type FeedType,
} from "@galaxy-farm/module-feed";

import {
  PlanForm,
  usePlanActions,
} from "@/app/(admin)/admin/cattle/feed/_components/cattle-feed-screen";
import { toggleChore } from "@/lib/chores";
import { feedingChoresFor, feedingChoreText } from "@/lib/feeding-chores";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

import { AddFab, KitHeader } from "../../equipment/_components/kit-controls";
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
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: tasks } = useRecords<Task>("tasks", query);

  const [view, setView] = useState<FeedView>(initialView);
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
   * makes a pen of forty run the shed down forty times as fast.
   */
  const demand = useMemo(
    () => herdDemand({ plans: activePlans, feeds, animals: animalScopes, propertyId }),
    [animalScopes, activePlans, feeds, propertyId],
  );

  // Not memoised. It depends on `now`, which is a new object every render, so
  // a memo would recompute anyway while looking as though it did not. This is
  // a dozen feed types over a few hundred purchases — the honest cheap thing.
  const shed = feeds
    .filter((feed) => feed.active)
    .map((feed) => ({
      feed,
      projection: projectFeed(feed, purchases, consumption, demand.perDay, now),
    }))
    .sort((left, right) => {
      // Soonest problem first: something to order today outranks a bale count
      // that is fine for another two months.
      const l = left.projection.orderBy?.getTime() ?? Number.POSITIVE_INFINITY;
      const r = right.projection.orderBy?.getTime() ?? Number.POSITIVE_INFINITY;
      return l - r;
    });
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
  const derived = feedingChoresFor(
    plans,
    feedingChoreText({ zones, feeds, propertyId }),
    today,
    now,
  );
  const feedingRows = new Set(
    tasks.filter((task) => task.sourceKey?.startsWith("feeding:")).map((task) => task.id),
  );
  const feedings = choreDaySheet({ tasks, templates: [], derived }, today, now).filter(
    (entry) =>
      entry.id.startsWith("feeding:") ||
      (entry.taskId !== undefined && feedingRows.has(entry.taskId)),
  );
  const fed = feedings.filter((entry) => entry.completedAt !== undefined).length;

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
  const planActions = usePlanActions(propertyId, actorId);

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

  /* ---------------------------------------------------- segmented control */

  const segmentRefs = useRef(new Map<FeedView, HTMLButtonElement>());

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

  function onSegmentKey(event: KeyboardEvent<HTMLDivElement>) {
    const index = VIEWS.findIndex((entry) => entry.id === view);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = VIEWS[(index + step + VIEWS.length) % VIEWS.length];
    if (next === undefined) return;
    choose(next.id);
    segmentRefs.current.get(next.id)?.focus();
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

        <div
          role="tablist"
          aria-label="Feed"
          onKeyDown={onSegmentKey}
          className="flex gap-0.5 rounded-density bg-raised p-1 sm:max-w-md"
        >
          {VIEWS.map((entry) => {
            const selected = entry.id === view;
            return (
              <button
                key={entry.id}
                ref={(node) => {
                  // crud-guard: allow-unconfirmed — a ref map of DOM nodes, nothing persisted
                  if (node === null) segmentRefs.current.delete(entry.id);
                  else segmentRefs.current.set(entry.id, node);
                }}
                type="button"
                role="tab"
                id={`feed-segment-${entry.id}`}
                aria-selected={selected}
                aria-controls="feed-segment-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(entry.id)}
                className={[
                  "min-h-target flex-1 rounded-density text-density",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-action",
                  selected
                    ? "bg-panel font-semibold text-ink shadow-sm"
                    : "font-medium text-muted hover:text-ink",
                ].join(" ")}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id="feed-segment-panel"
          aria-labelledby={`feed-segment-${view}`}
          className="flex flex-col gap-density"
        >
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
              scopes={animalScopes}
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

        {view === "plan" ? (
          <AddFab label="Add plan" onClick={addPlan} />
        ) : view === "shed" ? (
          <AddFab label="Record purchase" onClick={() => restock()} />
        ) : null}
      </div>

      {panel?.kind === "purchase" ? (
        <PurchaseForm
          key={panel.purchase?.id ?? `new-${panel.start?.feedTypeId ?? ""}`}
          feeds={feeds}
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
        <PlanForm
          key={editingPlan?.id ?? "new"}
          plan={editingPlan}
          animals={animals}
          zones={zones}
          feeds={feeds}
          api={planActions.api}
          propertyId={propertyId}
          anySpecies
          onClose={close}
          onToggle={(plan) => void planActions.toggle(plan)}
          onDelete={(plan) => {
            // The panel closes first, so the confirmation is the only dialog.
            close();
            void planActions.remove(plan);
          }}
        />
      ) : null}
    </PageBody>
  );
}
