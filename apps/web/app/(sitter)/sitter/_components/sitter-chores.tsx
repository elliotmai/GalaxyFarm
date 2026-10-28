"use client";

import { useRouter } from "next/navigation";

import { Suspense, use, useState, useTransition } from "react";

import { Pill } from "@galaxy-farm/ui";
import { choreProgress, type ChoreEntry, type Ulid, type Zone } from "@galaxy-farm/core";

import { setChoreDone } from "@/app/(sitter)/sitter/_components/chore-actions";
import type { PeopleNames } from "@/lib/people-names";

/**
 * Today's chores, and the tick that finishes them (spec §5.10, §4.3).
 *
 * The one thing a housesitter may write, drawn the way the admin Today screen
 * and the barn board draw the same list: one row per chore, the whole row the
 * target, a box that fills in, and a finished row staying put — struck
 * through, saying who and when — because that line is what whoever is away is
 * checking. What is left leads; what is done sinks below it; a finished day
 * says so in one green line.
 *
 * The write goes to a server action and the page re-reads. This surface has no
 * local store — a sitter's device holds nothing (see `lib/sitter-store.ts`) —
 * so unlike the rest of the app there is a round trip here, and the row says
 * so by going busy rather than by pretending it is already done.
 */

function timeLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Done by Mai · 6:40", once the server has said who Mai is. */
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
  actorId,
  names,
}: {
  readonly entry: ChoreEntry;
  readonly actorId: Ulid | undefined;
  readonly names: Promise<PeopleNames> | undefined;
}) {
  const at = entry.completedAt === undefined ? "" : timeLabel(entry.completedAt);
  const by = entry.completedBy;
  const plain = <>Done · {at}</>;

  if (by === undefined) return plain;
  if (by === actorId) return <>Done by you · {at}</>;
  if (names === undefined) return plain;

  // The time stands on its own while the name is on its way, and stays alone
  // if the server cannot be reached — the round still happened.
  return (
    <Suspense fallback={plain}>
      <NamedDone id={by} at={at} names={names} />
    </Suspense>
  );
}

function Box({ done }: { readonly done: boolean }) {
  return (
    <span
      aria-hidden
      className={[
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2",
        "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-action",
        done ? "border-action bg-action text-action-ink" : "border-edge bg-panel",
      ].join(" ")}
    >
      {done ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
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

export function SitterChores({
  entries,
  day,
  zones,
  mayTick,
  actorId,
  names,
}: {
  readonly entries: readonly ChoreEntry[];
  readonly day: Date;
  readonly zones: readonly Zone[];
  readonly mayTick: boolean;
  readonly actorId?: Ulid | undefined;
  readonly names?: Promise<PeopleNames> | undefined;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const zoneName = (id: Ulid | undefined) =>
    id === undefined ? undefined : zones.find((zone) => zone.id === id)?.name;

  const progress = choreProgress(entries);
  const open = entries.filter((entry) => entry.completedAt === undefined);
  const done = entries.filter((entry) => entry.completedAt !== undefined);

  function toggle(entry: ChoreEntry) {
    setError(undefined);
    setBusyId(entry.id);

    startTransition(async () => {
      const result = await setChoreDone({
        ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
        ...(entry.templateId === undefined ? {} : { templateId: entry.templateId }),
        // The day on screen, not "today": a tick landing at ten past midnight
        // belongs to the evening round it finished. Sent as noon in this
        // device's own timezone, as an absolute instant, so the server reads
        // back the same day rather than reinterpreting a bare date in its own
        // timezone.
        day: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0).toISOString(),
        done: entry.completedAt === undefined,
      });

      setBusyId(undefined);
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(result.error);
    });
  }

  const row = (entry: ChoreEntry) => {
    const finished = entry.completedAt !== undefined;
    const late = !finished && entry.overdue;
    const facts = [entry.detail, zoneName(entry.zoneId), `by ${timeLabel(entry.dueAt)}`].filter(
      (part): part is string => part !== undefined && part !== "",
    );

    const face = (
      <>
        <Box done={finished} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={["text-density", finished ? "text-muted line-through" : "text-ink"].join(
              " ",
            )}
          >
            {entry.title}
          </span>
          <span
            className={[
              "text-sm [font-variant-numeric:tabular-nums]",
              late ? "font-medium text-danger" : "text-muted",
            ].join(" ")}
          >
            {finished ? (
              <DoneLine entry={entry} actorId={actorId} names={names} />
            ) : (
              <>
                {late ? "Late · " : ""}
                {facts.join(" · ")}
              </>
            )}
          </span>
        </span>
        {entry.carriedOver && !finished ? <Pill tone="danger">Owed</Pill> : null}
      </>
    );

    return (
      <li key={entry.id}>
        {mayTick ? (
          // The whole row is the label, so the target is the line and not a
          // 28px box — the hand doing the ticking is often in a glove. A real
          // checkbox underneath: announced as one, and Space toggles it.
          <label
            className={[
              "flex min-h-[64px] cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-canvas",
              pending && busyId === entry.id ? "opacity-60" : "",
            ].join(" ")}
          >
            <input
              type="checkbox"
              className="peer sr-only"
              checked={finished}
              disabled={pending && busyId === entry.id}
              onChange={() => toggle(entry)}
            />
            {face}
          </label>
        ) : (
          <div className="flex min-h-[64px] items-center gap-3 px-4 py-2.5">{face}</div>
        )}
      </li>
    );
  };

  return (
    <section aria-labelledby="sitter-today" className="flex min-w-0 flex-col gap-2.5">
      <h2
        id="sitter-today"
        className="font-body text-xs font-semibold uppercase tracking-wide text-muted"
      >
        Today
        {entries.length === 0 ? "" : progress.open === 0 ? " · done" : ` · ${progress.open} to do`}
        {mayTick ? "" : " · read-only"}
      </h2>

      {entries.length === 0 ? (
        <p className="rounded-density border border-rule bg-panel px-4 py-3 text-sm text-muted">
          Nothing on today&rsquo;s list. The routine below still applies.
        </p>
      ) : (
        <>
          {progress.open === 0 ? (
            <p className="flex items-center gap-2.5 rounded-density bg-calm/15 px-4 py-3 text-calm">
              <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 12l5 5 9-10"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="font-semibold">All done for today. Thank you.</span>
            </p>
          ) : (
            <div className="flex flex-col gap-2 rounded-density border border-rule bg-panel px-4 py-3">
              <span className="text-density font-semibold text-ink [font-variant-numeric:tabular-nums]">
                {progress.done} of {progress.total} done
              </span>
              <div
                role="progressbar"
                aria-label="Chores done today"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
                className="h-2 overflow-hidden rounded-full bg-raised"
              >
                <div
                  className="h-full rounded-full bg-action transition-[width]"
                  style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                />
              </div>
            </div>
          )}

          {error === undefined ? null : (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <ul className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel">
            {open.map(row)}
            {done.map(row)}
          </ul>
        </>
      )}
    </section>
  );
}
