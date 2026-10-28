"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import {
  Button,
  EmptyState,
  PageBody,
  Modal,
  Pill,
  Section,
  Select,
  TextInput,
  useConfirmDelete,
  useToast,
} from "@galaxy-farm/ui";
import {
  displayName,
  isShared,
  openAssignments,
  portionOf,
  FEEDING_FREQUENCIES,
  feedingPlanSchema,
  TIMES_OF_DAY,
  type Animal,
  type FeedingFrequency,
  type FeedingPlan,
  type FeedingPlanLine,
  type Portion,
  type TimeOfDay,
  type Ulid,
  type Unit,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import { penAssignments } from "@galaxy-farm/module-pets";
import {
  describeGrain,
  herdDemand,
  FEED_CATEGORIES,
  FEED_UNITS,
  feedTypeSchema,
  isGrainMeasure,
  measureToPounds,
  poundsOf,
  type FeedCategory,
  type FeedType,
  type FeedUnit,
} from "@galaxy-farm/module-feed";

import {
  AddFab,
  Chip,
  ChipRow,
  facts,
  Row,
  Rows,
  ScreenHeader,
} from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import { animalHref } from "@/lib/animal-slug";
import { describeLine, mixedUnitFeed } from "@/lib/feed-lines";
import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * What the cattle get fed (spec §5.1, §5.3, issue #18).
 *
 * One plan model for all three scopes — an animal, a zone, or the group —
 * because §5.1 makes a per-cow mixture "an animal-targeted plan that
 * overrides/extends the group plan". Three tables would need the override rule
 * written three times and §5.3's daily-demand sum would have to union them.
 *
 * The demand figure is **per feed type, never summed across them**. A plan
 * feeding twelve pounds of grain and half a round bale of hay has no
 * meaningful total, and inventing one would produce a number that looks right
 * and is not.
 */

/**
 * The plan writes and the two that need saying out loud — switching a plan
 * off, and deleting one behind its confirmation.
 *
 * A hook so Farm › Feed › Plan opens the same editor against the same write
 * path rather than a second copy of the delete rule.
 */
export function usePlanActions(propertyId: Ulid, actorId: Ulid) {
  const api = useMutations<FeedingPlan>(
    "feedingPlans",
    "feedingPlans",
    feedingPlanSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  async function toggle(plan: FeedingPlan) {
    await api.update(plan.id, { active: !plan.active } as Partial<FeedingPlan>);
    show({
      message: plan.active ? `${plan.name} switched off` : `${plan.name} switched on`,
      tone: plan.active ? "warning" : "success",
    });
  }

  async function remove(plan: FeedingPlan) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: plan.name,
      entity: "feeding plan",
      dependents: [
        {
          entity: "Daily demand",
          label: "for the feed it names",
          effect: "deleted" as const,
        },
      ],
      // Switching off is nearly always what somebody means out of season, and
      // it keeps the plan for next year.
      consequence: "To stop feeding it for a season, switch it off instead — that keeps the plan.",
      action: "Delete",
    });
    if (!confirmed) return;

    await api.remove(plan.id, "Removed from the feeding plans");
    show({ message: "Plan deleted", tone: "danger" });
  }

  return { api, toggle, remove };
}

