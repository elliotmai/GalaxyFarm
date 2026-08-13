"use client";

import { useState } from "react";

import {
  Button,
  Card,
  CardGrid,
  Checkbox,
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
  FEEDING_FREQUENCIES,
  TIMES_OF_DAY,
  displayName,
  feedingPlanSchema,
  type Animal,
  type CrudError,
  type FeedingFrequency,
  type FeedingPlan,
  type FeedingPlanLine,
  type TimeOfDay,
  type Ulid,
  type Unit,
} from "@galaxy-farm/core";
import { FEED_UNITS, type FeedType } from "@galaxy-farm/module-feed";

import { describePlanLine } from "@/lib/pet-care";
import { useMutations } from "@/lib/local/mutations";

/**
 * What the pets eat (spec §5.8, §5.1).
 *
 * A real `FeedingPlan` rather than a sentence in the notes, because §5.8 says
 * so and because a ration written as prose cannot be totalled, cannot run out,
 * and cannot be corrected in one place when the vet changes it.
 *
 * The plan is animal-targeted: two dogs on the same food still eat different
 * amounts, and a group plan would make the guide say the same thing about both.
 */

const FREQUENCY_LABELS: Readonly<Record<FeedingFrequency, string>> = {
  once_daily: "Once a day",
  twice_daily: "Twice a day",
  three_times_daily: "Three times a day",
  every_other_day: "Every other day",
  weekly: "Once a week",
};

interface LineDraft {
  readonly feedTypeId: string;
  readonly amount: string;
  readonly unit: Unit;
  readonly frequency: FeedingFrequency;
  readonly timeOfDay: TimeOfDay;
  readonly notes: string;
}

interface Draft {
  readonly targetId: string;
  readonly name: string;
  readonly active: boolean;
  readonly specialNotes: string;
  readonly lines: readonly LineDraft[];
}

const BLANK_LINE: LineDraft = {
  feedTypeId: "",
  amount: "1",
  unit: "scoop",
  frequency: "twice_daily",
  timeOfDay: "morning",
  notes: "",
};

