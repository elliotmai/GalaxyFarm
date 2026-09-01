"use client";

import { useState } from "react";

import {
  Button,
  EmptyState,
  Modal,
  Pill,
  RecordCard,
  Section,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import {
  displayName,
  endOfDay,
  taskSchema,
  type Animal,
  type ChoreEntry,
  type ChoreTemplate,
  type Task,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";

import { toggleChore } from "@/lib/chores";
import { useMutations } from "@/lib/local/mutations";

/**
 * One day's chores, with the tick that finishes them (spec §6).
 *
 * The tick is the whole screen. It is a button the width of the card rather
 * than a checkbox, because the hand doing the ticking is in a glove and the
 * screen is often a kiosk on a post — and because a row that is only tappable
 * on a 16px square is a row people stop ticking.
 *
 * Ticking a chore that came from a template is what *writes* it: the sheet is
 * derived until somebody finishes something, and then the finished thing
 * becomes a record with a time and a name on it. Nothing writes a row for work
 * that has not happened.
 */

interface Draft {
  readonly title: string;
  readonly detail: string;
  readonly zoneId: string;
  readonly animalId: string;
}

const BLANK: Draft = { title: "", detail: "", zoneId: "", animalId: "" };

function timeLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function DaySheet({
  entries,
  templates,
  zones,
  animals,
  date,
  dayName,
  propertyId,
  actorId,
}: {
  readonly entries: readonly ChoreEntry[];
  readonly templates: readonly ChoreTemplate[];
  readonly zones: readonly Zone[];
  readonly animals: readonly Animal[];
  readonly date: Date;
  readonly dayName: string;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const tasks = useMutations<Task>("tasks", "tasks", taskSchema, propertyId, actorId);
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<ChoreEntry | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | undefined>();

  /**
   * The open entry has no record behind it.
   *
   * Which makes the dialog a detail view rather than a form: what it shows
   * belongs to the template, and editing the copy would change one day while
   * leaving every other day saying the old thing.
   */
  const readOnly = editing !== undefined && editing.taskId === undefined;

  const zoneName = (id: Ulid | undefined) =>
    id === undefined ? undefined : zones.find((zone) => zone.id === id)?.name;
  const animalName = (id: Ulid | undefined) => {
    if (id === undefined) return undefined;
    const animal = animals.find((candidate) => candidate.id === id);
    return animal === undefined ? undefined : displayName(animal);
  };

  async function toggle(entry: ChoreEntry) {
    setBusy(entry.id);
    try {
      const result = await toggleChore(tasks, {
        entry,
        template: templates.find((candidate) => candidate.id === entry.templateId),
        date,
        at: new Date(),
        actorId,
      });

      if (!result.ok) show({ message: "Could not change that chore", tone: "danger" });
    } finally {
      setBusy(undefined);
    }
  }

  function startCreate() {
    setEditing(undefined);
    setDraft(BLANK);
    setErrors({});
  }

  function startEdit(entry: ChoreEntry) {
    setEditing(entry);
    setDraft({
      title: entry.title,
      detail: entry.detail ?? "",
      zoneId: entry.zoneId ?? "",
      animalId: entry.animalId ?? "",
    });
    setErrors({});
  }

  async function save() {
    // A projected occurrence has nothing to save into — the form is read-only
    // in that case, and saving would silently write a second copy beside the
    // template's own.
    if (draft === undefined || readOnly) return;

    const fields = {
      title: draft.title.trim(),
      ...(draft.detail.trim() === "" ? {} : { detail: draft.detail.trim() }),
      ...(draft.zoneId === "" ? {} : { zoneId: draft.zoneId as Ulid }),
      ...(draft.animalId === "" ? {} : { animalId: draft.animalId as Ulid }),
    };

    // A chore written down for the day on screen is due at the end of it, the
    // same as one a template generated. Nothing here asks for a time, so
    // nothing here pretends to know one.
    const result =
      editing?.taskId === undefined
        ? await tasks.create({ ...fields, dueAt: endOfDay(date) })
        : await tasks.update(editing.taskId, fields);

    if (!result.ok) {
      setErrors(
        result.error.kind === "validation"
          ? Object.fromEntries(
              result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
            )
          : { title: "Could not save. Check the fields and try again." },
      );
      return;
    }

    show({ message: editing === undefined ? "Chore added" : "Chore saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
  }

  async function remove(entry: ChoreEntry) {
    if (entry.taskId === undefined) return;

    const confirmed = await confirmDelete({
      // Standard tier: one chore, nothing hangs off it, and the toast puts it
      // straight back (§4.5 clause 3).
      tier: "standard",
      recordName: entry.title,
      entity: "chore",
      // Nothing hangs off one chore. The template that made it is not a
      // dependent — it outlives the chore rather than being touched by it.
      dependents: [],
      ...(entry.templateId === undefined
        ? {}
        : {
            consequence:
              "The template that generated it stays, so it will be back on its next day. Turn the template off to stop it for good.",
          }),
    });
    if (!confirmed) return;

    const result = await tasks.remove(entry.taskId);
    if (!result.ok) {
      show({ message: "Could not delete that chore", tone: "danger" });
      return;
    }

    const taskId = entry.taskId;
    show({
      message: `${entry.title} deleted`,
      action: { label: "Undo", onAct: () => void tasks.restoreRecord(taskId) },
    });
  }

  const open = entries.filter((entry) => entry.completedAt === undefined);
  const done = entries.filter((entry) => entry.completedAt !== undefined);

  const card = (entry: ChoreEntry) => {
    const finished = entry.completedAt !== undefined;
    const where = [zoneName(entry.zoneId), animalName(entry.animalId)].filter(
      (label): label is string => label !== undefined,
    );

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
            {entry.carriedOver ? (
              <Pill tone="danger" dot>
                Owed from {dateLabel(entry.dueAt)}
              </Pill>
            ) : null}
            {entry.overdue && !entry.carriedOver ? <Pill tone="danger">Overdue</Pill> : null}
            {/*
              A due time worth saying is one finer than "the end of the day" —
              a feeding round, or a template that names a part of the day. The
              23rd hour is the end-of-day deadline every chore has anyway.
            */}
            {entry.carriedOver || entry.dueAt.getHours() === 23 ? null : (
              <Pill>By {timeLabel(entry.dueAt)}</Pill>
            )}
            {entry.templateId === undefined ? <Pill>One-off</Pill> : <Pill>Repeating</Pill>}
            {entry.taskId === undefined ? <Pill tone="neutral">Not started</Pill> : null}
            {where.map((label) => (
              <Pill key={label} tone="identity">
                {label}
              </Pill>
            ))}
            {finished ? <Pill tone="calm">Done {timeLabel(entry.completedAt as Date)}</Pill> : null}
          </>
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => startEdit(entry)}>
              {entry.taskId === undefined ? "Details" : "Edit"}
            </Button>
            {entry.taskId === undefined ? null : (
              <Button variant="ghost" onClick={() => void remove(entry)}>
                Delete
              </Button>
            )}
          </>
        }
      >
        {/*
          The target is the card's whole width and three lines tall. Gloves,
          a kiosk on a post, and rain: a 16px checkbox is not a thing anybody
          hits on the third try either.
        */}
        <Button
          variant={finished ? "secondary" : "primary"}
          block
          className="justify-center py-3 text-base"
          disabled={busy === entry.id}
          aria-pressed={finished}
          onClick={() => void toggle(entry)}
        >
          {finished ? "Undo" : "Mark done"}
        </Button>
      </RecordCard>
    );
  };

  return (
    <div className="flex flex-col gap-density">
      <Section
        title={`${dayName} — still to do`}
        description="Ticked off, a chore keeps the time and the name of whoever finished it."
        actions={
          <Button variant="primary" onClick={startCreate}>
            Add a chore
          </Button>
        }
      >
        {open.length === 0 ? (
          <EmptyState
            title={entries.length === 0 ? "Nothing on the list" : "All done"}
            detail={
              entries.length === 0
                ? "No template fires on this day and nobody wrote anything down. Add a chore, or set up a template that repeats."
                : "Everything asked for on this day is finished."
            }
            action={
              <Button variant="primary" onClick={startCreate}>
                Add a chore
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-density">{open.map(card)}</div>
        )}
      </Section>

      {done.length === 0 ? null : (
        <Section title="Done" description={`${done.length} finished on this day.`}>
          <div className="flex flex-col gap-density">{done.map(card)}</div>
        </Section>
      )}

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          title={editing === undefined ? "New chore" : editing.title}
          description={
            readOnly
              ? "This one comes from a template. Editing it here would change one day and leave every other day saying the old thing — so change the template instead, or tick it and edit the record it leaves."
              : "A one-off job for this day. Anything that repeats belongs in a template."
          }
          onClose={() => setDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <TextInput
              label="What needs doing"
              required
              value={draft.title}
              error={errors["title"]}
              disabled={readOnly}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
            <TextArea
              label="Detail"
              rows={3}
              hint="Anything a housesitter would need to know to do it right."
              value={draft.detail}
              disabled={readOnly}
              onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
            />
            <Select
              label="Zone"
              value={draft.zoneId}
              disabled={readOnly}
              options={[
                { value: "", label: "Anywhere on the place" },
                ...zones
                  .filter((zone) => zone.active)
                  .map((zone) => ({ value: zone.id, label: zone.name })),
              ]}
              onChange={(event) => setDraft({ ...draft, zoneId: event.target.value })}
            />
            <Select
              label="Animal"
              value={draft.animalId}
              disabled={readOnly}
              options={[
                { value: "", label: "Not about one animal" },
                ...animals
                  .filter((animal) => animal.status === "active")
                  .map((animal) => ({ value: animal.id, label: displayName(animal) })),
              ]}
              onChange={(event) => setDraft({ ...draft, animalId: event.target.value })}
            />

            <div className="flex gap-2">
              {readOnly ? (
                <Button onClick={() => setDraft(undefined)}>Close</Button>
              ) : (
                <>
                  <Button variant="primary" onClick={() => void save()}>
                    {editing === undefined ? "Add chore" : "Save changes"}
                  </Button>
                  <Button onClick={() => setDraft(undefined)}>Cancel</Button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