export function CattleFeedScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: zones } = useRecords<Zone>("zones", query);
  const { records: feeds } = useRecords<FeedType>("feedTypes", query);
  const { records: plans, loading } = useRecords<FeedingPlan>("feedingPlans", query);
  const { records: assignments } = useRecords<ZoneAssignment>("zoneAssignments", query);

  const { api: plansApi, toggle, remove } = usePlanActions(propertyId, actorId);

  /**
   * Held by id rather than as the record itself.
   *
   * The list is a live query — a sync pull mid-edit replaces every object in
   * it — and a form holding the old object would go on showing values the
   * store no longer has.
   */
  const [editing, setEditing] = useState<Ulid | "new" | undefined>();
  const editingPlan = plans.find((plan) => plan.id === editing);

  const [editingFeedId, setEditingFeed] = useState<Ulid | "new" | undefined>();
  const editingFeed = feeds.find((feed) => feed.id === editingFeedId);

  const [view, setView] = useState<"plans" | "demand" | "catalog">("plans");

  const feedById = useMemo(() => new Map(feeds.map((feed) => [feed.id, feed])), [feeds]);
  const animalById = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);

  /**
   * Daily demand across the herd, per feed type.
   *
   * Summed per type rather than overall, for the reason above — and only over
   * active plans, because a plan switched off out of season is not feed
   * anybody is putting out.
   *
   * Worked out by `herdDemand` rather than here, so this screen and the feed
   * inventory give the same answer. Two things it does that summing the plans
   * did not: it counts heads, so a group plan feeding forty is forty rations
   * rather than one, and it restates each ration in the unit its feed is
   * counted in, so a plan written in scoops does not read as bags.
   */
  const animalScopes = useMemo(() => {
    // Pets bring no pens (§5.8), so a placement naming one — the property map
    // used to let somebody drag the dog onto a pasture — cannot put him on
    // that pen's ration and add a dog's worth of cubes to the herd's demand.
    const placements = penAssignments(assignments, animals);
    return animals
      .filter((animal) => animal.status === "active")
      .map((animal) => ({
        id: animal.id,
        zoneIds: openAssignments(placements, animal.id).map((entry) => entry.zoneId),
      }));
  }, [animals, assignments]);

  const herd = useMemo(
    () =>
      herdDemand({
        plans: plans.filter((plan) => plan.active),
        feeds,
        animals: animalScopes,
        propertyId,
      }),
    [plans, feeds, animalScopes, propertyId],
  );

  const demand = useMemo(
    () =>
      [...herd.perDay.entries()]
        .map(([feedTypeId, amount]) => ({ feed: feedById.get(feedTypeId), amount }))
        .filter((entry): entry is { feed: FeedType; amount: number } => entry.feed !== undefined),
    [herd, feedById],
  );

  function describeTarget(plan: FeedingPlan): string {
    if (plan.target === "animal") {
      const animal = animalById.get(plan.targetId);
      return animal === undefined ? "an animal" : displayName(animal);
    }
    if (plan.target === "zone") {
      return zoneById.get(plan.targetId)?.name ?? "a zone";
    }
    return "the group";
  }

  const active = plans.filter((plan) => plan.active);
  const nameOfFeed = (id: Ulid) => feedById.get(id)?.name ?? "feed";

  const addButton =
    view === "catalog" ? (
      <Button variant="primary" aria-haspopup="dialog" onClick={() => setEditingFeed("new")}>
        <span aria-hidden="true">+</span> Add feed
      </Button>
    ) : (
      <Button variant="primary" aria-haspopup="dialog" onClick={() => setEditing("new")}>
        <span aria-hidden="true">+</span> Add plan
      </Button>
    );

  return (
    <PageBody>
      {/* Bottom clearance on a phone, so the floating button never covers a row. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <ScreenHeader
          title="Feed plans"
          facts={facts(
            `${active.length} feeding`,
            plans.length > active.length && `${plans.length - active.length} off`,
          )}
          action={<span className="hidden sm:block">{addButton}</span>}
        />

        {/*
          One line, and the feeds it names are the way to fix it. A ration
          written in one unit for a feed counted in another cannot be turned
          into the barn's numbers until somebody says what one weighs — so it
          is left out of the daily demand rather than counted wrongly.
        */}
        {herd.unconvertible.length === 0 ? null : (
          <p role="status" className="text-sm text-danger">
            {herd.unconvertible.length} ration{herd.unconvertible.length === 1 ? " is" : "s are"}{" "}
            left out of the daily demand — give{" "}
            {herd.unconvertible.map((feedTypeId, index) => (
              <span key={feedTypeId}>
                {index === 0 ? "" : ", "}
                {/* A feed that has gone from the catalog has nothing to open. */}
                {feedById.has(feedTypeId) ? (
                  <button
                    type="button"
                    onClick={() => setEditingFeed(feedTypeId)}
                    className="inline-flex min-h-target items-center font-semibold underline underline-offset-2"
                  >
                    {nameOfFeed(feedTypeId)}
                  </button>
                ) : (
                  "a feed"
                )}
              </span>
            ))}{" "}
            its lb each.
          </p>
        )}

        {/* Three real views of one subject: who gets what, what that adds up
            to in a day, and the feeds the plans can name. */}
        <ChipRow label="View">
          <Chip on={view === "plans"} onClick={() => setView("plans")}>
            Plans
            <span className="gf-numeric text-xs opacity-80">{plans.length}</span>
          </Chip>
          <Chip on={view === "demand"} onClick={() => setView("demand")}>
            Per day
          </Chip>
          <Chip on={view === "catalog"} onClick={() => setView("catalog")}>
            Feed catalog
            <span className="gf-numeric text-xs opacity-80">{feeds.length}</span>
          </Chip>
        </ChipRow>

        {/* Every species' rations, the shed and today's feedings live on
            Farm › Feed; this screen stays the cattle view of the same plans. */}
        <Link
          href="/admin/feed?view=plan"
          className="inline-flex min-h-target items-center self-start text-sm font-medium text-action underline-offset-2 hover:underline"
        >
          All species: Farm › Feed › Plan
        </Link>

        {view === "plans" ? (
          loading ? (
            <p className="text-muted">Looking…</p>
          ) : plans.length === 0 ? (
            <EmptyState
              title="Nothing planned"
              detail="A group plan covers the herd; an animal plan overrides it for one cow."
              action={
                <Button variant="primary" onClick={() => setEditing("new")}>
                  Add a plan
                </Button>
              }
            />
          ) : (
            <Rows label="Feeding plans">
              {plans.map((plan) => (
                <Row
                  key={plan.id}
                  title={plan.name}
                  onSelect={() => setEditing(plan.id)}
                  selectLabel={`Edit ${plan.name}`}
                  line={facts(
                    describeTarget(plan),
                    isShared(plan) && "shared, not per head",
                    plan.specialNotes,
                  )}
                  notes={plan.lines
                    .map(
                      (line) =>
                        `${line.amount.amount} ${line.amount.unit} ${nameOfFeed(line.feedTypeId)}, ${line.frequency.replace(/_/g, " ")}`,
                    )
                    .join(" · ")}
                  chip={
                    plan.active ? (
                      <Pill tone="calm" dot>
                        Feeding
                      </Pill>
                    ) : (
                      <Pill tone="neutral">Off</Pill>
                    )
                  }
                />
              ))}
            </Rows>
          )
        ) : view === "demand" ? (
          <Section
            title="Daily demand"
            description="Per feed type. A plan feeding grain and hay has no meaningful total, so none is shown."
          >
            {demand.length === 0 ? (
              <p className="text-sm text-muted">No active plan names a feed yet.</p>
            ) : (
              <Rows label="Daily demand">
                {demand.map((entry) => {
                  const pounds = poundsOf(entry.feed, entry.amount);
                  return (
                    <Row
                      key={entry.feed.id}
                      title={entry.feed.name}
                      line={facts(
                        entry.feed.category,
                        pounds !== undefined && `about ${Math.round(pounds)} lb`,
                        // Said in vessels as well, because "213 lb" is not
                        // something anybody can carry to the feed shed.
                        pounds !== undefined &&
                          isGrainMeasure(entry.feed.unit) &&
                          describeGrain(pounds),
                      )}
                      chip={
                        <span className="gf-numeric font-semibold text-ink">
                          {Number(entry.amount.toFixed(1))} {entry.feed.unit.replace(/_/g, " ")}/day
                        </span>
                      }
                    />
                  );
                })}
              </Rows>
            )}
          </Section>
        ) : (
          <Section
            title="Feed catalog"
            description="What a plan's lines can name. Cross-species — the same bale feeds cattle and the same scratch feeds chickens."
          >
            {feeds.length === 0 ? (
              <EmptyState
                title="Nothing in the catalog"
                detail="Add a feed and plans can start naming it."
                action={
                  <Button variant="primary" onClick={() => setEditingFeed("new")}>
                    Add a feed
                  </Button>
                }
              />
            ) : (
              <Rows label="Feeds">
                {feeds.map((feed) => (
                  <Row
                    key={feed.id}
                    title={feed.name}
                    onSelect={() => setEditingFeed(feed.id)}
                    selectLabel={`Edit ${feed.name}`}
                    line={facts(
                      feed.category,
                      `by the ${feed.unit.replace(/_/g, " ")}`,
                      feed.estWeightLbPerUnit !== undefined && `${feed.estWeightLbPerUnit} lb each`,
                    )}
                    chip={feed.active ? undefined : <Pill tone="neutral">Not stocked</Pill>}
                  />
                ))}
              </Rows>
            )}
          </Section>
        )}

        {view === "catalog" ? (
          <AddFab onClick={() => setEditingFeed("new")}>Add feed</AddFab>
        ) : (
          <AddFab onClick={() => setEditing("new")}>Add plan</AddFab>
        )}

        {editingFeedId === undefined ? null : (
          <FeedTypeForm
            key={editingFeed?.id ?? "new"}
            feed={editingFeed}
            propertyId={propertyId}
            actorId={actorId}
            onClose={() => setEditingFeed(undefined)}
          />
        )}

        {editing === undefined || (editing !== "new" && editingPlan === undefined) ? null : (
          // Keyed on the plan, so opening a different one starts from its own
          // values rather than from whichever was opened first.
          <PlanForm
            key={editingPlan?.id ?? "new"}
            plan={editingPlan}
            animals={animals}
            zones={zones}
            feeds={feeds}
            api={plansApi}
            propertyId={propertyId}
            onClose={() => setEditing(undefined)}
            onToggle={(plan) => void toggle(plan)}
            onDelete={(plan) => {
              // The panel closes first, so the confirmation is the only dialog
              // on screen rather than a second one stacked on this.
              setEditing(undefined);
              void remove(plan);
            }}
          />
        )}
      </div>
    </PageBody>
  );
}

