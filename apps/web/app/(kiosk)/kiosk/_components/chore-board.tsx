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
import type { PeopleNames } from "@/lib/people-names";

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

/**
 * The day on screen, as an absolute instant rather than a bare calendar
 * string — noon in *this device's* real timezone, serialized so the server
 * reads back the same instant rather than reinterpreting a bare date in its
 * own timezone (which is what silently shifted a tick onto the wrong day for
 * any farm whose local time isn't close to the server's).
 */
function dayString(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0).toISOString();
}

/**
 * "Done by Sam · 6:40", or "Done · 6:40" while the name is on its way — and
 * for good if the server cannot be reached.
 */
function doneBy(entry: ChoreEntry, names: PeopleNames | undefined): string {
  const at =
    entry.completedAt === undefined
      ? ""
      : entry.completedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const name = entry.completedBy === undefined ? undefined : names?.[entry.completedBy];
  return name === undefined ? `Done · ${at}` : `Done by ${name} · ${at}`;
}

export function ChoreBoard({
  entries,
  animals,
  zones,
  day,
  names,
}: {
  readonly entries: readonly ChoreEntry[];
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly day: Date;
  /** Who ticked what, resolved on the server; never rejects. */
  readonly names?: Promise<PeopleNames> | undefined;
}) {
  const { syncNow } = useSyncEngine();
  const { show } = useToast();
  const [, startTransition] = useTransition();
  /** In-flight rows, so a double tap cannot write the same chore twice. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  /** What each tapped row shows until the store catches up. */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, Date | undefined>>(new Map());
  /*
   * Read once, at the board: a finished row is mounted only when its part of
   * the day is unfolded, and should not have to wait on the promise itself.
   */
  const [known, setKnown] = useState<PeopleNames>();
  useEffect(() => {
    let live = true;
    void names?.then((resolved) => {
      if (live) setKnown(resolved);
    });
    return () => {
      live = false;
    };
  }, [names]);
  /** Rows whose detail somebody opened. Opening one ticks nothing. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  /** Fully finished parts of the day somebody unfolded to look back over. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

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

  function toggleSection(label: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(label)) {
        // crud-guard: allow-unconfirmed — folds a section, nothing persisted
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }

  /*
   * Rows hold 48px — under the kiosk's 64px buttons so a dozen chores and the
   * feeding rounds still fit a tablet, over the 44px platform floor so a
   * gloved thumb does not miss. Everything a chore has to say fits one line:
   * title, amounts, where, and whether it is late.
   */
  const row = (entry: ChoreEntry) => {
    const finished = entry.completedAt !== undefined;
    const where = whereLabel(entry);
    const open = opened.has(entry.id);

    return (
      <li
        key={entry.id}
        className={`border-l-4 bg-panel ${
          finished ? "border-calm" : entry.overdue ? "border-danger" : "border-edge"
        }`}
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => toggle(entry)}
            disabled={busy.has(entry.id)}
            aria-pressed={finished}
            className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 px-2.5 text-left hover:bg-raised disabled:opacity-40"
          >
            <span
              aria-hidden
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                finished ? "border-calm bg-calm text-canvas" : "border-edge text-transparent"
              }`}
            >
              ✓
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className={finished ? "text-muted line-through" : "font-medium text-ink"}>
                {entry.title}
              </span>
              {entry.detail === undefined || finished || open ? null : (
                <span className="text-muted"> — {entry.detail}</span>
              )}
            </span>
            {where === undefined || finished ? null : (
              <span className="max-w-24 shrink-0 truncate text-xs text-muted">{where}</span>
            )}
            {entry.overdue && !finished ? (
              <span className="shrink-0 text-xs font-semibold text-danger">late</span>
            ) : null}
            {finished && entry.completedAt !== undefined ? (
              <span className="shrink-0 text-xs text-muted">{doneBy(entry, known)}</span>
            ) : null}
          </button>

          {entry.detail === undefined || finished ? null : (
            // Its own target, beside the tick rather than inside it: reading
            // the full instruction must never count as doing the chore.
            <button
              type="button"
              onClick={() => toggleDetail(entry.id)}
              aria-expanded={open}
              aria-label={open ? "Hide the detail" : "Show the whole detail"}
              className="flex w-12 shrink-0 items-center justify-center border-l border-rule text-muted hover:bg-raised"
            >
              <span aria-hidden className={`transition-transform ${open ? "rotate-90" : ""}`}>
                ›
              </span>
            </button>
          )}
        </div>

        {open && entry.detail !== undefined ? (
          <p className="whitespace-pre-wrap border-t border-rule px-3 py-2 text-sm text-muted">
            {entry.detail}
          </p>
        ) : null}
      </li>
    );
  };

  if (entries.length === 0) {
    return <p className="text-muted">Nothing on today's list.</p>;
  }

  const allDone = progress.open === 0;
  const nowHour = new Date().getHours();
  const currentLabel = sections.find(
    (section) =>
      section.label !== "Owed from earlier" &&
      section.entries.some((entry) => entry.completedAt === undefined) &&
      sectionHours(section.label)(nowHour),
  )?.label;

  return (
    <div className="flex flex-col gap-density">
      {/* The whole day as one sentence and one bar, readable from the alley. */}
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-baseline gap-x-3 text-sm text-muted">
          <span className="font-heading text-[1.6em] leading-none text-ink">
            {allDone ? "All done" : `${progress.open} to go`}
          </span>
          <span>
            {progress.done} of {progress.total} done
            {progress.overdue > 0 ? (
              <span className="font-semibold text-danger"> · {progress.overdue} late</span>
            ) : null}
          </span>
        </p>
        <div
          role="progressbar"
          aria-label="Chores done today"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          className="h-2 w-full bg-raised"
        >
          <div className="h-full bg-calm" style={{ width: `${progress.fraction * 100}%` }} />
        </div>
      </div>

      {/* The parts of the day side by side, so the whole day is one glance. */}
      <div className="grid grid-cols-1 items-start gap-density sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sections.map((section) => {
          const todo = section.entries.filter((entry) => entry.completedAt === undefined);
          const done = section.entries.filter((entry) => entry.completedAt !== undefined);
          const folded = !expanded.has(section.label);
          const isNow = section.label === currentLabel;
          const owed = section.label === "Owed from earlier";

          return (
            <section
              key={section.label}
              className={`flex flex-col gap-2 border-t-4 bg-raised p-2 ${
                owed ? "border-danger" : isNow ? "border-action" : "border-rule"
              }`}
            >
              <header className="flex items-baseline justify-between gap-2">
                <h3 className={`text-lg ${owed ? "text-danger" : "text-ink"}`}>{section.label}</h3>
                <span className="text-xs text-muted">
                  {todo.length === 0 ? "done" : `${todo.length} to do`}
                </span>
              </header>

              {todo.length === 0 ? null : <ul className="flex flex-col gap-1">{todo.map(row)}</ul>}

              {done.length === 0 ? null : (
                <>
                  <button
                    type="button"
                    onClick={() => toggleSection(section.label)}
                    aria-expanded={!folded}
                    className="flex min-h-10 items-center justify-between gap-2 px-1 text-left text-xs text-muted hover:text-ink"
                  >
                    <span>{done.length} finished</span>
                    <span aria-hidden>{folded ? "Show" : "Hide"}</span>
                  </button>
                  {folded ? null : <ul className="flex flex-col gap-1">{done.map(row)}</ul>}
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Which hours of the day a board section covers; mirrors `groupChoresForBoard`. */
function sectionHours(label: string): (hour: number) => boolean {
  switch (label) {
    case "Morning":
      return (hour) => hour < 12;
    case "Midday":
      return (hour) => hour >= 12 && hour < 15;
    case "Evening":
      return (hour) => hour >= 15 && hour < 21;
    default:
      return (hour) => hour >= 21;
  }
}
