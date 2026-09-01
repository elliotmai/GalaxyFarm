"use client";

import { useState, useTransition } from "react";

import { Button, Meter, Pill, RecordCard, Section, useToast } from "@galaxy-farm/ui";
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
 * The tick goes through the same server action as the Today's Chores board —
 * same capability check, same attribution to the screen — and the local store
 * re-syncs afterwards so both boards and the admin app agree.
 */

function dayString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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

  const card = (entry: ChoreEntry) => {
    const finished = entry.completedAt !== undefined;

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
            {entry.overdue && !finished ? <Pill tone="danger">Overdue</Pill> : null}
            {finished ? <Pill tone="calm">done {timeLabel(entry.completedAt as Date)}</Pill> : null}
          </>
        }
      >
        <Button
          variant={finished ? "secondary" : "primary"}
          busy={pending && busyId === entry.id}
          onClick={() => toggle(entry)}
          className="w-full"
        >
          {finished ? "Put it back" : "Done"}
        </Button>
      </RecordCard>
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

      {sections.map((section) => (
        <Section key={section.label} title={section.label}>
          <div className="flex flex-col gap-density">
            {section.groups.map((group) => (
              <div key={group.label} className="flex flex-col gap-2">
                <p className="text-sm font-medium uppercase tracking-wide text-muted">
                  {group.label}
                </p>
                {group.entries.map(card)}
              </div>
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}
