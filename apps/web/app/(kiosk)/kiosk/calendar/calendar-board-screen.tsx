"use client";

import { useMemo } from "react";

import { PageBody, PageHeader } from "@galaxy-farm/ui";
import {
  addCalendarDays,
  dayKey,
  groupByDay,
  projectEvents,
  startOfDay,
  type Animal,
  type CalendarEvent,
  type ChoreTemplate,
  type FeedingPlan,
  type PurchaseCandidate,
  type Task,
  type Ulid,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import type {
  BreedingRecord,
  CalvingRecord,
  HealthRecord,
  MedInventory,
  SyncProtocol,
} from "@galaxy-farm/module-cattle";
import type {
  Equipment,
  MaintenanceLog,
  MaintenanceRule,
  MeterReading,
} from "@galaxy-farm/module-equipment";
import type { FeedConsumption, FeedPurchase, FeedType } from "@galaxy-farm/module-feed";

import { useSyncEngine } from "@/app/_components/sync-provider";
import { projectedCalendarEntries } from "@/lib/calendar";
import { dayLabel } from "@/lib/chores";
import { useRecords } from "@/lib/local/use-records";

/**
 * The Calendar board (spec §4.4, §5.1 "Unified calendar").
 *
 * Read-only, and both halves of the calendar now: the events somebody wrote
 * down, and the rows each module projects from records that already hold the
 * dates — calving windows, withdrawal ends, sync-protocol steps, feed run-out,
 * service due, chores. `projectedCalendarEntries` assembles them for
 * `/admin/calendar` and for this board alike, so the screen on the post and
 * the screen on the desk cannot reach different conclusions about the same
 * fortnight.
 *
 * Every read comes from this device's own store, which is what puts the next
 * fortnight on a kiosk at zero bars instantly (§4.2).
 */

const WINDOW_DAYS = 14;

export function CalendarBoardScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const { store, loading } = useCalendarStore(propertyId);

  const from = useMemo(() => startOfDay(new Date()), []);
  const to = useMemo(() => new Date(from.getTime() + WINDOW_DAYS * 86_400_000), [from]);

  const entries = useMemo(
    () =>
      projectEvents(
        {
          manual: store.events,
          projected: projectedCalendarEntries(store.sources, {
            from,
            days: WINDOW_DAYS,
            now: from,
          }),
        },
        { from, to },
      ),
    [store, from, to],
  );
  const byDay = useMemo(() => groupByDay(entries), [entries]);

  const todayKey = dayKey(from);
  // Every day of the window gets a row, so a quiet Wednesday reads as quiet
  // rather than as a day the board forgot.
  const days = useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, index) => addCalendarDays(from, index)),
    [from],
  );

  return (
    <PageBody>
      <PageHeader title="Calendar" subtitle={`The next ${WINDOW_DAYS} days.`} />

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <ol className="gf-kiosk-days">
          {days.map((date) => {
            const key = dayKey(date);
            const dayEntries = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            if (dayEntries.length === 0 && !isToday) return null;

            return (
              <li key={key} className="gf-kiosk-day" data-today={isToday ? "" : undefined}>
                <h2 className="gf-kiosk-day__date">
                  <span className="gf-kiosk-day__name">{dayLabel(date, from)}</span>
                  <span className="gf-kiosk-day__sub">
                    {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </h2>
                {dayEntries.length === 0 ? (
                  <p className="text-muted">Nothing scheduled.</p>
                ) : (
                  <ul className="gf-kiosk-day__list">
                    {dayEntries.map((entry) => (
                      <li key={entry.id}>
                        <span className="gf-kiosk-day__time">
                          {entry.allDay
                            ? "All day"
                            : entry.at.toLocaleTimeString(undefined, {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                        </span>
                        <span className="text-ink">{entry.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </PageBody>
  );
}
/**
 * Both halves of the calendar, from this device's own store.
 *
 * The board waits on the manual events alone before it draws. The projected
 * half is derived from tables that arrive on the same pull, and holding the
 * whole fortnight back until the last feed purchase had landed would be a barn
 * screen showing "Loading…" for the sake of a row it may not even have.
 */
function useCalendarStore(propertyId: Ulid) {
  const { store: local } = useSyncEngine();
  const query = useMemo(() => ({ propertyId }), [propertyId]);

  const { records: events, loading } = useRecords<CalendarEvent>("calendarEvents", query);
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: breedings } = useRecords<BreedingRecord>("breedingRecords", query);
  // A calving closes the attempt it came of: no window, no preg check, and
  // next year's dates belong to next year's service.
  const { records: calvings } = useRecords<CalvingRecord>("calvingRecords", query);
  const { records: protocols } = useRecords<SyncProtocol>("syncProtocols", query);
  const { records: health } = useRecords<HealthRecord>("healthRecords", query);
  const { records: meds } = useRecords<MedInventory>("medInventory", query);
  const { records: candidates } = useRecords<PurchaseCandidate>("purchaseCandidates", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);
  const { records: purchases } = useRecords<FeedPurchase>("feedPurchases", query);
  const { records: consumption } = useRecords<FeedConsumption>("feedConsumption", query);
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);
  const { records: equipment } = useRecords<Equipment>("equipment", query);
  const { records: maintenanceRules } = useRecords<MaintenanceRule>("maintenanceRules", query);
  const { records: maintenanceLogs } = useRecords<MaintenanceLog>("maintenanceLogs", query);
  const { records: meterReadings } = useRecords<MeterReading>("meterReadings", query);
  const { records: tasks } = useRecords<Task>("tasks", query);
  const { records: choreTemplates } = useRecords<ChoreTemplate>("choreTemplates", query);

  const store = useMemo(
    () => ({
      events,
      sources: {
        propertyId,
        animals,
        breedings,
        calvings,
        protocols,
        health,
        meds,
        candidates,
        feeds,
        purchases,
        consumption,
        plans,
        assignments,
        equipment,
        maintenanceRules,
        maintenanceLogs,
        meterReadings,
        tasks,
        choreTemplates,
      },
    }),
    [
      events,
      propertyId,
      animals,
      breedings,
      calvings,
      protocols,
      health,
      meds,
      candidates,
      feeds,
      purchases,
      consumption,
      plans,
      assignments,
      equipment,
      maintenanceRules,
      maintenanceLogs,
      meterReadings,
      tasks,
      choreTemplates,
    ],
  );

  return { store, loading: loading || local === undefined };
}
