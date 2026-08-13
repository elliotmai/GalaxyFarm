"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Button,
  Callout,
  CardGrid,
  EmptyState,
  PageBody,
  PageHeader,
  Modal,
  Pill,
  RecordCard,
  Section,
  Select,
  TextInput,
  Tile,
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

  const plansApi = useMutations<FeedingPlan>(
    "feedingPlans",
    "feedingPlans",
    feedingPlanSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  /**
   * Held by id rather than as the record itself.
   *
   * The list is a live query — a sync pull mid-edit replaces every object in
   * it — and a form holding the old object would go on showing values the
   * store no longer has.
   */
  const [editing, setEditing] = useState<Ulid | undefined>();
  const editingPlan = plans.find((plan) => plan.id === editing);

  const [editingFeedId, setEditingFeed] = useState<Ulid | undefined>();
  const editingFeed = feeds.find((feed) => feed.id === editingFeedId);

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
  const animalScopes = useMemo(
    () =>
      animals
        .filter((animal) => animal.status === "active")
        .map((animal) => ({
          id: animal.id,
          zoneIds: openAssignments(assignments, animal.id).map((entry) => entry.zoneId),
        })),
    [animals, assignments],
  );

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

  async function toggle(plan: FeedingPlan) {
    await plansApi.update(plan.id, { active: !plan.active } as Partial<FeedingPlan>);
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

    await plansApi.remove(plan.id, "Removed from the feeding plans");
    show({ message: "Plan deleted", tone: "danger" });
  }

  const active = plans.filter((plan) => plan.active);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Feed plans"
        subtitle="What gets put out, for whom, and how much of each feed that adds up to in a day."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Plans" value={plans.length} />
        <Tile label="Feeding now" value={active.length} tone="calm" />
        <Tile label="Feeds in the catalogue" value={feeds.length} tone="identity" />
        <Tile
          label="Feed types in use"
          value={demand.length}
          tone="action"
          hint="Counted per type, never summed"
        />
      </div>

      {herd.unconvertible.length === 0 ? null : (
        <Callout
          tone="danger"
          title={`${herd.unconvertible.length} ration${herd.unconvertible.length === 1 ? "" : "s"} cannot be counted against the barn`}
        >
          {herd.unconvertible
            .map((feedTypeId) => feedById.get(feedTypeId)?.name ?? "a feed")
            .join(", ")}
          . The plan is written in one unit and the feed is counted in another, and nothing says
          what one of those weighs. Give the feed its <em>lb each</em> and both numbers work — until
          then it is left out of the daily demand rather than counted wrongly.
        </Callout>
      )}

      {demand.length === 0 ? null : (
        <Section
          title="Daily demand"
          description="Per feed type. A plan feeding grain and hay has no meaningful total, so none is shown."
        >
          <CardGrid columns={3}>
            {demand.map((entry) => (
              <RecordCard
                key={entry.feed.id}
                tone="action"
                title={entry.feed.name}
                subtitle={entry.feed.category}
                actions={
                  <Pill tone="action">
                    {Number(entry.amount.toFixed(1))} {entry.feed.unit.replace(/_/g, " ")}/day
                  </Pill>
                }
                meta={
                  poundsOf(entry.feed, entry.amount) === undefined ? undefined : (
                    <>
                      <Pill>
                        about {Math.round(poundsOf(entry.feed, entry.amount) as number)} lb/day
                      </Pill>
                      {/* Said in vessels as well, because "213 lb" is not
                          something anybody can carry to the feed shed. */}
                      {isGrainMeasure(entry.feed.unit) ? (
                        <Pill tone="identity">
                          {describeGrain(poundsOf(entry.feed, entry.amount) as number)}/day
                        </Pill>
                      ) : null}
                    </>
                  )
                }
              />
            ))}
          </CardGrid>
        </Section>
      )}

      <Section
        title="The feed catalogue"
        description="What a plan's lines can name. Cross-species — the same bale feeds cattle and the same scratch feeds chickens."
      >
        <FeedTypeForm propertyId={propertyId} actorId={actorId} />
        {feeds.length === 0 ? (
          <EmptyState
            title="Nothing in the catalogue"
            detail="Add a feed above and plans can start naming it."
          />
        ) : (
          <CardGrid columns={3}>
            {feeds.map((feed) => (
              <RecordCard
                key={feed.id}
                tone="neutral"
                title={feed.name}
                subtitle={`${feed.category} · by the ${feed.unit.replace(/_/g, " ")}`}
                meta={
                  <>
                    {feed.estWeightLbPerUnit === undefined ? null : (
                      <Pill>{feed.estWeightLbPerUnit} lb each</Pill>
                    )}
                    {feed.active ? null : <Pill>not stocked</Pill>}
                  </>
                }
              >
                <Button variant="ghost" onClick={() => setEditingFeed(feed.id)}>
                  Edit
                </Button>
              </RecordCard>
            ))}
          </CardGrid>
        )}
      </Section>

      <Section title="Add a plan">
        <PlanForm
          animals={animals}
          zones={zones}
          feeds={feeds}
          api={plansApi}
          propertyId={propertyId}
        />
      </Section>

      <Section title="Every plan">
        {loading ? (
          <p className="text-muted">Looking…</p>
        ) : plans.length === 0 ? (
          <EmptyState
            title="Nothing planned"
            detail="A group plan covers the herd; an animal plan overrides it for one cow. Both are the same record."
          />
        ) : (
          <CardGrid columns={2}>
            {plans.map((plan) => (
              <RecordCard
                key={plan.id}
                tone={plan.active ? "calm" : "neutral"}
                title={
                  plan.target === "animal" && animalById.has(plan.targetId) ? (
                    <Link
                      href={animalHref(animalById.get(plan.targetId) as Animal)}
                      className="underline decoration-edge underline-offset-4 hover:decoration-action"
                    >
                      {plan.name}
                    </Link>
                  ) : (
                    plan.name
                  )
                }
                subtitle={`${plan.target} · ${describeTarget(plan)}${isShared(plan) ? " · shared, not per head" : ""}`}
                actions={
                  <Pill tone={plan.active ? "calm" : "neutral"} dot={plan.active}>
                    {plan.active ? "feeding" : "off"}
                  </Pill>
                }
                meta={plan.lines.map((line, index) => {
                  const feed = feedById.get(line.feedTypeId);
                  return (
                    <Pill key={`${line.feedTypeId}-${index}`}>
                      {line.amount.amount} {line.amount.unit} {feed?.name ?? "feed"} ·{" "}
                      {line.frequency.replace(/_/g, " ")}
                    </Pill>
                  );
                })}
              >
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => setEditing(plan.id)}>
                    Edit
                  </Button>
                  <Button variant="ghost" onClick={() => void toggle(plan)}>
                    {plan.active ? "Switch off" : "Switch on"}
                  </Button>
                  <Button variant="ghost" onClick={() => void remove(plan)}>
                    Delete
                  </Button>
                </div>
              </RecordCard>
            ))}
          </CardGrid>
        )}
      </Section>

      {editingFeed === undefined ? null : (
        <Modal
          title={`Edit ${editingFeed.name}`}
          description="What it is called, what it is bought by, and what one of those weighs — which is what turns a ration into pounds."
          onClose={() => setEditingFeed(undefined)}
        >
          <FeedTypeForm
            key={editingFeed.id}
            feed={editingFeed}
            propertyId={propertyId}
            actorId={actorId}
            onSaved={() => setEditingFeed(undefined)}
          />
        </Modal>
      )}

      {editingPlan === undefined ? null : (
        <Modal
          title={`Edit ${editingPlan.name}`}
          description="Change the ration, what it feeds, or what it is measured in. The plan keeps its history."
          size="wide"
          onClose={() => setEditing(undefined)}
        >
          {/* Keyed on the plan, so opening a different one starts from its own
              values rather than from whichever was opened first. */}
          <PlanForm
            key={editingPlan.id}
            plan={editingPlan}
            animals={animals}
            zones={zones}
            feeds={feeds}
            api={plansApi}
            propertyId={propertyId}
            onSaved={() => setEditing(undefined)}
          />
        </Modal>
      )}
    </PageBody>
  );
}

