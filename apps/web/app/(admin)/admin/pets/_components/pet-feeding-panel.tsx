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
  FEEDING_FREQUENCIES,
  TIMES_OF_DAY,
  animalsFedBy,
  displayName,
  feedingPlanSchema,
  isShared,
  portionOf,
  type Animal,
  type CrudError,
  type FeedingFrequency,
  type FeedingPlan,
  type FeedingPlanLine,
  type Portion,
  type TimeOfDay,
  type Ulid,
  type Unit,
} from "@galaxy-farm/core";
import { FEED_UNITS, type FeedType } from "@galaxy-farm/module-feed";

import { ListRow, RowList } from "@/app/(admin)/admin/horses/_components/list-row";
import { describePlanLine, nameList } from "@/lib/feed-lines";
import { plansFeeding } from "@/lib/pet-care";
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
 *
 * The editor is exported (`RationEditor`) so a pet's own page writes and
 * corrects its rations through the same form and checks as this tab.
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
  /** Everybody eating out of this, the one it is filed under first. */
  readonly fedIds: readonly string[];
  readonly name: string;
  readonly portion: Portion;
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

/**
 * Pet food first, then everything else.
 *
 * `pet` is a category in its own right (§5.3) so a bag of kibble does not
 * land in the cattle ration's totals — but a farm that has not catalogued one
 * yet should still be able to write the plan rather than be stopped by a
 * dropdown with nothing in it.
 */
export function petFeedCatalog(feeds: readonly FeedType[]): FeedType[] {
  return [...feeds]
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
}

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
  /** The editor: a plan to correct, or the pet a new one is for. */
  const [editor, setEditor] = useState<
    { readonly plan: FeedingPlan } | { readonly forPet: Ulid } | undefined
  >();

  const catalog = petFeedCatalog(feeds);

  const petName = (id: Ulid) => {
    const pet = pets.find((held) => held.id === id);
    return pet === undefined ? "a pet" : displayName(pet);
  };

  if (loading) return <p className="text-muted">Loading rations…</p>;

  return (
    <div className="flex flex-col gap-density">
      {/*
        One quiet line rather than a section: a ration names a feed from the
        catalog, and the kibble belongs under category 'pet' so it stays out
        of the cattle ration's totals.
      */}
      {catalog.length === 0 ? (
        <p className="text-sm text-danger">
          No feed in the catalog — add the kibble on the Feed screen, category &lsquo;pet&rsquo;.
        </p>
      ) : null}

      {/*
        Per pet, a heading and its rations as rows. A bowl two pets share is
        one ration and shows under both. Written in the units it is fed in,
        because that is what somebody follows at six in the morning.
      */}
      {pets.length === 0 ? (
        <EmptyState title="No pets yet" detail="Add a pet before writing what it eats." />
      ) : (
        pets.map((pet) => {
          const mine = plansFeeding(pet.id, plans);

          return (
            <section
              key={pet.id}
              aria-label={`${displayName(pet)}'s rations`}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {displayName(pet)}
                </h2>
                <Button
                  variant="ghost"
                  aria-haspopup="dialog"
                  onClick={() => setEditor({ forPet: pet.id })}
                  disabled={catalog.length === 0}
                  aria-label={`Add a ration for ${displayName(pet)}`}
                >
                  + Ration
                </Button>
              </div>
              {mine.length === 0 ? (
                // The guide will say so too, which is the same as telling a
                // helper to guess — so it is said in the action colour.
                <p className="text-sm text-action">Nothing written down.</p>
              ) : (
                <RationRows
                  label={`${displayName(pet)}'s rations`}
                  plans={mine}
                  feeds={feeds}
                  petName={petName}
                  onOpen={(plan) => setEditor({ plan })}
                />
              )}
            </section>
          );
        })
      )}

      {editor === undefined ? null : (
        <RationEditor
          key={"plan" in editor ? editor.plan.id : `new:${editor.forPet}`}
          pets={pets}
          feeds={feeds}
          plan={"plan" in editor ? editor.plan : undefined}
          forPet={"forPet" in editor ? editor.forPet : undefined}
          propertyId={propertyId}
          actorId={actorId}
          onClose={() => setEditor(undefined)}
        />
      )}
    </div>
  );
}