/**
 * A feed in the catalog, added or corrected.
 *
 * Correcting matters more than it looks. Every plan line points at one of
 * these by id, so a feed that could only be created and deleted would leave
 * somebody deleting one to fix a typo and taking every ration that named it
 * with them. And `lb each` is the figure that turns "three scoops" into
 * pounds — it is the number most likely to be wrong at first and most worth
 * being able to put right.
 */
export function FeedTypeForm({
  feed,
  propertyId,
  actorId,
  onClose,
}: {
  readonly feed?: FeedType | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onClose: () => void;
}) {
  const api = useMutations<FeedType>("feedTypes", "feedTypes", feedTypeSchema, propertyId, actorId);
  const { show } = useToast();
  const formId = useId();
  const editing = feed !== undefined;

  const [name, setName] = useState(feed?.name ?? "");
  const [category, setCategory] = useState<FeedCategory>(feed?.category ?? "hay");
  const [unit, setUnit] = useState<FeedUnit>(feed?.unit ?? "round_bale");
  const [weight, setWeight] = useState(
    feed?.estWeightLbPerUnit === undefined ? "" : String(feed.estWeightLbPerUnit),
  );
  const [busy, setBusy] = useState(false);

  /** What the vessel holds when nobody has said, so the hint is not a guess. */
  const standard = measureToPounds(1, unit);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const fields = {
        name: name.trim(),
        category,
        unit,
        // Cleared rather than left behind when the box is emptied: a weight
        // held over from a different unit is worse than none.
        estWeightLbPerUnit: weight === "" ? undefined : Number(weight),
      };

      const result = editing
        ? await api.update(feed.id, fields as Partial<FeedType>)
        : await api.create({ ...fields, reorderLeadDays: 7, active: true } as never);
      if (!result.ok) return;

      show({ message: editing ? "Feed updated" : "Added to the catalog", tone: "success" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      placement="side"
      title={editing ? `Edit ${feed.name}` : "Add a feed"}
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" type="submit" form={formId} busy={busy}>
            {editing ? "Save changes" : "Add feed"}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-density"
      >
        <TextInput
          label="Feed"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <Select
          label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value as FeedCategory)}
          options={FEED_CATEGORIES.map((value) => ({ value, label: value }))}
        />
        <Select
          label="Sold by the"
          value={unit}
          onChange={(event) => setUnit(event.target.value as FeedUnit)}
          options={FEED_UNITS.map((value) => ({ value, label: value.replace(/_/g, " ") }))}
        />
        {/* The figure that turns a ration into pounds — the one most likely to
            be wrong at first, so the hint says what blank means. */}
        <TextInput
          label="lb each"
          hint={
            standard === undefined
              ? "A round bale is 800 to 1,400."
              : `Blank means ${standard === 1 ? "a pound" : `${Number(standard.toFixed(2))} lb`}, a standard ${unit}.`
          }
          type="number"
          inputMode="decimal"
          step="any"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
        />
      </form>
    </Modal>
  );
}

