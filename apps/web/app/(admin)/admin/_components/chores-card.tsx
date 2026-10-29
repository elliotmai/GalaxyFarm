"use client";

import Link from "next/link";
import { Suspense, use, useState } from "react";

import { Pill, useToast } from "@galaxy-farm/ui";
import {
  choreDaySheet,
  choreProgress,
  displayName,
  startOfDay,
  taskSchema,
  type Animal,
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
import { useWeatherChores, type WeatherChores } from "@/lib/use-weather-chores";

/**
 * Today's feeding and chores, on the Today screen (spec §7).
 *
 * The same day sheet the barn kiosk draws: `choreDaySheet` over the stored
 * tasks, the templates and the feeding trips derived from the plans — the
 * exact reads and derivation `/kiosk/chores` makes — so a tick on the phone
 * and a tick on the post are ticks on one list, and the count above it says
 * the same number in both places.
 *
 * Two lists rather than the kiosk's parts of the day, because on a phone the
 * question is "has the stock been fed" before it is "what is left this
 * morning". Each line is a box that fills in: the shape a chore list has on
 * paper, and a ticked line staying put (struck through, saying who and when)
 * is the record of the round somebody away from the place is checking.
 */

/**
 * Who a completion is attributed to, by id — people and barn screens both,
 * because a kiosk tick is written as the screen. Read on the server: the
 * users table never reaches a device (§4.3).
 */
export type PeopleNames = Readonly<Record<string, string>>;

export interface ChoreSheet {
  readonly sheet: readonly ChoreEntry[];
  readonly feeding: readonly ChoreEntry[];
  readonly chores: readonly ChoreEntry[];
  readonly progress: ReturnType<typeof choreProgress>;
  readonly busy: string | undefined;
  readonly tick: (entry: ChoreEntry) => Promise<void>;
  /** What the forecast made of the day, for Today's quiet line. */
  readonly weather: WeatherChores;
}

/**
 * Today's sheet and the tick that changes it.
 *
 * A hook rather than a card so the Today screen can count what is overdue in
 * its "Needs you" list from the same sheet the checklists draw.
 */
export function useChoreSheet(propertyId: Ulid, actorId: Ulid): ChoreSheet {
  const query = { propertyId };
  const { records: tasks } = useRecords<Task>("tasks", query);
  const { records: templates } = useRecords<ChoreTemplate>("choreTemplates", query);
  // The same reads the kiosk board makes, for the same reason: feeding is
  // derived from the plans, and a phone that left it out would disagree with
  // the screen in the barn.
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);
  const { records: zones } = useRecords<Zone>("zones", query);

  const api = useMutations<Task>("tasks", "tasks", taskSchema, propertyId, actorId);
  const { show } = useToast();
  const [busy, setBusy] = useState<string | undefined>();

  const now = new Date();
  const today = startOfDay(now);
  const feeding = feedingChoresFor(
    plans,
    feedingChoreText({ zones, feeds, propertyId }),
    today,
    now,
  );
  // The weather's jobs — covers before a freeze, ice on a freezing morning —
  // sit in the chore list rather than beside it, so they are ticked the same
  // way and the kiosk shows them too.
  const weather = useWeatherChores(propertyId, today, now);
  const sheet = choreDaySheet(
    { tasks, templates, derived: [...feeding, ...weather.derived], weather: weather.weather },
    today,
    now,
  );

  // A feeding trip is either still the derived occurrence, or the row it
  // became when somebody ticked it — which keeps the occurrence's id as its
  // `sourceKey`. Weather chores keep theirs the same way, under their own
  // prefix, so only `feeding:` keys count here.
  const derivedIds = new Set(feeding.map((entry) => entry.id));
  const fedRows = new Set(
    tasks.filter((task) => task.sourceKey?.startsWith("feeding:")).map((task) => task.id),
  );
  const isFeeding = (entry: ChoreEntry) =>
    derivedIds.has(entry.id) || (entry.taskId !== undefined && fedRows.has(entry.taskId));

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

  return {
    sheet,
    feeding: sheet.filter(isFeeding),
    chores: sheet.filter((entry) => !isFeeding(entry)),
    progress: choreProgress(sheet),
    busy,
    tick,
    weather,
  };
}

