"use client";

import { useState } from "react";

import { Button, PageBody, PageHeader, Tabs } from "@galaxy-farm/ui";
import { addCalendarDays, endOfDay, startOfDay, type Ulid, type Zone } from "@galaxy-farm/core";
import {
  lossesIn,
  totalBirdsOn,
  type EggLog,
  type Flock,
  type FlockAdjustment,
} from "@galaxy-farm/module-poultry";

import { FlocksPanel } from "@/app/(admin)/admin/chickens/flock/_components/flocks-panel";
import {
  HeadcountPanel,
  RecordChange,
} from "@/app/(admin)/admin/chickens/flock/_components/headcount-panel";
import { PhoneAddButton } from "@/app/(admin)/admin/horses/_components/list-row";
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

/** The window the recent-changes line looks back over. */
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
   * Lifted out of `Tabs` so a row can open the headcount form with its own
   * flock already chosen. "Four went last night" is one tap from the row that
   * made you think it, and the log stays the one place a change is written.
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

  /** The last thirty days, in one line — said only when something happened. */
  const recent = [
    losses.gone === 0
      ? undefined
      : `${losses.gone} lost${losses.predator > 0 ? ` (${losses.predator} taken)` : ""}`,
    gained === 0 ? undefined : `${gained} added`,
  ].filter((part): part is string => part !== undefined);

  /** Which flock the headcount form opens on, or "any"; undefined when shut. */
  const [recording, setRecording] = useState<Ulid | "any" | undefined>();

  return (
    <PageBody>
      {/* Bottom clearance on a phone for the floating record button. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <PageHeader
          eyebrow="Flock"
          title="Flocks"
          subtitle={[
            `${birds} bird${birds === 1 ? "" : "s"}`,
            `${live.length} flock${live.length === 1 ? "" : "s"}`,
            flocks.length === live.length ? undefined : `${flocks.length - live.length} off`,
          ]
            .filter((part) => part !== undefined)
            .join(" · ")}
          actions={
            // The most-used write on this screen, so it is the one primary
            // action. Hidden on a phone by a wrapper — the button's own
            // `inline-flex` wins over a `hidden` passed in.
            <span className="hidden sm:block">
              <Button variant="primary" onClick={() => setRecording("any")}>
                <span aria-hidden="true">±</span> Record a change
              </Button>
            </span>
          }
        />

        {/*
          The four tiles this used to have, as one line. Losses are the number
          that decides whether to walk the fence, so they are said in red when
          there are any — and nothing at all is said when nothing happened.
          A sale is not a loss: a bird sold left on purpose.
        */}
        {recent.length === 0 ? null : (
          <p className={`text-sm ${losses.gone > 0 ? "text-danger" : "text-muted"}`}>
            Last {RECENT_DAYS} days: {recent.join(" · ")}.{" "}
            <button
              type="button"
              onClick={() => setTab("log")}
              className="inline-flex min-h-target items-center font-semibold underline underline-offset-2"
            >
              See the log
            </button>
          </p>
        )}

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
                  setRecording(flock.id);
                }}
              />
            ) : (
              <HeadcountPanel
                // Remounted when the flock changes, so the history opens on the
                // one last recorded against rather than whatever was chosen.
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

        <PhoneAddButton onClick={() => setRecording("any")}>Record a change</PhoneAddButton>
      </div>

      {recording === undefined ? null : (
        <RecordChange
          // Remounted per flock, so the form opens on the one whose row sent
          // us here rather than on whatever was chosen last.
          key={recording}
          flocks={flocks}
          adjustments={adjustments}
          propertyId={propertyId}
          actorId={actorId}
          focusedFlockId={recording === "any" ? focused : recording}
          onClose={() => setRecording(undefined)}
        />
      )}
    </PageBody>
  );
}
