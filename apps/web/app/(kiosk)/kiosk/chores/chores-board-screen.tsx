"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { Button, Meter, PageBody, PageHeader, Pill, RecordCard, useToast } from "@galaxy-farm/ui";
import {
  choreDaySheet,
  choreProgress,
  type ChoreEntry,
  type ChoreTemplate,
  type FeedingPlan,
  type Task,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import type { FeedType } from "@galaxy-farm/module-feed";

import { setKioskChoreDone } from "@/app/(kiosk)/kiosk/_actions";
import { useSyncEngine } from "@/app/_components/sync-provider";
import { feedingChoresFor, feedingChoreText } from "@/lib/feeding-chores";
import { useRecords } from "@/lib/local/use-records";

/**
 * Today's Chores (spec §4.4, §5.1) — the same day sheet the admin app and
 * `/sitter` derive, `choreDaySheet` run against what this device has already
 * pulled. A full-width button rather than a checkbox: the hand doing the
 * ticking is often gloved, and a 16px square is a target people stop hitting.
 */

function dayString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function ChoresBoardScreen({ propertyId }: { readonly propertyId: Ulid }) {
  const { store, syncNow } = useSyncEngine();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | undefined>();

  const query = useMemo(() => ({ propertyId }), [propertyId]);
  const { records: tasks, loading } = useRecords<Task>("tasks", query);
  const { records: templates } = useRecords<ChoreTemplate>("choreTemplates", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  // Feeding is derived from the plans (§2), here as on every other surface —
  // a barn board missing the feeding rounds would disagree with the admin app.
  const { records: plans } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);

  const today = useMemo(() => new Date(), []);
  const entries = useMemo(() => {
    const derived = feedingChoresFor(
      plans,
      feedingChoreText({ zones, feeds, propertyId }),
      today,
      today,
    );
    return choreDaySheet({ tasks, templates, derived }, today, today);
  }, [tasks, templates, plans, zones, feeds, propertyId, today]);

  const zoneName = (id: Ulid | undefined) =>
    id === undefined ? undefined : zones.find((zone) => zone.id === id)?.name;

  const progress = choreProgress(entries);
  const open = entries.filter((entry) => entry.completedAt === undefined);
  const done = entries.filter((entry) => entry.completedAt !== undefined);

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
        day: dayString(today),
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

  return (
    <PageBody>
      <PageHeader
        eyebrow={<Link href="/kiosk">← Kiosk</Link>}
        title="Today's Chores"
        subtitle="Tick each one off as it happens."
      />

      {loading || store === undefined ? (
        <p className="text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-muted">Nothing on today's list.</p>
      ) : (
        <div className="flex flex-col gap-density">
          <Meter
            value={progress.fraction}
            tone={progress.open === 0 ? "calm" : "action"}
            label="Today"
            detail={`${progress.done} of ${progress.total} done`}
          />

          <div className="flex flex-col gap-density">{open.map(card)}</div>
          {done.length === 0 ? null : (
            <div className="flex flex-col gap-density opacity-70">{done.map(card)}</div>
          )}
        </div>
      )}
    </PageBody>
  );
}