function timeOf(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "N of M done", and a bar that fills — the one number the kiosk also shows. */
export function DayProgress({ chores }: { readonly chores: ChoreSheet }) {
  const { done, total } = chores.progress;
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-density border border-rule bg-panel px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-density font-semibold text-ink">
          {done} of {total} done
        </span>
        <span className="text-sm text-muted">Same list as the barn kiosk</span>
      </div>
      <div
        role="progressbar"
        aria-label="Feeding and chores done today"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-2 overflow-hidden rounded-full bg-canvas"
      >
        <div
          className="h-full rounded-full bg-action transition-[width]"
          style={{ width: `${Math.round((done / total) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** "Done by Sam · 6:40", once the server has said who Sam is. */
function NamedDone({
  id,
  at,
  names,
}: {
  readonly id: Ulid;
  readonly at: string;
  readonly names: Promise<PeopleNames>;
}) {
  const name = use(names)[id];
  return <>{name === undefined ? `Done · ${at}` : `Done by ${name} · ${at}`}</>;
}

function DoneLine({
  entry,
  actorId,
  names,
}: {
  readonly entry: ChoreEntry;
  readonly actorId: Ulid;
  readonly names: Promise<PeopleNames> | undefined;
}) {
  const at = entry.completedAt === undefined ? "" : timeOf(entry.completedAt);
  const by = entry.completedBy;
  const plain = <>Done · {at}</>;

  if (by === undefined) return plain;
  if (by === actorId) return <>Done by You · {at}</>;
  if (names === undefined) return plain;

  // The time stands on its own while the name is on its way, and stays alone
  // if the server cannot be reached — the round still happened.
  return (
    <Suspense fallback={plain}>
      <NamedDone id={by} at={at} names={names} />
    </Suspense>
  );
}

export function TickList({
  id,
  title,
  entries,
  chores,
  animals,
  zones,
  actorId,
  names,
  action,
}: {
  readonly id: string;
  readonly title: string;
  readonly entries: readonly ChoreEntry[];
  readonly chores: ChoreSheet;
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly actorId: Ulid;
  readonly names?: Promise<PeopleNames> | undefined;
  /** One link beside the heading, to the screen that owns the list. */
  readonly action?: { readonly href: string; readonly label: string } | undefined;
}) {
  const { busy, tick } = chores;
  if (entries.length === 0) return null;

  const where = (entry: ChoreEntry): string | undefined => {
    if (entry.animalId !== undefined) {
      const animal = animals.find((candidate) => candidate.id === entry.animalId);
      return animal === undefined ? undefined : displayName(animal);
    }
    if (entry.zoneId !== undefined) return zones.find((zone) => zone.id === entry.zoneId)?.name;
    return undefined;
  };
  const left = entries.filter((entry) => entry.completedAt === undefined).length;

  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-xs font-semibold uppercase tracking-wide text-muted">
          {title}
          {left === 0 ? " · done" : ` · ${left} to do`}
        </h2>
        {action === undefined ? null : (
          <Link
            href={action.href}
            className="text-sm font-medium text-action underline-offset-2 hover:underline"
          >
            {action.label}
          </Link>
        )}
      </div>

      <ul className="divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel">
        {entries.map((entry) => {
          const done = entry.completedAt !== undefined;
          const late = !done && entry.overdue;
          const facts = [entry.detail, where(entry), `by ${timeOf(entry.dueAt)}`].filter(
            (part): part is string => part !== undefined && part !== "",
          );

          return (
            <li key={entry.id}>
              {/*
                The whole row is the label, so the target is the line and not
                a 26px box. A real checkbox underneath: it is announced as one,
                and Space toggles it.
              */}
              <label className="flex min-h-[56px] cursor-pointer items-center gap-3 px-4 py-2 hover:bg-canvas">
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
                    "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border-2",
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
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={["text-density", done ? "text-muted line-through" : "text-ink"].join(
                      " ",
                    )}
                  >
                    {entry.title}
                  </span>
                  <span
                    className={[
                      "truncate text-xs [font-variant-numeric:tabular-nums]",
                      late ? "font-medium text-danger" : "text-muted",
                    ].join(" ")}
                  >
                    {done ? (
                      <DoneLine entry={entry} actorId={actorId} names={names} />
                    ) : (
                      <>
                        {late ? "Late · " : ""}
                        {facts.join(" · ")}
                      </>
                    )}
                  </span>
                </span>
                {entry.carriedOver && !done ? <Pill tone="danger">Owed</Pill> : null}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
