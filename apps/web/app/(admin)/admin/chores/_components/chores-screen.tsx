"use client";

import { useState } from "react";

import { Button, Card, Meter, PageBody, PageHeader, Pill, Tabs, Tile } from "@galaxy-farm/ui";
import {
  addCalendarDays,
  choreDaySheet,
  choreProgress,
  startOfDay,
  type Animal,
  type ChoreTemplate,
  type Task,
  type Ulid,
  type Zone,
  type FeedingPlan,
} from "@galaxy-farm/core";

import { DaySheet } from "@/app/(admin)/admin/chores/_components/day-sheet";
import { TemplatesPanel } from "@/app/(admin)/admin/chores/_components/templates-panel";
import { dayLabel } from "@/lib/chores";
import type { FeedType } from "@galaxy-farm/module-feed";

import { feedingChoreText, feedingChoresFor } from "@/lib/feeding-chores";
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
  // Feeding is derived, never typed twice (§2). The plans say what goes out,
  // to whom and when; the sheet reads them rather than asking somebody to
  // write a chore template beside every ration.
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);

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

  const text = feedingChoreText({ zones, feeds, propertyId });
  const derived = feedingChoresFor(plans, text, date, now);
  const sheet = choreDaySheet({ tasks, templates, derived }, date, now);
  const progress = choreProgress(sheet);
  const day = dayLabel(date, today);

  // The first tab is named for the day it is showing. Stepping back to
  // yesterday and finding a tab still labelled "Today" reads as the step
  // having done nothing.
  const tabs = [
    { id: "today", label: day, adornment: progress.open === 0 ? undefined : progress.open },
    { id: "templates", label: "Templates" },
  ];

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
            <Pill tone="identity">{day}</Pill>
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
            label={day}
            detail={
              progress.open === 0
                ? "Everything on the list is done."
                : `${progress.done} of ${progress.total} done`
            }
          />
        </Card>
      )}

      <Tabs tabs={tabs} label="Chores">
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
                  dayName={day}
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