/**
 * One line of a plan, as the form holds it.
 *
 * The unit is on the line rather than taken from the feed, because they are
 * genuinely different questions. Cubes are *bought* by the bag and *fed* by
 * the scoop, and a form that reads the unit off the catalog makes somebody
 * write "0.15 bags" twice a day.
 */
interface LineDraft {
  readonly key: string;
  readonly feedId: string;
  readonly amount: string;
  readonly unit: Unit;
  readonly frequency: FeedingFrequency;
  readonly timeOfDay: TimeOfDay;
}

let lineSequence = 0;
const blankLine = (): LineDraft => ({
  key: `line-${lineSequence++}`,
  feedId: "",
  amount: "",
  unit: "lb",
  frequency: "twice_daily",
  timeOfDay: "morning",
});

const draftFrom = (plan: FeedingPlan): LineDraft[] =>
  plan.lines.map((line) => ({
    key: `line-${lineSequence++}`,
    feedId: line.feedTypeId,
    amount: String(line.amount.amount),
    unit: line.amount.unit,
    frequency: line.frequency,
    timeOfDay: line.timeOfDay,
  }));

/**
 * Write a plan, or change one that exists.
 *
 * One form for both, because a plan that can only be created is a plan that
 * gets deleted and retyped the first time a ration changes — and the deletion
 * takes the history of what was being fed with it. §4.5 clause 1 asks for the
 * full four operations on everything, and this is the U.
 */
