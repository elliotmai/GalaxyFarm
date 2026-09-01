"use client";

import { useState, useTransition } from "react";

import { Meter, useToast } from "@galaxy-farm/ui";
import {
  choreProgress,
  displayName,
  type Animal,
  type ChoreEntry,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";

import { setKioskChoreDone } from "@/app/(kiosk)/kiosk/_actions";
import { useSyncEngine } from "@/app/_components/sync-provider";
import { groupChoresForBoard } from "@/lib/chores";

/**
 * The day's work on the housesitter board, checkable in place (spec §4.4,
 * §5.10).
 *
 * Grouped by the part of the day and, within it, by animal — because that is
 * how a sitter actually moves: out in the morning, animal by animal, back in
 * the evening. Feeding trips and template chores sit in the same groups, so
 * "everything Comet needs this morning" is one heading rather than a search.
 *
 * Built to fit one tablet screen. This is a kiosk on a post, glanced at with
 * an armful of feed, and a day that needs scrolling is a day whose evening
 * half gets forgotten. So the parts of the day sit side by side as columns,
 * and each chore is one row — the whole row is the tap target, which at kiosk
 * density is a bigger glove target than the buttons it replaces.
 *
 * The tick goes through the same server action as the Today's Chores board —
 * same capability check, same attribution to the screen — and the local store
 * re-syncs afterwards so both boards and the admin app agree.
 */

function dayString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function HousesitterChores({
  entries,
  animals,
  zones,
  day,
}: {
  readonly entries: readonly ChoreEntry[];
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly day: Date;
}) {
  const { syncNow } = useSyncEngine();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | undefined>();

  const sections = groupChoresForBoard(entries, {
    animal: (id: Ulid) => {
      const animal = animals.find((candidate) => candidate.id === id);
      return animal === undefined ? undefined : displayName(animal);
    },
    zone: (id: Ulid) => zones.find((zone) => zone.id === id)?.name,
  });
  const progress = choreProgress(entries);

  function toggle(entry: ChoreEntry) {
    setBusyId(entry.id);
    startTransition(async () => {
      const result = await setKioskChoreDone({
        ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
        ...(entry.templateId === undefined ? {} : { templateId: entry.templateId }),
        // A derived feeding trip has neither a row nor a template — its own
        // id is the key the server re-derives it by.
        ...(entry.taskId === undefined && entry.templateId === undefined
          ? { sourceKey: entry.id }
          : {}),
        day: dayString(day),
        done: entry.completedAt === undefined,
      });

      setBusyId(undefined);
      if (!result.ok) {
        show({ message: result.error, tone: "danger" });
        return;
      }
      await syncNow();
    });
  }

  const row = (entry: ChoreEntry) => {
    const finished = entry.completedAt !== undefined;

    return (
      <button
        key={entry.id}
        type="button"
        onClick={() => toggle(entry)}
        disabled={pending && busyId === entry.id}
        aria-pressed={finished}
        className={`flex min-h-target w-full items-center gap-2 rounded-density border px-3 py-1 text-left disabled:opacity-40 ${
          finished
            ? "border-edge opacity-60"
            : entry.overdue
              ? "border-danger hover:border-danger"
              : "border-edge hover:border-action"
        }`}
      >
        <span
          aria-hidden
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-sm ${
            finished ? "border-edge text-muted" : "border-edge text-transparent"
          }`}
        >
          ✓
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-density ${finished ? "text-muted line-through" : "text-ink"}`}
          >
            {entry.title}
          </span>
          {entry.detail === undefined || finished ? null : (
            <span className="block truncate text-sm text-muted">{entry.detail}</span>
          )}
        </span>
        {entry.overdue && !finished ? (
          <span className="shrink-0 text-sm font-medium text-danger">late</span>
        ) : null}
      </button>
    );
  };

  if (entries.length === 0) {
    return <p className="text-muted">Nothing on today's list.</p>;
  }

  return (
    <div className="flex flex-col gap-density">
      <Meter
        value={progress.fraction}
        tone={progress.overdue > 0 ? "danger" : progress.open === 0 ? "calm" : "action"}
        label="Today"
        detail={`${progress.done} of ${progress.total} done`}
      />

      {/* The parts of the day side by side, so the whole day is one glance. */}
      <div className="grid grid-cols-1 items-start gap-density sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => {
          const left = section.groups
            .flatMap((group) => group.entries)
            .filter((entry) => entry.completedAt === undefined).length;

          return (
            <section
              key={section.label}
              className="flex flex-col gap-2 rounded-density border border-edge bg-panel p-density"
            >
              <header className="flex items-baseline justify-between gap-2">
                <h3 className="text-density font-medium text-ink">{section.label}</h3>
                <span className="text-sm text-muted">{left === 0 ? "done" : `${left} to do`}</span>
              </header>

              {section.groups.map((group) => (
                <div key={group.label} className="flex flex-col gap-1">
                  <p className="text-sm font-medium uppercase tracking-wide text-muted">
                    {group.label}
                  </p>
                  {group.entries.map(row)}
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
