"use client";

import { useRouter } from "next/navigation";

import { useState, useTransition } from "react";

import { Button, EmptyState, Meter, Pill, RecordCard, Section } from "@galaxy-farm/ui";
import { choreProgress, type ChoreEntry, type Ulid, type Zone } from "@galaxy-farm/core";

import { setChoreDone } from "@/app/(sitter)/sitter/_components/chore-actions";

/**
 * Today's chores, and the tick that finishes them (spec §5.10, §4.3).
 *
 * The one thing a housesitter may write. The tick is a full-width button
 * rather than a checkbox for the same reason it is on the admin day sheet: the
 * hand doing the ticking is often in a glove, and a row that is only tappable
 * on a 16px square is a row people stop ticking.
 *
 * The write goes to a server action and the page re-reads. This surface has no
 * local store — a sitter's device holds nothing (see `lib/sitter-store.ts`) —
 * so unlike the rest of the app there is a round trip here, and the button
 * says so by going busy rather than by pretending it is already done.
 */

function timeLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function SitterChores({
  entries,
  day,
  zones,
  mayTick,
}: {
  readonly entries: readonly ChoreEntry[];
  readonly day: Date;
  readonly zones: readonly Zone[];
  readonly mayTick: boolean;
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
        // belongs to the evening round it finished.
        day: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
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

  const card = (entry: ChoreEntry) => {
    const finished = entry.completedAt !== undefined;
    const where = zoneName(entry.zoneId);

    return (
      <RecordCard
        key={entry.id}
        tone={finished ? "calm" : entry.overdue ? "danger" : "neutral"}
        title={
          <span className={finished ? "text-muted line-through" : undefined}>{entry.title}</span>
        }
        subtitle={entry.detail}
        meta={
          <>
            {where === undefined ? null : <Pill>{where}</Pill>}
            {entry.carriedOver ? <Pill tone="danger">from an earlier day</Pill> : null}
            {finished ? <Pill tone="calm">done {timeLabel(entry.completedAt as Date)}</Pill> : null}
          </>
        }
      >
        {mayTick ? (
          <Button
            variant={finished ? "secondary" : "primary"}
            busy={pending && busyId === entry.id}
            onClick={() => toggle(entry)}
            className="w-full"
          >
            {finished ? "Put it back" : "Done"}
          </Button>
        ) : null}
      </RecordCard>
    );
  };

  return (
    <Section
      title="Today"
      description={
        mayTick
          ? "Tick each one as you finish it. Whoever is away sees it straight away."
          : "Read-only — your window for changing anything has ended."
      }
    >
      {entries.length === 0 ? (
        <EmptyState
          title="Nothing on today's list"
          detail="The routine below still applies. If something needs doing and is not here, it is worth a message rather than a guess."
        />
      ) : (
        <div className="flex flex-col gap-density">
          <Meter
            value={progress.fraction}
            tone={progress.open === 0 ? "calm" : "action"}
            label="Today"
            detail={`${progress.done} of ${progress.total} done`}
          />

          {error === undefined ? null : <p className="text-sm text-danger">{error}</p>}

          <div className="flex flex-col gap-density">{open.map(card)}</div>
          {done.length === 0 ? null : (
            <div className="flex flex-col gap-density opacity-70">{done.map(card)}</div>
          )}
        </div>
      )}
    </Section>
  );
}
