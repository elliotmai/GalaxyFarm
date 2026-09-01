"use client";

import { useEffect, useState, useTransition } from "react";

import { useToast } from "@galaxy-farm/ui";
import {
  choreProgress,
  displayName,
  type Animal,
  type ChoreEntry,
  type Zone,
} from "@galaxy-farm/core";

import { setKioskChoreDone } from "@/app/(kiosk)/kiosk/_actions";
import { useSyncEngine } from "@/app/_components/sync-provider";
import { groupChoresForBoard } from "@/lib/chores";

/**
 * A day's chores on a kiosk board, checkable in place (spec §4.4, §5.1, §5.10).
 *
 * One component behind both boards that show the day — Today's Chores and the
 * housesitter board — because they are the same list of the same day, and two
 * copies of the tick would be two chances to write the un-tick wrongly.
 *
 * Sectioned by the part of the day and flat within it — feeding trips and
 * template chores in one list, in due order, the finished ones sinking to the
 * bottom of their section. Who a chore is about rides the row itself (the
 * ration in a feed's title, the animal or pen as a small tag), because on a
 * one-screen board every heading costs a row.
 *
 * Built to fit one screen. This is a kiosk on a post, glanced at with an
 * armful of feed, and a day that needs scrolling is a day whose evening half
 * gets forgotten. So the parts of the day sit side by side as columns, and
 * each chore is one row: the row ticks it, and a chore with more to say than
 * its line can hold gets a separate expander that opens the detail without
 * ticking anything.
 *
 * The tick goes through `setKioskChoreDone` — the kiosk's own server action,
 * with its capability check and its attribution to the screen. It does not
 * make the finger wait for the round trip: the row moves the moment it is
 * tapped, the write happens behind it, and the tick is put back with an error
 * if the farm refuses it. The overrides that carry that are dropped as soon as
 * the synced store agrees, so the server stays the authority.
 */

