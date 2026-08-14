"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Card, PageBody, PageHeader } from "@galaxy-farm/ui";
import { groupByDay, projectEvents, type CalendarEvent, type Ulid } from "@galaxy-farm/core";

import { useSync } from "@/app/_components/sync-provider";
import { useRecords } from "@/lib/local/use-records";

/**
 * The Calendar board (spec §4.4, §5.1 "Unified calendar").
 *
 * Read-only, and today it is the manual half of the calendar only — an agenda
 * of what somebody wrote down. `projectEvents` and `groupByDay` are the same
 * pure functions `/admin/calendar` will use once it exists; the projected
 * half (breeding windows, withdrawal ends, feed run-out and the rest) is
 * contributed by each module and lands here for free the day any module wires
 * one in, per §2's "derive, don't duplicate" — nothing about this board
 * changes to pick it up.
 */

const WINDOW_DAYS = 14;

export function CalendarBoardScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const { store, loading } = useCalendarStore(propertyId);

  const from = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  }, []);
  const to = useMemo(() => new Date(from.getTime() + WINDOW_DAYS * 86_400_000), [from]);

  const entries = useMemo(
    () => projectEvents({ manual: store, projected: [] }, { from, to }),
    [store, from, to],
  );
  const byDay = useMemo(() => groupByDay(entries), [entries]);

  return (
    <PageBody>
      <PageHeader
        eyebrow={<Link href="/kiosk">← Kiosk</Link>}
        title="Calendar"
        subtitle={`The next ${WINDOW_DAYS} days.`}
      />

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : byDay.size === 0 ? (
        <p className="text-muted">Nothing on the calendar in the next {WINDOW_DAYS} days.</p>
      ) : (
        <div className="flex flex-col gap-density">
          {[...byDay.entries()].map(([day, dayEntries]) => (
            <Card key={day} className="flex flex-col gap-2">
              <h2>
                {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h2>
              <ul className="flex flex-col gap-1">
                {dayEntries.map((entry) => (
                  <li key={entry.id} className="text-density text-ink">
                    {entry.allDay ? null : (
                      <span className="mr-2 text-muted">
                        {entry.at.toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                    {entry.title}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </PageBody>
  );
}

/** The manual half of the calendar, from this device's own store. */
function useCalendarStore(propertyId: Ulid) {
  const { store: local } = useSync();
  const query = useMemo(() => ({ propertyId }), [propertyId]);
  const { records, loading } = useRecords<CalendarEvent>("calendarEvents", query);
  return { store: records, loading: loading || local === undefined };
}
