"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Button,
  CardGrid,
  EmptyState,
  PageBody,
  PageHeader,
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
  dailyDemandOf,
  displayName,
  FEEDING_FREQUENCIES,
  feedingPlanSchema,
  TIMES_OF_DAY,
  type Animal,
  type FeedingFrequency,
  type FeedingPlan,
  type FeedingPlanLine,
  type TimeOfDay,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";
import {
  FEED_CATEGORIES,
  FEED_UNITS,
  feedTypeSchema,
  poundsOf,
  type FeedCategory,
  type FeedType,
  type FeedUnit,
} from "@galaxy-farm/module-feed";

import { animalHref } from "@/lib/animal-slug";
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

  const plansApi = useMutations<FeedingPlan>(
    "feedingPlans",
    "feedingPlans",
    feedingPlanSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const feedById = useMemo(() => new Map(feeds.map((feed) => [feed.id, feed])), [feeds]);
  const animalById = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);

  /**
   * Daily demand across every active plan, per feed type.
   *
   * Summed per type rather than overall, for the reason above — and only over
   * active plans, because a plan switched off out of season is not feed
   * anybody is putting out.
   */
  const demand = useMemo(() => {
    const totals = new Map<Ulid, number>();

    for (const plan of plans) {
      for (const [feedTypeId, quantity] of dailyDemandOf(plan)) {
        totals.set(feedTypeId, (totals.get(feedTypeId) ?? 0) + quantity.amount);
      }
    }

    return [...totals.entries()]
      .map(([feedTypeId, amount]) => ({ feed: feedById.get(feedTypeId), amount }))
      .filter((entry): entry is { feed: FeedType; amount: number } => entry.feed !== undefined);
  }, [plans, feedById]);

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
                    <Pill>
                      about {Math.round(poundsOf(entry.feed, entry.amount) as number)} lb/day
                    </Pill>
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
        <AddFeedType propertyId={propertyId} actorId={actorId} />
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
                tone={feed.active ? "neutral" : "neutral"}
                title={feed.name}
                subtitle={`${feed.category} · by the ${feed.unit.replace(/_/g, " ")}`}
                meta={
                  feed.estWeightLbPerUnit === undefined ? undefined : (
                    <Pill>{feed.estWeightLbPerUnit} lb each</Pill>
                  )
                }
              />
            ))}
          </CardGrid>
        )}
      </Section>

      <Section title="Add a plan">
        <AddPlan animals={animals} zones={zones} feeds={feeds} api={plansApi} />
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
                subtitle={`${plan.target} · ${describeTarget(plan)}`}
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
    </PageBody>
  );
}

function AddFeedType({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const api = useMutations<FeedType>("feedTypes", "feedTypes", feedTypeSchema, propertyId, actorId);
  const { show } = useToast();

  const [name, setName] = useState("");
  const [category, setCategory] = useState<FeedCategory>("hay");
  const [unit, setUnit] = useState<FeedUnit>("round_bale");
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.create({
        name: name.trim(),
        category,
        unit,
        ...(weight === "" ? {} : { estWeightLbPerUnit: Number(weight) }),
        reorderLeadDays: 7,
        active: true,
      } as never);
      if (!result.ok) return;
      setName("");
      setWeight("");
      show({ message: "Added to the catalogue", tone: "success" });
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
        hint="A round bale is 800 to 1,400."
        type="number"
        inputMode="decimal"
        value={weight}
        onChange={(event) => setWeight(event.target.value)}
      />
      <Button type="submit" busy={busy}>
        Add feed
      </Button>
    </form>
  );
}

function AddPlan({
  animals,
  zones,
  feeds,
  api,
}: {
  readonly animals: readonly Animal[];
  readonly zones: readonly Zone[];
  readonly feeds: readonly FeedType[];
  readonly api: ReturnType<typeof useMutations<FeedingPlan>>;
}) {
  const { show } = useToast();
  const [name, setName] = useState("");
  const [target, setTarget] = useState<"animal" | "zone" | "group">("group");
  const [targetId, setTargetId] = useState("");
  const [feedId, setFeedId] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<FeedingFrequency>("twice_daily");
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("morning");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const targets = target === "animal" ? animals : target === "zone" ? zones : [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (feedId === "") {
      setError("Choose what this plan feeds");
      return;
    }
    if (target !== "group" && targetId === "") {
      setError(target === "animal" ? "Choose the animal" : "Choose the zone");
      return;
    }

    setBusy(true);
    try {
      const feed = feeds.find((entry) => entry.id === feedId);
      const line: FeedingPlanLine = {
        feedTypeId: feedId as Ulid,
        amount: { amount: Number(amount || "0"), unit: feed?.unit ?? "lb" },
        frequency,
        timeOfDay,
      };

      const result = await api.create({
        name: name.trim(),
        target,
        // A group plan still needs a target id; the herd is the property.
        targetId: (target === "group" ? feeds[0]?.propertyId : targetId) as Ulid,
        lines: [line],
        active: true,
      } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }
      setName("");
      setAmount("");
      show({ message: "Plan added", tone: "success" });
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
        <Select
          label="Feed"
          value={feedId}
          onChange={(event) => setFeedId(event.target.value)}
          placeholder="Choose a feed"
          options={feeds.map((feed) => ({ value: feed.id, label: feed.name }))}
          required
        />
        <TextInput
          label="Amount"
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
        <Select
          label="How often"
          value={frequency}
          onChange={(event) => setFrequency(event.target.value as FeedingFrequency)}
          options={FEEDING_FREQUENCIES.map((value) => ({
            value,
            label: value.replace(/_/g, " "),
          }))}
        />
        <Select
          label="When"
          value={timeOfDay}
          onChange={(event) => setTimeOfDay(event.target.value as TimeOfDay)}
          options={TIMES_OF_DAY.map((value) => ({ value, label: value }))}
        />
      </div>

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Button type="submit" busy={busy}>
        Add plan
      </Button>
    </form>
  );
}
