"use client";

import { Suspense, use, useEffect, useState, useTransition } from "react";

import { useToast } from "@galaxy-farm/ui";
import {
  choreProgress,
  displayName,
  type Animal,
  type ChoreEntry,
  type Zone,
} from "@galaxy-farm/core";

import { setKioskChoreDone } from "@/app/(kiosk)/kiosk/_actions";
import { KioskQuiet } from "@/app/(kiosk)/kiosk/_components/kiosk-header";
import { useSyncEngine } from "@/app/_components/sync-provider";
import { groupChoresForBoard } from "@/lib/chores";
import type { PeopleNames } from "@/lib/people-names";

/**
 * A day's chores on a kiosk board, checkable in place (spec §4.4, §5.1, §5.10).
 *
 * One component behind both boards that show the day — Today's Chores and the
 * housesitter board — because they are the same list of the same day, and two
 * copies of the tick would be two chances to write the un-tick wrongly. It is
 * also the list the admin Today screen ticks, off the same `choreDaySheet`, so
 * the count at the top says the same number on the post and on a phone.
 *
 * **Status by exception.** What is left is what the board is for, so open
 * rows lead each part of the day at full strength and a late one carries a
 * red edge and the word. A ticked row sinks to the bottom of its part, muted,
 * and says who and when — the record somebody away from the place is
 * checking. A part of the day with nothing left folds to one line, and a day
 * with nothing left is one green panel rather than a wall of struck-through
 * rows: the good news is the thing to read from across the barn.
 *
 * **Big rows.** Kiosk density, not the 44px the platform guidelines ask of a
 * phone: this is pressed with a gloved hand, often in the dark, by somebody
 * glancing over an armful of feed. The parts of the day sit side by side on a
 * wide screen, so a full day still fits a 1280×800 post-mounted tablet, and
 * stack on anything narrower. A chore with more to say than its line can hold
 * gets a separate expander that opens the detail without ticking anything.
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

function timeOf(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Done by Sam · 6:40", once the server has said who Sam is. */
function NamedDone({
  id,
  at,
  names,
}: {
  readonly id: string;
  readonly at: string;
  readonly names: Promise<PeopleNames>;
}) {
  const name = use(names)[id];
  return <>{name === undefined ? `Done · ${at}` : `Done by ${name} · ${at}`}</>;
}

function DoneLine({
  entry,
  names,
}: {
  readonly entry: ChoreEntry;
  readonly names: Promise<PeopleNames> | undefined;
}) {
  const at = entry.completedAt === undefined ? "" : timeOf(entry.completedAt);
  const plain = <>Done · {at}</>;
  if (entry.completedBy === undefined || names === undefined) return plain;

  // The time stands on its own while the name is on its way, and stays alone
  // if the server cannot be reached — the round still happened.
  return (
    <Suspense fallback={plain}>
      <NamedDone id={entry.completedBy} at={at} names={names} />
    </Suspense>
  );
}