/**
 * A feed in the catalogue, added or corrected.
 *
 * Correcting matters more than it looks. Every plan line points at one of
 * these by id, so a feed that could only be created and deleted would leave
 * somebody deleting one to fix a typo and taking every ration that named it
 * with them. And `lb each` is the figure that turns "three scoops" into
 * pounds — it is the number most likely to be wrong at first and most worth
 * being able to put right.
 */
function FeedTypeForm({
  feed,
  propertyId,
  actorId,
  onSaved,
}: {
  readonly feed?: FeedType | undefined;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly onSaved?: (() => void) | undefined;
}) {
  const api = useMutations<FeedType>("feedTypes", "feedTypes", feedTypeSchema, propertyId, actorId);
  const { show } = useToast();
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

      if (!editing) {
        setName("");
        setWeight("");
      }
      show({ message: editing ? "Feed updated" : "Added to the catalogue", tone: "success" });
      onSaved?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <TextInput
          label="Feed"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </div>
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
      <TextInput
        label="lb each"
        hint={
          standard === undefined
            ? "A round bale is 800 to 1,400."
            : `Leave it blank for ${standard === 1 ? "a pound" : `${Number(standard.toFixed(2))} lb`}, which is what a ${unit} holds here.`
        }
        type="number"
        inputMode="decimal"
        step="any"
        value={weight}
        onChange={(event) => setWeight(event.target.value)}
      />
      <Button type="submit" busy={busy}>
        {editing ? "Save changes" : "Add feed"}
      </Button>
    </form>
  );
}

