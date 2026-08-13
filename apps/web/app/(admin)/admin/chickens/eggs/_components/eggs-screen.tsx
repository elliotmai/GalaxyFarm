"use client";

import { PageBody, PageHeader, Tabs, Tile } from "@galaxy-farm/ui";
import { addCalendarDays, endOfDay, startOfDay, type Contact, type Ulid } from "@galaxy-farm/core";
import {
  eggsOnHand,
  layRate,
  totalBirdsOn,
  type EggDisposition,
  type EggLog,
  type Flock,
  type FlockAdjustment,
} from "@galaxy-farm/module-poultry";

import { CollectPanel } from "@/app/(admin)/admin/chickens/eggs/_components/collect-panel";
import { DispositionsPanel } from "@/app/(admin)/admin/chickens/eggs/_components/dispositions-panel";
import { EggLogPanel } from "@/app/(admin)/admin/chickens/eggs/_components/egg-log-panel";
import { TrendsPanel } from "@/app/(admin)/admin/chickens/eggs/_components/trends-panel";
import { useRecords } from "@/lib/local/use-records";

/**
 * Eggs (spec §5.4, §7 `/admin/chickens/eggs` — "logs + trends").
 *
 * The screen is arranged the way the job is: collect first, look at the
 * history second, ask what it means third. §8's "logging must be fast" decides
 * the first tab — a total and a date, both already filled in, and a breakdown
 * only for whoever wants one.
 *
 * Every number above the tabs is derived from the two logs. Nothing here is a
 * stored total, so correcting a miscounted Tuesday corrects the week, the lay
 * rate, and the basket at the same time.
 */

/** Seven days including today, which is what "last 7 days" means out loud. */
const WEEK_DAYS = 6;

export function EggsScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: logs, loading } = useRecords<EggLog>("eggLogs", query);
  const { records: dispositions, loading: goneLoading } = useRecords<EggDisposition>(
    "eggDispositions",
    query,
  );
  const { records: flocks } = useRecords<Flock>("flocks", query);
  const { records: adjustments } = useRecords<FlockAdjustment>("flockAdjustments", query);
  const { records: contacts } = useRecords<Contact>("contacts", query);

  /**
   * Whole days, and "now" is the end of today.
   *
   * A collection carries a *date*, and a date-only value is stored at midday so
   * it reads as the same day whichever timezone a device is set to. Asked as of
   * the instant, the basket brought in at half past six this morning is stamped
   * six hours in the future and none of these tiles would show it — which is
   * exactly when somebody is standing there having just logged it.
   */
  const now = endOfDay(new Date());
  const today = startOfDay(now);
  const weekAgo = startOfDay(addCalendarDays(now, -WEEK_DAYS));

  const collectedToday = logs
    .filter((log) => log.collectedOn >= today && log.collectedOn <= now)
    .reduce((total, log) => total + log.total, 0);
  const collectedWeek = logs
    .filter((log) => log.collectedOn >= weekAgo && log.collectedOn <= now)
    .reduce((total, log) => total + log.total, 0);

  const birds = totalBirdsOn(flocks, adjustments, now);
  const rate = layRate(logs, birds, { from: weekAgo, to: now });
  const basket = eggsOnHand(logs, dispositions, now);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Flock"
        title="Eggs"
        subtitle="What came in this morning, what the week looks like, and where they went."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Today"
          value={collectedToday}
          tone="identity"
          emphasis
          hint={collectedToday === 0 ? "Nothing logged yet today" : "Collected today"}
        />
        <Tile label="Last 7 days" value={collectedWeek} tone="action" />
        <Tile
          label="Per bird per day"
          value={rate === undefined ? "—" : rate.toFixed(2)}
          tone={rate === undefined ? "neutral" : rate < 0.4 ? "danger" : "calm"}
          hint={
            birds === 0
              ? "No birds counted — add a flock and its headcount"
              : `Over 7 days, across ${birds} bird${birds === 1 ? "" : "s"}`
          }
        />
        <Tile
          label="In the basket"
          value={basket}
          tone={basket < 0 ? "danger" : "neutral"}
          hint={
            basket < 0
              ? "More has gone out than was logged coming in"
              : "Collected, less what has left"
          }
        />
      </div>

      <Tabs
        label="Eggs"
        tabs={[
          { id: "collect", label: "Collect" },
          { id: "log", label: "Log" },
          { id: "trends", label: "Trends" },
          { id: "gone", label: "Where they went" },
        ]}
      >
        {(active) =>
          active === "collect" ? (
            <CollectPanel flocks={flocks} logs={logs} propertyId={propertyId} actorId={actorId} />
          ) : active === "log" ? (
            <EggLogPanel
              logs={logs}
              flocks={flocks}
              loading={loading}
              propertyId={propertyId}
              actorId={actorId}
            />
          ) : active === "trends" ? (
            <TrendsPanel logs={logs} flocks={flocks} adjustments={adjustments} />
          ) : (
            <DispositionsPanel
              dispositions={dispositions}
              contacts={contacts}
              loading={goneLoading}
              propertyId={propertyId}
              actorId={actorId}
            />
          )
        }
      </Tabs>
    </PageBody>
  );
}