function dayString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function ChoreBoard({
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
  const [, startTransition] = useTransition();
  /** In-flight rows, so a double tap cannot write the same chore twice. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  /** What each tapped row shows until the store catches up. */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Date | undefined>>(new Map());
  /** Rows whose detail somebody opened. Opening one ticks nothing. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  /*
   * Drop an override once the store agrees with it — from there the synced
   * record (and any other device's edits) is the authority again. An id the
   * sheet no longer produces is dropped too: a ticked feeding occurrence
   * comes back from the store as a stored row under a new id.
   */
  useEffect(() => {
    setOverrides((current) => {
      if (current.size === 0) return current;

      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      const next = new Map(current);
      for (const [id, completedAt] of current) {
        const entry = byId.get(id);
        if (
          entry === undefined ||
          (entry.completedAt !== undefined) === (completedAt !== undefined)
        ) {
          // crud-guard: allow-unconfirmed — drops a render-local override, nothing persisted
          next.delete(id);
        }
      }
      return next.size === current.size ? current : next;
    });
  }, [entries]);

  const shown = entries.map((entry) =>
    overrides.has(entry.id) ? { ...entry, completedAt: overrides.get(entry.id) } : entry,
  );
  const sections = groupChoresForBoard(shown);
  const progress = choreProgress(shown);

  const whereLabel = (entry: ChoreEntry): string | undefined => {
    if (entry.animalId !== undefined) {
      const animal = animals.find((candidate) => candidate.id === entry.animalId);
      return animal === undefined ? undefined : displayName(animal);
    }
    if (entry.zoneId !== undefined) return zones.find((zone) => zone.id === entry.zoneId)?.name;
    return undefined;
  };

  function toggle(entry: ChoreEntry) {
    if (busy.has(entry.id)) return;
    const done = entry.completedAt === undefined;

    // The row moves now; the write follows. Waiting for the round trip and
    // the sync pull is a visible pause between the tap and anything happening,
    // and a button that hesitates gets tapped again.
    setBusy((current) => new Set(current).add(entry.id));
    setOverrides((current) => new Map(current).set(entry.id, done ? new Date() : undefined));

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
        done,
      });

      setBusy((current) => {
        const next = new Set(current);
        // crud-guard: allow-unconfirmed — clears an in-flight row id, nothing persisted
        next.delete(entry.id);
        return next;
      });

      if (!result.ok) {
        // Put the tick back the way it was, and say why.
        setOverrides((current) => {
          const next = new Map(current);
          // crud-guard: allow-unconfirmed — puts a render-local tick back, nothing persisted
          next.delete(entry.id);
          return next;
        });
        show({ message: result.error, tone: "danger" });
        return;
      }
      await syncNow();
    });
  }

  function toggleDetail(id: string) {
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        // crud-guard: allow-unconfirmed — closes an expander, nothing persisted
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  /*
   * Deliberately tighter than the kiosk density tokens. The tokens size a
   * board for a big screen on a post, and at 64px rows and 20px gaps half the
   * day scrolls off a tablet — and scrolls off the post-mounted screen too,
   * once the feeding trips are on the sheet beside the chores. Rows hold the
   * 44px the platform guidelines ask of a touch target — smaller than a kiosk
   * button, still honest to a glove — and everything a chore has to say fits
   * one line: title, amounts, where, and whether it is late.
   */
  const row = (entry: ChoreEntry) => {
    const finished = entry.completedAt !== undefined;
    const where = whereLabel(entry);
    const open = opened.has(entry.id);

    return (
      <div
        key={entry.id}
        className={`border ${
          finished ? "border-edge opacity-60" : entry.overdue ? "border-danger" : "border-edge"
        }`}
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => toggle(entry)}
            disabled={busy.has(entry.id)}
            aria-pressed={finished}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-2 text-left hover:bg-raised disabled:opacity-40"
          >
            <span
              aria-hidden
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border border-edge text-xs ${
                finished ? "text-muted" : "text-transparent"
              }`}
            >
              ✓
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className={finished ? "text-muted line-through" : "text-ink"}>
                {entry.title}
              </span>
              {entry.detail === undefined || finished || open ? null : (
                <span className="text-muted"> — {entry.detail}</span>
              )}
            </span>
            {where === undefined || finished ? null : (
              <span className="max-w-20 shrink-0 truncate text-xs text-muted">{where}</span>
            )}
            {entry.overdue && !finished ? (
              <span className="shrink-0 text-xs font-medium text-danger">late</span>
            ) : null}
          </button>

          {entry.detail === undefined ? null : (
            // Its own target, beside the tick rather than inside it: reading
            // the full instruction must never count as doing the chore.
            <button
              type="button"
              onClick={() => toggleDetail(entry.id)}
              aria-expanded={open}
              aria-label={open ? "Hide the detail" : "Show the whole detail"}
              className="flex w-10 shrink-0 items-center justify-center border-l border-edge text-muted hover:bg-raised"
            >
              <span aria-hidden className={`transition-transform ${open ? "rotate-90" : ""}`}>
                ›
              </span>
            </button>
          )}
        </div>

        {open && entry.detail !== undefined ? (
          <p className="whitespace-pre-wrap border-t border-edge px-2 py-1.5 text-sm text-muted">
            {entry.detail}
          </p>
        ) : null}
      </div>
    );
  };

  if (entries.length === 0) {
    return <p className="text-muted">Nothing on today's list.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* One line of progress; a meter would spend a row saying the same. */}
      <p className="text-sm text-muted">
        {progress.done} of {progress.total} done
        {progress.overdue > 0 ? (
          <span className="text-danger"> · {progress.overdue} late</span>
        ) : null}
      </p>

      {/* The parts of the day side by side, so the whole day is one glance. */}
      <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sections.map((section) => {
          const left = section.entries.filter((entry) => entry.completedAt === undefined).length;

          return (
            <section
              key={section.label}
              className="flex flex-col gap-1 border border-edge bg-panel p-2"
            >
              <header className="flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-ink">
                  {section.label}
                </h3>
                <span className="text-xs text-muted">{left === 0 ? "done" : `${left} to do`}</span>
              </header>

              {section.entries.map(row)}
            </section>
          );
        })}
      </div>
    </div>
  );
}