/**
 * One line of a plan, as the form holds it.
 *
 * The unit is on the line rather than taken from the feed, because they are
 * genuinely different questions. Cubes are *bought* by the bag and *fed* by
 * the scoop, and a form that reads the unit off the catalogue makes somebody
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
function PlanForm({
  plan,
  animals,
  zones,
  feeds,
  api,
  propertyId,
  onSaved,
}: {
  readonly plan?: FeedingPlan | undefined;
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly feeds: readonly FeedType[];
  readonly api: ReturnType<typeof useMutations<FeedingPlan>>;
  /** What a "whole group" plan targets — the group every animal here is in. */
  readonly propertyId: Ulid;
  readonly onSaved?: (() => void) | undefined;
}) {
  const { show } = useToast();
  const editing = plan !== undefined;

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

  const targets = target === "animal" ? animals : target === "zone" ? zones : [];
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

      if (!editing) {
        setName("");
        setLines([blankLine()]);
        setNotes("");
      }
      show({ message: editing ? "Plan updated" : "Plan added", tone: "success" });
      onSaved?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
      <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
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
        {target === "group" ? (
          <div />
        ) : (
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
      </div>

      {target === "animal" ? null : (
        <Select
          label="The amounts below are"
          hint={
            target === "zone"
              ? "Per head is the usual reading: 40 lb of hay on a pen of four is 160 lb a day. A mineral tub is the other case — one tub in the pen, however many are in it."
              : "Per head is the usual reading. Pick shared for the one thing the whole place works through at a fixed rate rather than per animal."
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

      <div className="flex flex-col gap-density">
        {lines.map((line) => (
          <div
            key={line.key}
            className="grid grid-cols-1 gap-density rounded-density border border-edge p-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            <Select
              label="Feed"
              value={line.feedId}
              onChange={(event) => {
                const feed = feedById.get(event.target.value);
                // The catalogue's unit is the sensible starting point, and
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
              hint="Bought by the bag, fed by the scoop."
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
            <div className="flex items-end gap-2">
              <Select
                label="When"
                value={line.timeOfDay}
                onChange={(event) =>
                  editLine(line.key, { timeOfDay: event.target.value as TimeOfDay })
                }
                options={TIMES_OF_DAY.map((value) => ({ value, label: value }))}
              />
              {lines.length === 1 ? null : (
                <Button variant="ghost" type="button" onClick={() => dropLine(line.key)}>
                  Remove
                </Button>
              )}
            </div>

            <p className="text-sm text-muted lg:col-span-5">
              {describeLine(line, feedById.get(line.feedId))}
            </p>
          </div>
        ))}

        <div>
          <Button variant="ghost" type="button" onClick={() => setLines([...lines, blankLine()])}>
            Add another feed
          </Button>
        </div>
      </div>

      <TextInput
        label="Notes"
        hint="Anything about this plan somebody feeding needs to know."
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" busy={busy}>
          {editing ? "Save changes" : "Add plan"}
        </Button>
      </div>
    </form>
  );
}