export function PetFeedingPanel({
  pets,
  plans,
  feeds,
  loading,
  propertyId,
  actorId,
}: {
  readonly pets: readonly Animal[];
  readonly plans: readonly FeedingPlan[];
  readonly feeds: readonly FeedType[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const mutations = useMutations<FeedingPlan>(
    "feedingPlans",
    "feedingPlans",
    feedingPlanSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [draft, setDraft] = useState<Draft | undefined>();
  const [editing, setEditing] = useState<FeedingPlan | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  /**
   * Pet food first, then everything else.
   *
   * `pet` is a category in its own right (§5.3) so a bag of kibble does not
   * land in the cattle ration's totals — but a farm that has not catalogued one
   * yet should still be able to write the plan rather than be stopped by a
   * dropdown with nothing in it.
   */
  const catalogue = [...feeds]
    .filter((feed) => feed.active)
    .sort((left, right) =>
      left.category === right.category
        ? left.name.localeCompare(right.name)
        : left.category === "pet"
          ? -1
          : right.category === "pet"
            ? 1
            : 0,
    );

  const petName = (id: Ulid) => {
    const pet = pets.find((held) => held.id === id);
    return pet === undefined ? "a pet" : displayName(pet);
  };

  function reportErrors(error: CrudError) {
    // §4.5 clause 2: on the field, not in a banner.
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { name: "Could not save. Check the fields and try again." },
    );
  }

  function startAdd(petId: string) {
    setEditing(undefined);
    setDraft({
      targetId: petId,
      name: `${petName(petId as Ulid)}'s ration`,
      active: true,
      specialNotes: "",
      lines: [{ ...BLANK_LINE, feedTypeId: catalogue[0]?.id ?? "" }],
    });
    setErrors({});
  }

  function startEdit(plan: FeedingPlan) {
    setEditing(plan);
    setDraft({
      targetId: plan.targetId,
      name: plan.name,
      active: plan.active,
      specialNotes: plan.specialNotes ?? "",
      lines: plan.lines.map((line) => ({
        feedTypeId: line.feedTypeId,
        amount: String(line.amount.amount),
        unit: line.amount.unit,
        frequency: line.frequency,
        timeOfDay: line.timeOfDay,
        notes: line.notes ?? "",
      })),
    });
    setErrors({});
  }

  function close() {
    setDraft(undefined);
    setEditing(undefined);
    setErrors({});
  }

  function fields(source: Draft) {
    return {
      name: source.name.trim(),
      target: "animal" as const,
      targetId: source.targetId as Ulid,
      active: source.active,
      specialNotes: source.specialNotes.trim() === "" ? undefined : source.specialNotes.trim(),
      lines: source.lines
        .filter((line) => line.feedTypeId !== "")
        .map((line) => ({
          feedTypeId: line.feedTypeId as Ulid,
          amount: { amount: Number(line.amount), unit: line.unit },
          frequency: line.frequency,
          timeOfDay: line.timeOfDay,
          notes: line.notes.trim() === "" ? undefined : line.notes.trim(),
        })),
    };
  }

  /**
   * The one thing the form has to catch itself.
   *
   * `dailyDemandOf` throws when a plan feeds one feed in two units, and the
   * throw would land on whichever screen read the plan back rather than on the
   * one that wrote it (§4.5 clause 2 — an invariant Zod cannot express).
   */
  function mixedUnits(lines: readonly LineDraft[]): string | undefined {
    const seen = new Map<string, Unit>();
    for (const line of lines) {
      if (line.feedTypeId === "") continue;
      const already = seen.get(line.feedTypeId);
      if (already !== undefined && already !== line.unit) {
        const name = feeds.find((feed) => feed.id === line.feedTypeId)?.name ?? "that feed";
        return `${name} is fed in ${already} on one line and ${line.unit} on another. Pick one.`;
      }
      seen.set(line.feedTypeId, line.unit);
    }
    return undefined;
  }

  async function save() {
    if (draft === undefined) return;
    setErrors({});

    const clash = mixedUnits(draft.lines);
    if (clash !== undefined) {
      setErrors({ lines: clash });
      return;
    }

    setBusy(true);
    try {
      const patch = fields(draft);
      const result =
        editing === undefined
          ? await mutations.create(patch as never)
          : await mutations.update(editing.id, patch as Partial<FeedingPlan>);

      if (!result.ok) {
        reportErrors(result.error);
        return;
      }

      show({ message: editing === undefined ? "Ration written" : "Ration saved", tone: "success" });
      close();
    } finally {
      setBusy(false);
    }
  }

  async function remove(plan: FeedingPlan) {
    const confirmed = await confirmDelete({
      // Standard tier: a plan, with nothing pointing at it. The pet stays.
      tier: "standard",
      recordName: plan.name,
      entity: "feeding plan",
      dependents: [],
      consequence: `${petName(plan.targetId)} would have nothing written down, and the housesitter guide would say so.`,
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await mutations.remove(plan.id);
    if (!result.ok) {
      show({ message: "Could not delete that plan", tone: "danger" });
      return;
    }

    show({
      message: "Ration deleted",
      action: { label: "Undo", onAct: () => void mutations.restoreRecord(plan.id) },
    });
  }

  async function toggleActive(plan: FeedingPlan) {
    const result = await mutations.update(plan.id, { active: !plan.active });
    if (!result.ok) {
      show({ message: "Could not change that plan", tone: "danger" });
      return;
    }
    show({ message: plan.active ? "Ration paused" : "Ration back on", tone: "success" });
  }

  if (loading) return <p className="text-muted">Loading rations…</p>;

  return (
    <div className="flex flex-col gap-density">
      {catalogue.length === 0 ? (
        <Section title="Nothing to feed" description="A ration names a feed from the catalogue.">
          <EmptyState
            title="No feed catalogued"
            detail="Add the kibble on the Feed inventory screen — category 'pet', so it stays out of the cattle ration's totals — and it will be offered here."
          />
        </Section>
      ) : null}

      <Section
        title="Rations"
        description="One plan per pet. Written in the units it is fed in, because that is what somebody follows at six in the morning."
      >
        {pets.length === 0 ? (
          <EmptyState title="No pets yet" detail="Add a pet before writing what it eats." />
        ) : (
          <CardGrid columns={2}>
            {pets.map((pet) => {
              const mine = plans.filter((plan) => plan.targetId === pet.id);

              return (
                <Card
                  key={pet.id}
                  title={displayName(pet)}
                  actions={
                    <Button onClick={() => startAdd(pet.id)} disabled={catalogue.length === 0}>
                      Add a ration
                    </Button>
                  }
                >
                  {mine.length === 0 ? (
                    <p className="text-sm text-muted">
                      Nothing written down. The guide will say so, which is the same as telling a
                      helper to guess.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-density">
                      {mine.map((plan) => (
                        <li key={plan.id} className="flex flex-col gap-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-density text-ink">{plan.name}</span>
                            {plan.active ? null : <Pill tone="neutral">paused</Pill>}
                          </span>
                          <ul className="flex flex-col gap-1 text-sm text-muted">
                            {plan.lines.map((line: FeedingPlanLine, index) => (
                              <li key={`${line.feedTypeId}-${index}`}>
                                {describePlanLine(line, feeds)}
                              </li>
                            ))}
                          </ul>
                          {plan.specialNotes === undefined ? null : (
                            <p className="text-sm text-muted">{plan.specialNotes}</p>
                          )}
                          <span className="flex gap-1">
                            <Button variant="ghost" onClick={() => startEdit(plan)}>
                              Edit
                            </Button>
                            <Button variant="ghost" onClick={() => void toggleActive(plan)}>
                              {plan.active ? "Pause" : "Resume"}
                            </Button>
                            <Button variant="ghost" onClick={() => void remove(plan)}>
                              Delete
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </CardGrid>
        )}
      </Section>

      {draft === undefined ? null : (
        <Modal
          size="wide"
          title={
            editing === undefined
              ? `A ration for ${petName(draft.targetId as Ulid)}`
              : `Editing ${editing.name}`
          }
          description="One line per feed and per time of day. A morning and an evening feed of the same food are two lines."
          onClose={close}
          footer={
            <div className="flex gap-2">
              <Button variant="primary" busy={busy} onClick={() => void save()}>
                {editing === undefined ? "Write it" : "Save changes"}
              </Button>
              <Button onClick={close}>Cancel</Button>
            </div>
          }
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <TextInput
                label="Name"
                required
                value={draft.name}
                error={errors["name"]}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <Select
                label="Pet"
                value={draft.targetId}
                error={errors["targetId"]}
                options={pets.map((pet) => ({ value: pet.id, label: displayName(pet) }))}
                onChange={(event) => setDraft({ ...draft, targetId: event.target.value })}
              />
            </div>

            <fieldset className="flex flex-col gap-density">
              <legend className="text-sm font-medium text-ink">Lines</legend>
              {errors["lines"] === undefined ? null : (
                <p className="text-sm text-danger">{errors["lines"]}</p>
              )}

              {draft.lines.map((line, index) => {
                const update = (patch: Partial<LineDraft>) =>
                  setDraft({
                    ...draft,
                    lines: draft.lines.map((held, at) =>
                      at === index ? { ...held, ...patch } : held,
                    ),
                  });

                return (
                  <div
                    key={index}
                    className="flex flex-col gap-2 rounded-density border border-edge p-3"
                  >
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <Select
                        label="Feed"
                        value={line.feedTypeId}
                        options={catalogue.map((feed) => ({
                          value: feed.id,
                          label: `${feed.name}${feed.category === "pet" ? "" : ` (${feed.category})`}`,
                        }))}
                        onChange={(event) => update({ feedTypeId: event.target.value })}
                      />
                      <TextInput
                        label="Amount"
                        type="number"
                        inputMode="decimal"
                        step="any"
                        numeric
                        value={line.amount}
                        onChange={(event) => update({ amount: event.target.value })}
                      />
                      <Select
                        label="Unit"
                        value={line.unit}
                        options={FEED_UNITS.map((unit) => ({
                          value: unit,
                          label: unit.replace(/_/g, " "),
                        }))}
                        onChange={(event) => update({ unit: event.target.value as Unit })}
                      />
                      <Select
                        label="How often"
                        value={line.frequency}
                        options={FEEDING_FREQUENCIES.map((frequency) => ({
                          value: frequency,
                          label: FREQUENCY_LABELS[frequency],
                        }))}
                        onChange={(event) =>
                          update({ frequency: event.target.value as FeedingFrequency })
                        }
                      />
                      <Select
                        label="When"
                        value={line.timeOfDay}
                        options={TIMES_OF_DAY.map((time) => ({ value: time, label: time }))}
                        onChange={(event) => update({ timeOfDay: event.target.value as TimeOfDay })}
                      />
                    </div>
                    <TextInput
                      label="Note"
                      hint="Mixed with the wet food, in the blue bowl."
                      value={line.notes}
                      onChange={(event) => update({ notes: event.target.value })}
                    />
                    {draft.lines.length === 1 ? null : (
                      <div>
                        <Button
                          variant="ghost"
                          type="button"
                          // crud-guard: allow-unconfirmed — a line out of an unsaved form
                          onClick={() =>
                            setDraft({
                              ...draft,
                              lines: draft.lines.filter((_, at) => at !== index),
                            })
                          }
                        >
                          Remove this line
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}

              <div>
                <Button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      lines: [
                        ...draft.lines,
                        {
                          ...BLANK_LINE,
                          feedTypeId: draft.lines[0]?.feedTypeId ?? catalogue[0]?.id ?? "",
                          timeOfDay: "evening",
                        },
                      ],
                    })
                  }
                >
                  Add a line
                </Button>
              </div>
            </fieldset>

            <TextArea
              label="Special notes"
              rows={2}
              hint="Anything a helper must know that is not an amount — allergies, what they must not have."
              value={draft.specialNotes}
              error={errors["specialNotes"]}
              onChange={(event) => setDraft({ ...draft, specialNotes: event.target.value })}
            />

            <Checkbox
              label="In use"
              hint="Turn it off out of season without losing it."
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