/** One pet's rations as rows, each opening its editor. */
export function RationRows({
  label,
  plans,
  feeds,
  petName,
  onOpen,
}: {
  readonly label: string;
  readonly plans: readonly FeedingPlan[];
  readonly feeds: readonly FeedType[];
  readonly petName: (id: Ulid) => string;
  readonly onOpen: (plan: FeedingPlan) => void;
}) {
  return (
    <RowList label={label}>
      {plans.map((plan) => (
        <ListRow
          key={plan.id}
          title={plan.name}
          line={[
            ...plan.lines.map((line: FeedingPlanLine) =>
              describePlanLine(
                line,
                feeds,
                isShared(plan) ? animalsFedBy(plan).map((held) => petName(held)) : [],
              ),
            ),
            plan.specialNotes,
          ]}
          chip={
            !plan.active ? (
              <Pill tone="neutral">Paused</Pill>
            ) : isShared(plan) ? (
              <Pill tone="action">Shared bowl</Pill>
            ) : undefined
          }
          label={`Edit ${plan.name}`}
          onOpen={() => onOpen(plan)}
        />
      ))}
    </RowList>
  );
}

function draftFor(
  plan: FeedingPlan | undefined,
  forPet: Ulid | undefined,
  name: string,
  firstFeed: string,
): Draft {
  if (plan !== undefined) {
    return {
      fedIds: animalsFedBy(plan),
      name: plan.name,
      portion: portionOf(plan),
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
    };
  }
  return {
    fedIds: forPet === undefined ? [] : [forPet],
    name,
    portion: "per_head",
    active: true,
    specialNotes: "",
    lines: [{ ...BLANK_LINE, feedTypeId: firstFeed }],
  };
}

/**
 * Writing a ration, or correcting, pausing or deleting one.
 *
 * `pets` is who may eat out of it — every pet on the list screen, so a shared
 * bowl can be ticked; a pet's own page passes the household too, for the same
 * reason.
 */