export function PlanForm({
  plan,
  animals,
  zones,
  feeds,
  api,
  propertyId,
  onClose,
  onToggle,
  onDelete,
  anySpecies = false,
}: {
  readonly plan?: FeedingPlan | undefined;
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly feeds: readonly FeedType[];
  readonly api: ReturnType<typeof useMutations<FeedingPlan>>;
  /** What a "whole group" plan targets — the group every animal here is in. */
  readonly propertyId: Ulid;
  readonly onClose: () => void;
  /** Switching a plan off for the season, which keeps it for next year. */
  readonly onToggle: (plan: FeedingPlan) => void;
  readonly onDelete: (plan: FeedingPlan) => void;
  /** Offer every species as a target — Farm › Feed rations the whole place. */
  readonly anySpecies?: boolean;
}) {
  const { show } = useToast();
  const editing = plan !== undefined;
  const formId = useId();

  const [name, setName] = useState(plan?.name ?? "");
  const [target, setTarget] = useState<"animal" | "zone" | "group">(plan?.target ?? "group");
  const [targetId, setTargetId] = useState<string>(
    plan === undefined || plan.target === "group" ? "" : plan.targetId,
  );
  const [lines, setLines] = useState<LineDraft[]>(
    plan === undefined ? [blankLine()] : draftFrom(plan),
  );
  const [portion, setPortion] = useState<Portion>(
    plan === undefined ? "per_head" : portionOf(plan),
  );
  const [notes, setNotes] = useState(plan?.specialNotes ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  /**
   * What the target picker offers.
   *
   * Cattle only. A feeding plan is species-agnostic and the pets screen writes
   * to the same table, so an unfiltered list puts the dogs in the dropdown on
   * the screen that rations the herd. The plan being edited keeps its own
   * target whatever species it is — otherwise opening a plan written on
   * another screen would blank the field it came in with, and saving would
   * quietly move the plan onto somebody else. Farm › Feed, which rations
   * every species, lifts the filter with `anySpecies`.
   */
  const targets =
    target === "animal"
      ? animals.filter(
          (entry) => anySpecies || entry.species === "cattle" || entry.id === plan?.targetId,
        )
      : target === "zone"
        ? zones
        : [];
  const feedById = new Map<string, FeedType>(feeds.map((feed) => [feed.id, feed]));

  const editLine = (key: string, patch: Partial<LineDraft>): void =>
    setLines(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const dropLine = (key: string): void =>
    // crud-guard: allow-unconfirmed — taking a line out of a form that has not been saved
    setLines(lines.filter((line) => line.key !== key));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (lines.length === 0) {
      setError("A plan needs at least one thing in it");
      return;
    }
    if (lines.some((line) => line.feedId === "")) {
      setError("Choose what each line feeds");
      return;
    }
    if (target !== "group" && targetId === "") {
      setError(target === "animal" ? "Choose the animal" : "Choose the zone");
      return;
    }
    // `dailyDemandOf` throws on a plan that feeds one feed in two units, which
    // is a plan with no meaningful total. Caught here so it is a sentence
    // rather than a crash on the screen that reads the plan back.
    const mixed = mixedUnitFeed(lines);
    if (mixed !== undefined) {
      setError(
        `Two lines feed ${feedById.get(mixed)?.name ?? "the same feed"} in different units. Put both in the same one.`,
      );
      return;
    }

    setBusy(true);
    try {
      const written: FeedingPlanLine[] = lines.map((line) => ({
        feedTypeId: line.feedId as Ulid,
        amount: { amount: Number(line.amount || "0"), unit: line.unit },
        frequency: line.frequency,
        timeOfDay: line.timeOfDay,
      }));

      const fields = {
        name: name.trim(),
        target,
        // A group plan still needs a target id; the herd is the property.
        // A group plan targets the property: it is the group every animal on
        // the place belongs to, and `herdDemand` resolves it that way.
        targetId: (target === "group" ? propertyId : targetId) as Ulid,
        // `alsoFeeds` is for a bowl shared by named animals, which is a pets
        // shape. Here a shared amount is a *zone* or *group* plan that says
        // `shared` — one mineral tub in a pen, not one tub per cow.
        alsoFeeds: [],
        // An animal plan feeds one animal, so there is nothing to share it
        // with whatever the control last said.
        portion: target === "animal" ? ("per_head" as const) : portion,
        lines: written,
        ...(notes.trim() === "" ? {} : { specialNotes: notes.trim() }),
      };

      const result = editing
        ? await api.update(plan.id, fields as Partial<FeedingPlan>)
        : await api.create({ ...fields, active: true } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }

      show({ message: editing ? "Plan updated" : "Plan added", tone: "success" });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const targetAnimal =
    plan?.target === "animal" ? animals.find((entry) => entry.id === plan.targetId) : undefined;

  return (
    <Modal
      placement="side"
      title={editing ? `Edit ${plan.name}` : "Add a plan"}
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" type="submit" form={formId} busy={busy}>
            {editing ? "Save changes" : "Add plan"}
          </Button>
          {editing ? (
            <Button
              onClick={() => {
                onToggle(plan);
                onClose();
              }}
            >
              {plan.active ? "Switch off" : "Switch on"}
            </Button>
          ) : (
            <Button onClick={onClose}>Cancel</Button>
          )}
          {editing ? (
            <Button variant="danger" className="ml-auto" onClick={() => onDelete(plan)}>
              Delete
            </Button>
          ) : null}
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-density"
      >
        <TextInput
          label="Plan name"
          hint="&ldquo;Show calves, morning&rdquo;"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <Select
          label="Feeds"
          value={target}
          onChange={(event) => {
            setTarget(event.target.value as "animal" | "zone" | "group");
            setTargetId("");
          }}
          options={[
            { value: "group", label: "the whole group" },
            { value: "zone", label: "a zone" },
            { value: "animal", label: "one animal" },
          ]}
        />
        {target === "group" ? null : (
          <Select
            label={target === "animal" ? "Animal" : "Zone"}
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            placeholder="Choose"
            options={targets.map((entry) => ({
              value: entry.id,
              label:
                "name" in entry && typeof entry.name === "string" && entry.name !== ""
                  ? entry.name
                  : displayName(entry as Animal),
            }))}
            required
          />
        )}

        {target === "animal" ? null : (
          <Select
            label="The amounts below are"
            hint={
              target === "zone"
                ? "Per head: 40 lb on a pen of four is 160 lb. Shared: one mineral tub, however many are in."
                : "Shared is for what the whole place works through at a fixed rate."
            }
            value={portion}
            onChange={(event) => setPortion(event.target.value as Portion)}
            options={[
              { value: "per_head", label: "What each animal gets" },
              {
                value: "shared",
                label: target === "zone" ? "Shared by the zone" : "Shared by the whole group",
              },
            ]}
          />
        )}

        {lines.map((line, index) => (
          <fieldset
            key={line.key}
            className="grid grid-cols-2 gap-density rounded-density border border-rule p-3"
          >
            <legend className="px-1 text-sm font-medium text-muted">Feed {index + 1}</legend>
            <div className="col-span-2">
              <Select
                label="Feed"
                value={line.feedId}
                onChange={(event) => {
                  const feed = feedById.get(event.target.value);
                  // The catalog's unit is the sensible starting point, and
                  // nothing more than that — it stays changeable, because a bag
                  // of cubes is fed by the scoop.
                  editLine(line.key, {
                    feedId: event.target.value,
                    ...(feed === undefined ? {} : { unit: feed.unit }),
                  });
                }}
                placeholder="Choose a feed"
                options={feeds.map((feed) => ({ value: feed.id, label: feed.name }))}
                required
              />
            </div>
            <TextInput
              label="Amount"
              type="number"
              inputMode="decimal"
              step="any"
              value={line.amount}
              onChange={(event) => editLine(line.key, { amount: event.target.value })}
              required
            />
            <Select
              label="Measured in"
              value={line.unit}
              onChange={(event) => editLine(line.key, { unit: event.target.value as Unit })}
              options={FEED_UNITS.map((value) => ({ value, label: value.replace(/_/g, " ") }))}
            />
            <Select
              label="How often"
              value={line.frequency}
              onChange={(event) =>
                editLine(line.key, { frequency: event.target.value as FeedingFrequency })
              }
              options={FEEDING_FREQUENCIES.map((value) => ({
                value,
                label: value.replace(/_/g, " "),
              }))}
            />
            <Select
              label="When"
              value={line.timeOfDay}
              onChange={(event) =>
                editLine(line.key, { timeOfDay: event.target.value as TimeOfDay })
              }
              options={TIMES_OF_DAY.map((value) => ({ value, label: value }))}
            />

            <div className="col-span-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">{describeLine(line, feedById.get(line.feedId))}</p>
              {lines.length === 1 ? null : (
                <Button variant="ghost" type="button" onClick={() => dropLine(line.key)}>
                  Remove
                </Button>
              )}
            </div>
          </fieldset>
        ))}

        <div>
          <Button variant="ghost" type="button" onClick={() => setLines([...lines, blankLine()])}>
            <span aria-hidden="true">+</span> Add another feed
          </Button>
        </div>

        <TextInput
          label="Notes"
          hint="Anything the person feeding needs to know."
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />

        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        {targetAnimal === undefined ? null : (
          <Link
            href={animalHref(targetAnimal)}
            className="inline-flex min-h-target items-center text-sm text-action underline-offset-2 hover:underline"
          >
            Open {displayName(targetAnimal)}&rsquo;s page
          </Link>
        )}
      </form>
    </Modal>
  );
}
