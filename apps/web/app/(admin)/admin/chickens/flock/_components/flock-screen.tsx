"use client";

import { useState } from "react";

import { PageBody, PageHeader, Tabs, Tile } from "@galaxy-farm/ui";
import { addCalendarDays, endOfDay, startOfDay, type Ulid, type Zone } from "@galaxy-farm/core";
import {
  lossesIn,
  totalBirdsOn,
  type EggLog,
  type Flock,
  type FlockAdjustment,
} from "@galaxy-farm/module-poultry";

import { FlocksPanel } from "@/app/(admin)/admin/chickens/flock/_components/flocks-panel";
import { HeadcountPanel } from "@/app/(admin)/admin/chickens/flock/_components/headcount-panel";
import { useRecords } from "@/lib/local/use-records";

/**
 * Flocks (spec §5.4, §7 `/admin/chickens/flock`).
 *
 * There is no headcount field anywhere on this screen, and that is the point.
 * §4.5 puts flock headcount on its list of running totals that are derived
 * from a log rather than stored: the entries carry the CRUD and the count
 * re-derives. A number somebody edits records that there are fourteen birds; a
 * log records that four went to something on Tuesday night, which is the fact
 * that decides whether to walk the fence.
 *
 * The reads happen once here and go down as props. Two panels each opening
 * their own live query over the same two tables would redraw out of step, and
 * the count on a card would disagree with the log that produced it.
 */

/** The window the two loss tiles look back over. */
const RECENT_DAYS = 30;

export function FlockScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: flocks, loading } = useRecords<Flock>("flocks", query);
  const { records: adjustments, loading: logLoading } = useRecords<FlockAdjustment>(
    "flockAdjustments",
    query,
  );
  const { records: zones } = useRecords<Zone>("zones", query);
  // Only to say what a flock's deletion would take with it (§4.5 clause 3).
  const { records: eggLogs } = useRecords<EggLog>("eggLogs", query);

  /**
   * Which tab, and which flock the log is about.
   *
   * Lifted out of `Tabs` so a card can send somebody to the log with its own
   * flock already chosen. "Four went last night" is two taps from the card
   * that made you think it, and the log stays the one place a change is
   * written.
   */
  const [tab, setTab] = useState("flocks");
  const [focused, setFocused] = useState<Ulid | undefined>();

  /**
   * "As of now" means the end of today, not this instant.
   *
   * A headcount entry carries a *date*, and a date-only value is stored at
   * midday so that it is the same day whichever timezone a device is set to.
   * Asked as of the instant, an entry logged at six in the morning is six
   * hours in the future and does not count — so the count on this screen would
   * not move until lunchtime, on the morning somebody walked out and found
   * four birds gone. Every window below runs on whole days for the same reason.
   */
  const now = endOfDay(new Date());
  const since = startOfDay(addCalendarDays(now, -RECENT_DAYS));
  const window = { from: since, to: now };

  const live = flocks.filter((flock) => flock.active);
  const birds = totalBirdsOn(flocks, adjustments, now);

  /**
   * Losses across every flock, by reason.
   *
   * `sold` is a negative adjustment and is deliberately not counted as a loss:
   * a bird sold is a bird that left on purpose, and rolling it in would make
   * the number that is supposed to say "something is getting in" say nothing.
   */
  const losses = live.reduce(
    (totals, flock) => {
      const byReason = lossesIn(flock.id, adjustments, window);
      return {
        gone:
          totals.gone +
          (byReason.get("died") ?? 0) +
          (byReason.get("predator") ?? 0) +
          (byReason.get("culled") ?? 0),
        predator: totals.predator + (byReason.get("predator") ?? 0),
      };
    },
    { gone: 0, predator: 0 },
  );

  const gained = adjustments
    .filter(
      (entry) =>
        (entry.reason === "added" || entry.reason === "hatched") &&
        entry.occurredOn >= since &&
        entry.occurredOn <= now,
    )
    .reduce((total, entry) => total + entry.quantity, 0);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Flock"
        title="Flocks"
        subtitle="How many birds there are, and what happened to the ones that are not."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Birds"
          value={birds}
          tone="identity"
          emphasis
          hint={live.length === 0 ? "No flocks yet" : "Across every live flock"}
        />
        <Tile
          label="Flocks"
          value={live.length}
          tone="action"
          hint={
            flocks.length === live.length
              ? undefined
              : `${flocks.length - live.length} switched off`
          }
        />
        <Tile
          label={`Lost in ${RECENT_DAYS} days`}
          value={losses.gone}
          tone={losses.gone > 0 ? "danger" : "calm"}
          emphasis={losses.gone > 0}
          hint={
            losses.predator > 0
              ? `${losses.predator} to something getting in`
              : "Died, taken, or culled"
          }
        />
        <Tile
          label={`Added in ${RECENT_DAYS} days`}
          value={gained}
          tone="calm"
          hint="Bought in or hatched here"
        />
      </div>

      <Tabs
        label="Flocks"
        activeTab={tab}
        onTabChange={setTab}
        tabs={[
          { id: "flocks", label: "Flocks" },
          { id: "log", label: "Headcount log" },
        ]}
      >
        {(active) =>
          active === "flocks" ? (
            <FlocksPanel
              flocks={flocks}
              adjustments={adjustments}
              zones={zones}
              eggLogs={eggLogs}
              loading={loading}
              propertyId={propertyId}
              actorId={actorId}
              onRecordChange={(flock) => {
                setFocused(flock.id);
                setTab("log");
              }}
            />
          ) : (
            <HeadcountPanel
              // Remounted when the flock changes, so the form opens on the one
              // whose card sent us here rather than on whatever was chosen last.
              key={focused ?? "any"}
              flocks={flocks}
              adjustments={adjustments}
              loading={logLoading}
              propertyId={propertyId}
              actorId={actorId}
              {...(focused === undefined ? {} : { focusedFlockId: focused })}
            />
          )
        }
      </Tabs>
    </PageBody>
  );
}
