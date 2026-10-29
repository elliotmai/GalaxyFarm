"use client";

import { useState } from "react";

import {
  Button,
  Checkbox,
  EmptyState,
  Modal,
  Pill,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import {
  CHORE_WEATHER,
  CHORE_WEATHER_LABELS,
  choreTemplateSchema,
  displayName,
  occurrencesInWindow,
  RECURRENCES,
  startOfDay,
  TIME_OF_DAY_LABELS,
  TIMES_OF_DAY,
  type Animal,
  type ChoreTemplate,
  type ChoreWeather,
  type Recurrence,
  type TimeOfDay,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";

import {
  describeRecurrence,
  describeTimeOfDay,
  GENERATING_RECURRENCES,
  parseMonthDays,
  WEEKDAY_NAMES,
} from "@/lib/chores";
import { useMutations } from "@/lib/local/mutations";

/**
 * The standing arrangement — chores that come round on their own (spec §5.1).
 *
 * A template is not a chore. It is the reason a chore appears, which is why
 * turning one off is the honest way to stop a repeating job and deleting one
 * is not: the deletion takes the arrangement away, and every chore it already
 * generated stays exactly where it was, done or not.
 *
 * Only three recurrences actually generate a day's work. `once` and
 * `seasonal` are in the enum for the calendar and the weather service to grow
 * into, and a template set to either quietly produces nothing — so the form
 * offers them only when a record already carries one, and the list says so
 * out loud.
 */

const RECURRENCE_LABELS: Readonly<Record<Recurrence, string>> = {
  daily: "Every day",
  weekly: "Certain days of the week",
  monthly: "Certain days of the month",
  once: "One-off — generates nothing",
  seasonal: "Seasonal — generates nothing yet",
};

interface Draft {
  readonly title: string;
  readonly detail: string;
  readonly recurrence: Recurrence;
  readonly weekdays: readonly number[];
  readonly monthDays: string;
  /** `""` means the whole day, the same as the field being absent. */
  readonly timeOfDay: string;
  /** `""` means any weather — the recurrence alone decides. */
  readonly weather: string;
  readonly zoneId: string;
  readonly animalId: string;
  readonly active: boolean;
}

const BLANK: Draft = {
  title: "",
  detail: "",
  recurrence: "daily",
  weekdays: [],
  monthDays: "",
  timeOfDay: "",
  weather: "",
  zoneId: "",
  animalId: "",
  active: true,
};

export function TemplatesPanel({
  templates,
  zones,
  animals,
  propertyId,
  actorId,
}: {
  readonly templates: readonly ChoreTemplate[];
  readonly zones: readonly Zone[];
  readonly animals: readonly Animal[];
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<ChoreTemplate>(
    "choreTemplates",
    "choreTemplates",
    choreTemplateSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editing, setEditing] = useState<ChoreTemplate | undefined>();
  const [draft, setDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function startCreate() {
    setEditing(undefined);
    setDraft(BLANK);
    setErrors({});
  }

  function startEdit(template: ChoreTemplate) {
    setEditing(template);
    setDraft({
      title: template.title,
      detail: template.detail ?? "",
      recurrence: template.recurrence,
      weekdays: template.recurrence === "weekly" ? template.recurrenceDays : [],
      monthDays: template.recurrence === "monthly" ? template.recurrenceDays.join(", ") : "",
      timeOfDay: template.timeOfDay ?? "",
      weather: template.weather ?? "",
      zoneId: template.zoneId ?? "",
      animalId: template.animalId ?? "",
      active: template.active,
    });
    setErrors({});
  }

  /**
   * The days the draft rule fires on, as the record will store them.
   *
   * Computed once and used both by the sentence under the form and by the
   * save, so what somebody reads before saving is what gets saved.
   */
  const draftDays =
    draft === undefined
      ? []
      : draft.recurrence === "weekly"
        ? [...draft.weekdays].sort((left, right) => left - right)
        : draft.recurrence === "monthly"
          ? parseMonthDays(draft.monthDays)
          : [];

  async function save() {
    if (draft === undefined) return;

    const fields = {
      title: draft.title.trim(),
      recurrence: draft.recurrence,
      recurrenceDays: draftDays,
      active: draft.active,
      // Explicit rather than omitted when blank, so editing a template back
      // to "any time" actually clears the field in the patch that travels.
      timeOfDay: draft.timeOfDay === "" ? undefined : (draft.timeOfDay as TimeOfDay),
      // The same: editing back to "any weather" has to clear it.
      weather: draft.weather === "" ? undefined : (draft.weather as ChoreWeather),
      ...(draft.detail.trim() === "" ? {} : { detail: draft.detail.trim() }),
      ...(draft.zoneId === "" ? {} : { zoneId: draft.zoneId as Ulid }),
      ...(draft.animalId === "" ? {} : { animalId: draft.animalId as Ulid }),
    };

    const result =
      editing === undefined ? await api.create(fields) : await api.update(editing.id, fields);

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

    show({ message: editing === undefined ? "Template added" : "Template saved", tone: "success" });
    setDraft(undefined);
    setEditing(undefined);
  }

  async function remove(template: ChoreTemplate) {
    const confirmed = await confirmDelete({
      // Elevated: the chores it already generated are records with times and
      // names on them, and the dialog has to say they survive. Somebody who
      // means "stop this repeating" wants the switch below, not this.
      tier: "elevated",
      recordName: template.title,
      entity: "chore template",
      dependents: [
        {
          entity: "Chore",
          label: "Every chore it has already generated",
          effect: "detached",
        },
      ],
      consequence:
        "Those stay on the days they were done. To stop it repeating without deleting the history, switch it off instead.",
    });
    if (!confirmed) return;

    const result = await api.remove(template.id);
    if (!result.ok) {
      show({ message: "Could not delete that template", tone: "danger" });
      return;
    }

    show({
      message: `${template.title} deleted`,
      action: { label: "Undo", onAct: () => void api.restoreRecord(template.id) },
    });
  }

  const today = startOfDay(new Date());

  /** The muted line: when it comes round, where, and what that means in practice. */
  function lineFor(template: ChoreTemplate): string {
    const animal = animals.find((candidate) => candidate.id === template.animalId);
    return [
      describeRecurrence(template),
      template.timeOfDay === undefined ? undefined : TIME_OF_DAY_LABELS[template.timeOfDay],
      zones.find((zone) => zone.id === template.zoneId)?.name,
      animal === undefined ? undefined : displayName(animal),
      // What the rule means in practice, which is easier to check than the
      // rule that produced it. A weather template's count depends on a
      // forecast nobody has yet, so it says what it waits for instead.
      template.weather === undefined
        ? `${occurrencesInWindow(template, today, 14).length} in the next fortnight`
        : `Only ${CHORE_WEATHER_LABELS[template.weather].toLowerCase()}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(" · ");
  }

  /** One chip, by exception: switched off, or a rule that never fires. */
  function chipFor(template: ChoreTemplate) {
    if (!template.active) return <Pill>Switched off</Pill>;
    if (!GENERATING_RECURRENCES.includes(template.recurrence)) {
      return <Pill tone="danger">Never fires</Pill>;
    }
    return null;
  }

  const recurrenceOptions = RECURRENCES.filter(
    (recurrence) => GENERATING_RECURRENCES.includes(recurrence) || recurrence === draft?.recurrence,
  ).map((recurrence) => ({ value: recurrence, label: RECURRENCE_LABELS[recurrence] }));

  return (
    <div className="flex flex-col gap-density">
      {/* Templates are the reason a chore turns up; switching one off stops
          it repeating and keeps every chore it already produced. */}
      <div className="flex justify-end">
        <Button variant="primary" onClick={startCreate}>
          <span aria-hidden="true">+</span> Add template
        </Button>
      </div>

      {draft === undefined ? null : (
        <Modal
          key={editing?.id ?? "new"}
          placement="side"
          title={editing === undefined ? "New template" : `Editing ${editing.title}`}
          description="A job that comes round on its own."
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <Button variant="primary" onClick={() => void save()}>
                {editing === undefined ? "Add template" : "Save changes"}
              </Button>
              <Button onClick={() => setDraft(undefined)}>Cancel</Button>
              {editing === undefined ? null : (
                // Closed first, so the confirmation is the only dialog.
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    const template = editing;
                    setDraft(undefined);
                    setEditing(undefined);
                    void remove(template);
                  }}
                >
                  Delete
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-density">
            <TextInput
              label="What needs doing"
              required
              value={draft.title}
              error={errors["title"]}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
            <TextArea
              label="Detail"
              rows={3}
              hint="What a housesitter would need to do it right."
              value={draft.detail}
              onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
            />

            <Select
              label="How often"
              options={recurrenceOptions}
              value={draft.recurrence}
              error={errors["recurrence"]}
              hint="A one-off is a chore — add it on the day it belongs to."
              onChange={(event) =>
                setDraft({ ...draft, recurrence: event.target.value as Recurrence })
              }
            />

            {draft.recurrence === "weekly" ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="text-density font-medium text-ink">Which days</legend>
                {errors["recurrenceDays"] === undefined ? null : (
                  <p className="text-sm text-danger">{errors["recurrenceDays"]}</p>
                )}
                {WEEKDAY_NAMES.map((label, day) => (
                  <Checkbox
                    key={label}
                    label={label}
                    checked={draft.weekdays.includes(day)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        weekdays: event.target.checked
                          ? [...draft.weekdays, day]
                          : draft.weekdays.filter((chosen) => chosen !== day),
                      })
                    }
                  />
                ))}
              </fieldset>
            ) : null}

            {/*
              What the rule as typed actually means, before it is saved. A
              weekly template with no weekday ticked saves happily and then
              produces nothing, which reads as the feature being broken rather
              than the rule being half-written.
            */}
            <p className="text-sm text-muted">
              {describeRecurrence({ recurrence: draft.recurrence, recurrenceDays: draftDays })}.
            </p>

            {draft.recurrence === "monthly" ? (
              <TextInput
                label="Which days of the month"
                value={draft.monthDays}
                placeholder="1, 15"
                hint="1 to 31, comma separated. A short month skips the day."
                error={errors["recurrenceDays"]}
                onChange={(event) => setDraft({ ...draft, monthDays: event.target.value })}
              />
            ) : null}

            <Select
              label="Time of day"
              value={draft.timeOfDay}
              error={errors["timeOfDay"]}
              hint="Named, it counts late once that part of the day has passed."
              options={[
                { value: "", label: "Any time — due by the end of the day" },
                ...TIMES_OF_DAY.map((timeOfDay) => ({
                  value: timeOfDay,
                  label: describeTimeOfDay(timeOfDay),
                })),
              ]}
              onChange={(event) => setDraft({ ...draft, timeOfDay: event.target.value })}
            />

            <Select
              label="Only when"
              value={draft.weather}
              error={errors["weather"]}
              hint="Waits for the forecast — covers before a freeze, not every night."
              options={[
                { value: "", label: "Any weather" },
                ...CHORE_WEATHER.map((weather) => ({
                  value: weather,
                  label: CHORE_WEATHER_LABELS[weather],
                })),
              ]}
              onChange={(event) => setDraft({ ...draft, weather: event.target.value })}
            />

            <Select
              label="Zone"
              value={draft.zoneId}
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
              options={[
                { value: "", label: "Not about one animal" },
                ...animals
                  .filter((animal) => animal.status === "active")
                  .map((animal) => ({ value: animal.id, label: displayName(animal) })),
              ]}
              onChange={(event) => setDraft({ ...draft, animalId: event.target.value })}
            />

            <Checkbox
              label="Running"
              hint="Off stops new chores and keeps the ones it made."
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
            />
          </div>
        </Modal>
      )}

      {templates.length === 0 ? (
        <EmptyState
          title="No templates yet"
          detail="Feeding, water checks, cleaning a coop — anything that comes round on its own."
          action={
            <Button variant="primary" onClick={startCreate}>
              Add the first template
            </Button>
          }
        />
      ) : (
        <ul
          aria-label="Chore templates"
          className="flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel"
        >
          {templates.map((template) => (
            <li key={template.id} className="flex items-center bg-panel">
              {/* The row opens the editor, where delete is. */}
              <button
                type="button"
                onClick={() => startEdit(template)}
                className="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-2 text-left hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-action"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={`truncate font-semibold ${template.active ? "text-ink" : "text-muted"}`}
                  >
                    {template.title}
                  </span>
                  <span className="truncate text-sm text-muted">{lineFor(template)}</span>
                </span>
                {chipFor(template)}
              </button>
              {/* Switching is the everyday change — "not while it's raining"
                  — so it stays one tap from the list, beside the row. */}
              <Button
                variant="ghost"
                className="mr-1 shrink-0"
                aria-label={`${template.active ? "Switch off" : "Switch on"} ${template.title}`}
                onClick={() => void api.update(template.id, { active: !template.active })}
              >
                {template.active ? "Switch off" : "Switch on"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