export function RationEditor({
  pets,
  feeds,
  plan: editing,
  forPet,
  propertyId,
  actorId,
  onClose,
}: {
  readonly pets: readonly Animal[];
  readonly feeds: readonly FeedType[];
  /** The ration to correct. Absent to write a new one for `forPet`. */
  readonly plan?: FeedingPlan | undefined;
  readonly forPet?: Ulid | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
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

  const catalog = petFeedCatalog(feeds);

  const petName = (id: Ulid) => {
    const pet = pets.find((held) => held.id === id);
    return pet === undefined ? "a pet" : displayName(pet);
  };

  const [draft, setDraft] = useState<Draft>(() =>
    draftFor(
      editing,
      forPet,
      forPet === undefined ? "" : `${petName(forPet)}'s ration`,
      catalog[0]?.id ?? "",
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function reportErrors(error: CrudError) {
    // §4.5 clause 2: on the field, not in a banner.
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { name: "Could not save. Check the fields and try again." },
    );
  }

  function fields(source: Draft) {
    const [first, ...rest] = source.fedIds;

    return {
      name: source.name.trim(),
      target: "animal" as const,
      // The first is arbitrary and the record says so: `animalsFedBy` puts it
      // back at the head of the list, and every read goes through that rather
      // than through `targetId`.
      targetId: (first ?? "") as Ulid,
      alsoFeeds: rest as Ulid[],
      // One pet cannot share a bowl with itself, so a single-pet ration is
      // always per-head whatever the toggle last said.
      portion: rest.length === 0 ? ("per_head" as const) : source.portion,
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
    setErrors({});

    if (draft.fedIds.length === 0) {
      setErrors({ targetId: "Tick at least one pet — a ration nobody eats is not a ration" });
      return;
    }

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
      onClose();
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
      consequence: `${nameList(animalsFedBy(plan).map((held) => petName(held)))} would have nothing written down, and the housesitter guide would say so.`,
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

  return (
    <Modal
      placement="side"
      title={
        editing === undefined
          ? `A ration for ${nameList(draft.fedIds.map((held) => petName(held as Ulid)))}`
          : `Editing ${editing.name}`
      }
      description="One line per feed and per time of day."
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {editing === undefined ? "Write it" : "Save changes"}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          {editing === undefined ? null : (
            <>
              {/* Pause in one tap, as the row used to offer — out of
                  season without losing it. */}
              <Button
                variant="ghost"
                onClick={() => {
                  onClose();
                  void toggleActive(editing);
                }}
              >
                {editing.active ? "Pause" : "Resume"}
              </Button>
              {/* The editor closes first, so the confirmation is the only
                  dialog on screen. */}
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  onClose();
                  void remove(editing);
                }}
              >
                Delete
              </Button>
            </>
          )}
        </>
      }
    >
      {catalog.length === 0 ? (
        <p className="text-sm text-danger">
          No feed in the catalog — add the kibble on the Feed screen, category &lsquo;pet&rsquo;.
        </p>
      ) : null}
      <div className="flex flex-col gap-density">
        <TextInput
          label="Name"
          required
          value={draft.name}
          error={errors["name"]}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-ink">Who eats this</legend>
          {/* One ration rather than two keeps the amount in one place, so
              correcting it corrects it for both. */}
          <p className="text-sm text-muted">More than one, when they share a bowl.</p>
          <div className="grid grid-cols-2 gap-x-density sm:grid-cols-3">
            {pets.map((pet) => (
              <Checkbox
                key={pet.id}
                label={displayName(pet)}
                checked={draft.fedIds.includes(pet.id)}
                onChange={() =>
                  setDraft({
                    ...draft,
                    // Order matters only in that the first is the one the
                    // record is filed under; keeping the list in the pets'
                    // own order stops the filing changing under a tick.
                    fedIds: draft.fedIds.includes(pet.id)
                      ? draft.fedIds.filter((held) => held !== pet.id)
                      : pets
                          .map((held) => held.id)
                          .filter((id) => id === pet.id || draft.fedIds.includes(id)),
                  })
                }
              />
            ))}
          </div>
          {errors["targetId"] === undefined ? null : (
            <p className="text-sm text-danger">{errors["targetId"]}</p>
          )}
          {errors["alsoFeeds"] === undefined ? null : (
            <p className="text-sm text-danger">{errors["alsoFeeds"]}</p>
          )}
        </fieldset>

        {draft.fedIds.length < 2 ? null : (
          <Select
            label="The amounts below are"
            // Read per head, a shared amount puts twice the food out and
            // runs the bag down twice as fast.
            hint="Two cats on one bowl is usually a combined amount."
            value={draft.portion}
            error={errors["portion"]}
            options={[
              { value: "shared", label: `Between all ${draft.fedIds.length} of them` },
              { value: "per_head", label: "What each of them gets" },
            ]}
            onChange={(event) => setDraft({ ...draft, portion: event.target.value as Portion })}
          />
        )}

        <fieldset className="flex flex-col gap-density">
          <legend className="text-sm font-medium text-ink">Lines</legend>
          {errors["lines"] === undefined ? null : (
            <p className="text-sm text-danger">{errors["lines"]}</p>
          )}

          {draft.lines.map((line, index) => {
            const update = (patch: Partial<LineDraft>) =>
              setDraft({
                ...draft,
                lines: draft.lines.map((held, at) => (at === index ? { ...held, ...patch } : held)),
              });

            return (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-density border border-edge p-3"
              >
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    label="Feed"
                    className="col-span-2"
                    value={line.feedTypeId}
                    options={catalog.map((feed) => ({
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
                      feedTypeId: draft.lines[0]?.feedTypeId ?? catalog[0]?.id ?? "",
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
          hint="Allergies, what they must not have."
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
  );
}
