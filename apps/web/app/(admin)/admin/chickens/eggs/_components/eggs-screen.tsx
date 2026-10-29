"use client";

import { PageBody, PageHeader, Tabs } from "@galaxy-farm/ui";
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
 * Every number in the header is derived from the two logs. Nothing here is a
 * stored total, so correcting a miscounted Tuesday corrects the week, the lay
 * rate, and the basket at the same time.
 */

/** Seven days including today, which is what "last 7 days" means out loud. */
const WEEK_DAYS = 6;

const TABS = [
  { id: "collect", label: "Collect" },
  { id: "log", label: "Log" },
  { id: "trends", label: "Trends" },
  { id: "gone", label: "Where they went" },
] as const;

export function EggsScreen({
  propertyId,
  actorId,
  initialTab,
  initialFlockId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  /** The tab to open on (`?tab=`), when it names one. */
  readonly initialTab?: string;
  /** The flock the trends open on (`?flock=`), from that flock's page. */
  readonly initialFlockId?: string;
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
   * six hours in the future and none of these numbers would show it — which is
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
      {/*
        The four numbers the tiles used to carry, as facts beside the title.
        Each is derived, so correcting a row corrects all of them at once.
      */}
      <PageHeader
        eyebrow="Flock"
        title="Eggs"
        subtitle={[
          `${collectedToday} today`,
          `${collectedWeek} in 7 days`,
          rate === undefined ? undefined : `${rate.toFixed(2)} per bird a day`,
          `${basket} in the basket`,
        ]
          .filter((part) => part !== undefined)
          .join(" · ")}
      />

      {/* Said only when it is wrong. */}
      {basket < 0 ? (
        <p className="text-sm text-danger">More eggs have gone out than were logged coming in.</p>
      ) : rate !== undefined && rate < 0.4 ? (
        <p className="text-sm text-danger">Lay rate is low this week.</p>
      ) : birds === 0 && logs.length > 0 ? (
        <p className="text-sm text-muted">No birds counted, so there is no rate per bird.</p>
      ) : null}

      <Tabs
        label="Eggs"
        tabs={TABS}
        {...(initialTab !== undefined && TABS.some((tab) => tab.id === initialTab)
          ? { defaultTab: initialTab }
          : {})}
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
            <TrendsPanel
              logs={logs}
              flocks={flocks}
              adjustments={adjustments}
              {...(initialFlockId === undefined ? {} : { initialFlockId })}
            />
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
