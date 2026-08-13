"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, Card, EmptyState, Meter, Pill, useToast } from "@galaxy-farm/ui";
import {
  choreDaySheet,
  choreProgress,
  startOfDay,
  taskSchema,
  type ChoreEntry,
  type ChoreTemplate,
  type Task,
  type Ulid,
} from "@galaxy-farm/core";

import { toggleChore } from "@/lib/chores";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * Today's chores, on the dashboard (spec §7).
 *
 * The dashboard is what gets glanced at on the way out of the door, so this
 * card answers the one question asked there — what is still owed — and lets it
 * be ticked without leaving. §12 asks for every frequent action to be within
 * two taps of its context; a chore ticked from here is one.
 *
 * Only the first few, and only the ones still open. The full day, the days
 * either side of it, and the templates behind it are a link away.
 */

const SHOWN = 4;

export function ChoresCard({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: tasks } = useRecords<Task>("tasks", query);
  const { records: templates } = useRecords<ChoreTemplate>("choreTemplates", query);

  const api = useMutations<Task>("tasks", "tasks", taskSchema, propertyId, actorId);
  const { show } = useToast();
  const [busy, setBusy] = useState<string | undefined>();

  const now = new Date();
  const today = startOfDay(now);
  const sheet = choreDaySheet({ tasks, templates }, today, now);
  const progress = choreProgress(sheet);

  async function tick(entry: ChoreEntry) {
    setBusy(entry.id);
    try {
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

  const open = sheet.filter((entry) => entry.completedAt === undefined);
  const link = (
    <Link href="/admin/chores" className="text-action underline underline-offset-2">
      All chores
    </Link>
  );

  if (progress.total === 0) {
    return (
      <Card title="Chores">
        <EmptyState
          title="Nothing on today"
          detail="No template fires today and nobody wrote anything down. Set one up and it will turn up on its day by itself."
          action={link}
        />
      </Card>
    );
  }

  return (
    <Card
      title="Chores"
      actions={
        progress.overdue > 0 ? (
          <Pill tone="danger" dot>
            {progress.overdue} overdue
          </Pill>
        ) : progress.open === 0 ? (
          <Pill tone="calm">All done</Pill>
        ) : (
          <Pill tone="action">{progress.open} to do</Pill>
        )
      }
    >
      <div className="flex flex-col gap-density">
        <Meter
          value={progress.fraction}
          tone={progress.overdue > 0 ? "danger" : progress.open === 0 ? "calm" : "action"}
          label="Today"
          detail={`${progress.done} of ${progress.total} done`}
        />

        {open.length === 0 ? (
          <p className="text-sm text-muted">Everything asked for today is finished.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {open.slice(0, SHOWN).map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-edge pb-2 last:border-0 last:pb-0"
              >
                <span className="flex min-w-0 items-center gap-2 text-density text-ink">
                  {entry.title}
                  {entry.carriedOver ? <Pill tone="danger">Owed</Pill> : null}
                </span>
                <Button
                  variant="primary"
                  disabled={busy === entry.id}
                  onClick={() => void tick(entry)}
                >
                  Done
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-density text-sm text-muted">
        {open.length > SHOWN ? `${open.length - SHOWN} more still to do. ` : ""}
        {link}
      </p>
    </Card>
  );
}
