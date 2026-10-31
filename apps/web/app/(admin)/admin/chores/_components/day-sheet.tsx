"use client";

import { useState } from "react";

import {
  Button,
  EmptyState,
  Modal,
  Pill,
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
 * The tick is the whole screen. Each chore is one row — a large round tick
 * the full height of the row on the left, the title and one line of facts,
 * and at most one chip — rather than a card with a button the width of it.
 * The tick stays big because the hand doing the ticking is in a glove and the
 * screen is often a kiosk on a post, and a row that is only tappable on a
 * 16px square is a row people stop ticking. The rest of the row opens the
 * chore, where editing and deleting now live.
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

  /** The one chip a row may carry: the most urgent thing true of it. */
  function chipFor(entry: ChoreEntry) {
    if (entry.completedAt !== undefined) {
      return <Pill tone="calm">Done {timeLabel(entry.completedAt)}</Pill>;
    }
    if (entry.carriedOver) {
      return (
        <Pill tone="danger" dot>
          Owed from {dateLabel(entry.dueAt)}
        </Pill>
      );
    }
    if (entry.overdue) return <Pill tone="danger">Overdue</Pill>;
    return null;
  }

  /** The muted line: when, where, who, and whether it repeats. */
  function lineFor(entry: ChoreEntry): string {
    return [
      // A due time worth saying is one finer than "the end of the day" — a
      // feeding round, or a template that names a part of the day. The 23rd
      // hour is the end-of-day deadline every chore has anyway.
      entry.carriedOver || entry.dueAt.getHours() === 23
        ? undefined
        : `By ${timeLabel(entry.dueAt)}`,
      zoneName(entry.zoneId),
      animalName(entry.animalId),
      entry.templateId === undefined ? "One-off" : "Repeating",
      entry.detail,
    ]
      .filter((part): part is string => part !== undefined && part !== "")
      .join(" · ");
  }

  const row = (entry: ChoreEntry) => {
    const finished = entry.completedAt !== undefined;

    return (
      <li key={entry.id} className="flex items-stretch bg-panel">
        {/*
          The tick: the row's full height and a wide column of its own.
          Gloves, a kiosk on a post, and rain — a 16px checkbox is not a thing
          anybody hits on the third try either.
        */}
        <button
          type="button"
          aria-pressed={finished}
          aria-label={finished ? `Undo ${entry.title}` : `Mark ${entry.title} done`}
          disabled={busy === entry.id}
          onClick={() => void toggle(entry)}
          className="flex w-16 shrink-0 items-center justify-center hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action disabled:opacity-60"
        >
          <span
            aria-hidden="true"
            className={[
              "flex h-9 w-9 items-center justify-center rounded-full border-2",
              finished
                ? "border-calm bg-calm text-panel"
                : entry.overdue
                  ? "border-danger text-danger"
                  : "border-edge text-transparent",
            ].join(" ")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12l5 5L20 7" />
            </svg>
          </span>
        </button>
        <button
          type="button"
          onClick={() => startEdit(entry)}
          className="flex min-h-[66px] min-w-0 flex-1 items-center gap-3 py-2 pr-4 text-left text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={`truncate font-semibold ${finished ? "text-muted line-through" : ""}`}>
              {entry.title}
            </span>
            <span className="truncate text-sm text-muted">{lineFor(entry)}</span>
          </span>
          {chipFor(entry)}
        </button>
      </li>
    );
  };

  const list = (items: readonly ChoreEntry[], label: string) => (
    <ul
      aria-label={label}
      className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
    >
      {items.map(row)}
    </ul>
  );

  return (
    // Bottom clearance on a phone, for the floating add button.
    <div className="flex flex-col gap-density pb-20 sm:pb-0">
      <Section
        title="Still to do"
        description="Ticked off, a chore keeps the time and the name of whoever finished it."
        actions={
          // Hidden on a phone by a wrapper: the button's own `inline-flex`
          // wins over a `hidden` passed in. The floating one stands in.
          <span className="hidden sm:block">
            <Button variant="primary" onClick={startCreate}>
              <span aria-hidden="true">+</span> Add chore
            </Button>
          </span>
        }
      >
        {open.length === 0 ? (
          <EmptyState
            title={entries.length === 0 ? "Nothing on the list" : "All done"}
            detail={
              entries.length === 0
                ? "No template fires on this day and nobody wrote anything down."
                : undefined
            }
            {...(entries.length === 0
              ? {
                  action: (
                    <Button variant="primary" onClick={startCreate}>
                      Add a chore
                    </Button>
                  ),
                }
              : {})}
          />
        ) : (
          list(open, `${dayName} — still to do`)
        )}
      </Section>

      {done.length === 0 ? null : (
        <Section title="Done" description={`${done.length} finished`}>
          {list(done, `${dayName} — done`)}
        </Section>
      )}

      <button
        type="button"
        onClick={startCreate}
        className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:hidden"
      >
        <span aria-hidden="true" className="text-xl leading-none">
          +
        </span>
        Add chore
      </button>

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          placement="side"
          title={editing === undefined ? "New chore" : editing.title}
          description={
            readOnly
              ? "From a template — change the template, or tick it and edit the record it leaves."
              : editing === undefined
                ? "A one-off for this day. Anything that repeats belongs in a template."
                : undefined
          }
          onClose={() => setDraft(undefined)}
          footer={
            readOnly ? (
              <Button onClick={() => setDraft(undefined)}>Close</Button>
            ) : (
              <>
                <Button variant="primary" onClick={() => void save()}>
                  {editing === undefined ? "Add chore" : "Save changes"}
                </Button>
                <Button onClick={() => setDraft(undefined)}>Cancel</Button>
                {editing?.taskId === undefined ? null : (
                  // Closed first, so the confirmation is the only dialog.
                  <Button
                    variant="danger"
                    className="ml-auto"
                    onClick={() => {
                      const entry = editing;
                      setDraft(undefined);
                      setEditing(undefined);
                      void remove(entry);
                    }}
                  >
                    Delete
                  </Button>
                )}
              </>
            )
          }
        >
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
            hint="What a housesitter would need to do it right."
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
        </Modal>
      )}
    </div>
  );
}