function Check({ done }: { readonly done: boolean }) {
  return (
    <span
      aria-hidden
      className={[
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-density border-2",
        done ? "border-action bg-action text-action-ink" : "border-edge bg-panel",
      ].join(" ")}
    >
      {done ? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
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
  );
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
  /** Rows whose detail somebody opened. Opening one ticks nothing. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  /** Finished parts of the day somebody unfolded to see who did what. */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  /**
   * Parts of the day somebody ticked in on this screen. They stay open once
   * finished: a row that vanished under the finger that ticked it would leave
   * nothing to un-tick, and no sign the tap landed.
   */
  const [worked, setWorked] = useState<ReadonlySet<string>>(new Set());

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

  // An overridden row drops its stored attribution with its stored state: a
  // tick made a second ago on this screen has nobody to name yet, and an
  // un-tick has nobody at all.
  const shown = entries.map((entry) =>
    overrides.has(entry.id)
      ? { ...entry, completedAt: overrides.get(entry.id), completedBy: undefined }
      : entry,
  );
  const sections = groupChoresForBoard(shown);
  const progress = choreProgress(shown);
  const late = shown.filter((entry) => entry.completedAt === undefined && entry.overdue).length;

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
    const part = sections.find((section) => section.entries.some((e) => e.id === entry.id));
    if (part !== undefined) setWorked((current) => new Set(current).add(part.label));
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

  /** Flip one id in a set of open things — an expander, a folded part of the day. */
  const flip = (id: string) => (current: ReadonlySet<string>) => {
    const next = new Set(current);
    if (next.has(id)) {
      // crud-guard: allow-unconfirmed — closes an expander, nothing persisted
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  };

  const row = (entry: ChoreEntry) => {
    const finished = entry.completedAt !== undefined;
    const overdue = !finished && entry.overdue;
    const where = whereLabel(entry);
    const open = opened.has(entry.id);
    const facts = [where, `by ${timeOf(entry.dueAt)}`].filter(
      (part): part is string => part !== undefined && part !== "",
    );

    return (
      <li key={entry.id} className="relative">
        {/* The red edge is the exception, findable before a word is read; the
            word on the row says the same for anyone who cannot see red. */}
        {overdue ? (
          <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-danger" />
        ) : null}
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => toggle(entry)}
            disabled={busy.has(entry.id)}
            aria-pressed={finished}
            className="flex min-h-target min-w-0 flex-1 items-center gap-4 px-4 py-2 text-left hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action disabled:opacity-60"
          >
            <Check done={finished} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={[
                  "text-density font-semibold",
                  finished ? "text-muted line-through" : "text-ink",
                ].join(" ")}
              >
                {entry.title}
              </span>
              <span className="truncate text-base text-muted [font-variant-numeric:tabular-nums]">
                {finished ? <DoneLine entry={entry} names={names} /> : facts.join(" · ")}
              </span>
            </span>
            {overdue ? (
              <span className="shrink-0 text-base font-semibold uppercase tracking-wide text-danger">
                late
              </span>
            ) : null}
          </button>

          {entry.detail === undefined ? null : (
            // Its own target, beside the tick rather than inside it: reading
            // the full instruction must never count as doing the chore.
            <button
              type="button"
              onClick={() => setOpened(flip(entry.id))}
              aria-expanded={open}
              aria-label={open ? "Hide the detail" : "Show the whole detail"}
              className="flex min-w-target shrink-0 items-center justify-center border-l border-rule text-muted hover:bg-raised"
            >
              <svg
                aria-hidden
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                className={`transition-transform ${open ? "rotate-90" : ""}`}
              >
                <path
                  d="M9 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>

        {open && entry.detail !== undefined ? (
          <p className="whitespace-pre-wrap border-t border-rule bg-canvas px-4 py-3 text-base text-ink">
            {entry.detail}
          </p>
        ) : null}
      </li>
    );
  };

  if (entries.length === 0) {
    return <KioskQuiet>Nothing on today&rsquo;s list.</KioskQuiet>;
  }

  const allDone = progress.open === 0;

  return (
    <div className="flex flex-col gap-density">
      {allDone ? (
        <p className="flex items-center gap-4 rounded-density bg-calm/15 px-5 py-5 text-calm">
          <svg aria-hidden width="40" height="40" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12l5 5 9-10"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="flex flex-col">
            <span className="font-heading text-3xl font-semibold">All done for today</span>
            <span className="text-density">
              {progress.done} of {progress.total} done
            </span>
          </span>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {/* One count, the same one the admin Today shows over the same list. */}
          <p className="text-density font-semibold text-ink [font-variant-numeric:tabular-nums]">
            {progress.done} of {progress.total} done
            {late > 0 ? <span className="text-danger"> · {late} late</span> : null}
          </p>
          <div
            role="progressbar"
            aria-label="Chores done today"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            className="h-3 overflow-hidden rounded-full bg-raised"
          >
            <div
              className="h-full rounded-full bg-action transition-[width]"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* The parts of the day side by side on a wide screen, stacked on a narrow one. */}
      <div className="grid grid-cols-1 items-start gap-density lg:grid-cols-2">
        {sections.map((section) => {
          const left = section.entries.filter((entry) => entry.completedAt === undefined).length;
          const folded = left === 0 && !unfolded.has(section.label) && !worked.has(section.label);
          const headingId = `chores-${section.label.replace(/\W+/g, "-").toLowerCase()}`;

          return (
            <section
              key={section.label}
              aria-labelledby={headingId}
              className="flex min-w-0 flex-col gap-2"
            >
              <header className="flex min-h-10 items-center justify-between gap-3">
                <span className="flex items-baseline gap-3">
                  <h2 id={headingId} className="text-xl tracking-wide text-ink">
                    {section.label}
                  </h2>
                  <span
                    className={`text-base ${left === 0 ? "font-semibold text-calm" : "text-muted"}`}
                  >
                    {left === 0 ? "done" : `${left} to do`}
                  </span>
                </span>
                {left === 0 && !worked.has(section.label) ? (
                  // A finished part of the day folds to this line; who did
                  // each one is a tap away rather than a column of strikes.
                  <button
                    type="button"
                    onClick={() => setUnfolded(flip(section.label))}
                    aria-expanded={!folded}
                    className="min-h-10 rounded-density px-3 text-base font-semibold text-action hover:bg-raised"
                  >
                    {folded ? `Show ${section.entries.length}` : "Hide"}
                  </button>
                ) : null}
              </header>

              {folded ? null : (
                <ul className="divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel">
                  {section.entries.map(row)}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
