"use client";

import Link from "next/link";
import { useState } from "react";

import { Pill, useToast } from "@galaxy-farm/ui";
import {
  choreDaySheet,
  choreProgress,
  startOfDay,
  taskSchema,
  type ChoreEntry,
  type ChoreTemplate,
  type Task,
  type Ulid,
  type FeedingPlan,
  type Zone,
} from "@galaxy-farm/core";

import { toggleChore } from "@/lib/chores";
import { useMutations } from "@/lib/local/mutations";
import type { FeedType } from "@galaxy-farm/module-feed";

import { feedingChoreText, feedingChoresFor } from "@/lib/feeding-chores";
import { useRecords } from "@/lib/local/use-records";

/**
 * Today's chores, on the dashboard (spec §7).
 *
 * The dashboard is what gets glanced at on the way out of the door, so this
 * card answers the one question asked there — what is still owed — and lets it
 * be ticked without leaving. §12 asks for every frequent action to be within
 * two taps of its context; a chore ticked from here is one.
 *
 * A checklist rather than a row of "Done" buttons: a box that fills in is the
 * shape a chore list has on paper, and a ticked line staying put (struck
 * through) shows how far through the day is without a progress bar. The full
 * day, the days either side of it, and the templates behind it are a link
 * away.
 */

/** Past this many, the card shows only what is still open. */
const SHOWN = 8;

export interface ChoreSheet {
  readonly sheet: readonly ChoreEntry[];
  readonly progress: ReturnType<typeof choreProgress>;
  readonly busy: string | undefined;
  readonly tick: (entry: ChoreEntry) => Promise<void>;
}

/**
 * Today's sheet and the tick that changes it.
 *
 * A hook rather than a card so the Today screen can count what is overdue in
 * its "Needs you" list from the same sheet the checklist draws.
 */
export function useChoreSheet(propertyId: Ulid, actorId: Ulid): ChoreSheet {
  const query = { propertyId };
  const { records: tasks } = useRecords<Task>("tasks", query);
  const { records: templates } = useRecords<ChoreTemplate>("choreTemplates", query);
  // The same reads the chores screen makes, for the same reason: feeding is
  // derived from the plans, and a card that left it out would disagree with
  // the page it links to.
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);
  const { records: zones } = useRecords<Zone>("zones", query);

  const api = useMutations<Task>("tasks", "tasks", taskSchema, propertyId, actorId);
  const { show } = useToast();
  const [busy, setBusy] = useState<string | undefined>();

  const now = new Date();
  const today = startOfDay(now);
  const derived = feedingChoresFor(
    plans,
    feedingChoreText({ zones, feeds, propertyId }),
    today,
    now,
  );
  const sheet = choreDaySheet({ tasks, templates, derived }, today, now);

  async function tick(entry: ChoreEntry) {
    setBusy(entry.id);
    try {
      // A toggle: ticking a finished chore un-ticks it, and `toggleChore` owns
      // the subtle half of that.
      const result = await toggleChore(api, {
        entry,
        template: templates.find((candidate) => candidate.id === entry.templateId),
        date: today,
        at: new Date(),
        actorId,
      });

      if (!result.ok) show({ message: "Could not tick that off", tone: "danger" });
    } finally {
      setBusy(undefined);
    }
  }

  return { sheet, progress: choreProgress(sheet), busy, tick };
}

function timeOf(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function ChoresChecklist({ chores }: { readonly chores: ChoreSheet }) {
  const { sheet, progress, busy, tick } = chores;
  const open = sheet.filter((entry) => entry.completedAt === undefined);
  // In the sheet's own order, so a ticked line stays where the finger left it.
  // Only on a long day does the list narrow to what is still open.
  const shown = sheet.length <= SHOWN ? sheet : open.slice(0, SHOWN);
  const hidden = sheet.length <= SHOWN ? 0 : open.length - shown.length;

  return (
    <section aria-labelledby="today-chores" className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="today-chores" className="text-xs font-semibold uppercase tracking-wide text-muted">
          Chores{progress.total === 0 ? "" : ` · ${progress.done} of ${progress.total}`}
        </h2>
        <Link
          href="/admin/chores"
          className="text-sm font-medium text-action underline-offset-2 hover:underline"
        >
          All chores
        </Link>
      </div>

      {progress.total === 0 ? (
        <p className="rounded-density border border-rule bg-panel px-4 py-3 text-sm text-muted">
          Nothing on today.
        </p>
      ) : (
        <ul className="divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel">
          {shown.map((entry) => {
            const done = entry.completedAt !== undefined;
            const late = !done && entry.overdue;

            return (
              <li key={entry.id}>
                {/*
                  The whole row is the label, so the target is the line and not
                  a 24px box. A real checkbox underneath: it is announced as
                  one, and Space toggles it.
                */}
                <label className="flex min-h-[52px] cursor-pointer items-center gap-3 px-4 py-2 hover:bg-canvas">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={done}
                    disabled={busy === entry.id}
                    onChange={() => void tick(entry)}
                  />
                  <span
                    aria-hidden
                    className={[
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2",
                      "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-action",
                      done ? "border-action bg-action text-action-ink" : "border-edge bg-panel",
                    ].join(" ")}
                  >
                    {done ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M5 12l5 5 9-10"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
                  <span
                    className={[
                      "min-w-0 flex-1 text-density",
                      done ? "text-muted line-through" : "text-ink",
                    ].join(" ")}
                  >
                    {entry.title}
                  </span>
                  {entry.carriedOver && !done ? <Pill tone="danger">Owed</Pill> : null}
                  <span
                    className={[
                      "shrink-0 text-sm [font-variant-numeric:tabular-nums]",
                      late ? "font-medium text-danger" : "text-muted",
                    ].join(" ")}
                  >
                    {timeOf(entry.dueAt)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="text-sm text-muted">
          {hidden} more still to do in{" "}
          <Link href="/admin/chores" className="text-action underline underline-offset-2">
            all chores
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
