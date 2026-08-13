"use client";

import { useState } from "react";

import { Button, Card, Meter, PageBody, PageHeader, Pill, Tabs, Tile } from "@galaxy-farm/ui";
import {
  addCalendarDays,
  choreDaySheet,
  choreProgress,
  isSameDay,
  startOfDay,
  type Animal,
  type ChoreTemplate,
  type Task,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";

import { DaySheet } from "@/app/(admin)/admin/chores/_components/day-sheet";
import { TemplatesPanel } from "@/app/(admin)/admin/chores/_components/templates-panel";
import { useRecords } from "@/lib/local/use-records";

/**
 * Chores — today, and the templates behind it (spec §6, §7).
 *
 * Two things on one screen because they are two views of one question. The
 * templates are the standing arrangement; today is what that arrangement plus
 * whatever anyone wrote down actually asks for this morning. Splitting them
 * across two routes would mean leaving the list to find out why something is
 * on it.
 *
 * Nothing on the Today tab is stored until it is ticked. `choreDaySheet`
 * derives the day from the templates and the tasks on the device, so changing
 * a template changes tomorrow without rewriting yesterday, and a year of empty
 * checkboxes never gets written at all (§4.5's derived read model).
 *
 * One field of `Task` has no control here: `assignedTo`. Assigning needs a
 * list of people, and the user directory is not among the entities a device
 * holds — so a chore says what and when, and who waits for the store to carry
 * users.
 */

const TABS = [
  { id: "today", label: "Today" },
  { id: "templates", label: "Templates" },
] as const;

/** "Today", "Yesterday", or the day named in full. */
export function dayLabel(date: Date, today: Date): string {
  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, addCalendarDays(today, -1))) return "Yesterday";
  if (isSameDay(date, addCalendarDays(today, 1))) return "Tomorrow";

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function ChoresScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: tasks, loading } = useRecords<Task>("tasks", query);
  const { records: templates } = useRecords<ChoreTemplate>("choreTemplates", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: animals } = useRecords<Animal>("animals", query);

  /**
   * Which day is on screen, as an offset rather than a date.
   *
   * An offset survives midnight. A `Date` held in state would still say
   * "Today" at ten past twelve while showing yesterday's list, which is
   * precisely when somebody is out there finishing the evening round.
   */
  const [offset, setOffset] = useState(0);

  const now = new Date();
  const today = startOfDay(now);
  const date = addCalendarDays(today, offset);

  const sheet = choreDaySheet({ tasks, templates }, date, now);
  const progress = choreProgress(sheet);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Today"
        title="Chores"
        subtitle="What the farm is asking for, from the templates that repeat and the jobs somebody wrote down."
        actions={
          <div className="flex items-center gap-2">
            <Button
              aria-label="Previous day"
              onClick={() => setOffset(offset - 1)}
              disabled={loading}
            >
              ‹
            </Button>
            <Button
              variant={offset === 0 ? "primary" : "secondary"}
              onClick={() => setOffset(0)}
              disabled={offset === 0}
            >
              Today
            </Button>
            <Button aria-label="Next day" onClick={() => setOffset(offset + 1)} disabled={loading}>
              ›
            </Button>
          </div>
        }
        meta={
          <>
            <Pill tone="identity">{dayLabel(date, today)}</Pill>
            <Pill>
              {date.toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </Pill>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="To do"
          value={progress.open}
          tone={progress.open === 0 ? "calm" : "action"}
          emphasis={progress.open > 0}
          hint={progress.total === 0 ? "Nothing on the list" : `of ${progress.total}`}
        />
        <Tile label="Done" value={progress.done} tone="calm" />
        <Tile
          label="Overdue"
          value={progress.overdue}
          tone={progress.overdue > 0 ? "danger" : "calm"}
          emphasis={progress.overdue > 0}
          hint={progress.overdue > 0 ? "Owed from earlier" : "Nothing late"}
        />
        <Tile
          label="Templates"
          value={templates.filter((template) => template.active).length}
          hint={`${templates.length} in total`}
        />
      </div>

      {progress.total === 0 ? null : (
        <Card>
          <Meter
            value={progress.fraction}
            tone={progress.overdue > 0 ? "danger" : progress.open === 0 ? "calm" : "action"}
            label={dayLabel(date, today)}
            detail={
              progress.open === 0
                ? "Everything on the list is done."
                : `${progress.done} of ${progress.total} done`
            }
          />
        </Card>
      )}

      <Tabs tabs={TABS} label="Chores">
        {(active) => (
          <div className="pt-density">
            {active === "today" ? (
              loading ? (
                <p className="text-muted">Loading the day…</p>
              ) : (
                <DaySheet
                  entries={sheet}
                  templates={templates}
                  zones={zones}
                  animals={animals}
                  date={date}
                  dayName={dayLabel(date, today)}
                  propertyId={propertyId}
                  actorId={actorId}
                />
              )
            ) : (
              <TemplatesPanel
                templates={templates}
                zones={zones}
                animals={animals}
                propertyId={propertyId}
                actorId={actorId}
              />
            )}
          </div>
        )}
      </Tabs>
    </PageBody>
  );
}
