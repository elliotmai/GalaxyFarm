"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import {
  Button,
  EmptyState,
  Fab,
  Modal,
  PageBody,
  Pill,
  PlusIcon,
  Section,
  Select,
  TextInput,
  useToast,
} from "@galaxy-farm/ui";
import {
  isOnFarm,
  isTotal,
  type Animal,
  type FeedingPlan,
  type Ulid,
  type Zone,
  SPECIES_LABELS,
} from "@galaxy-farm/core";

import {
  describeGrain,
  herdDemand,
  categoryOptions,
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
  Chip,
  ChipRow,
  facts,
  Row,
  Rows,
  ScreenHeader,
} from "@/app/(admin)/admin/cattle/[id]/_components/record-rows";
import {
  FeedingPlanEditor,
  membersLabel,
  placeLabel,
} from "@/app/(admin)/_components/feeding-plan-editor";
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
  const { records: allPlans, loading } = useRecords<FeedingPlan>("feedingPlans", query);
  // The cattle's plans. Every other species' are on Farm › Feed.
  const plans = useMemo(() => allPlans.filter((plan) => plan.species === "cattle"), [allPlans]);

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
    () => animals.filter(isOnFarm).map((animal) => ({ id: animal.id })),
    [animals],
  );

  const herd = useMemo(
    () => herdDemand({ plans: plans.filter((plan) => plan.active), feeds, animals: animalScopes }),
    [plans, feeds, animalScopes],
  );

  const demand = useMemo(
    () =>
      [...herd.perDay.entries()]
        .map(([feedTypeId, amount]) => ({ feed: feedById.get(feedTypeId), amount }))
        .filter((entry): entry is { feed: FeedType; amount: number } => entry.feed !== undefined),
    [herd, feedById],
  );

  const active = plans.filter((plan) => plan.active);
  const nameOfFeed = (id: Ulid) => feedById.get(id)?.name ?? "feed";

  const addButton =
    view === "catalog" ? (
      <Button variant="primary" aria-haspopup="dialog" onClick={() => setEditingFeed("new")}>
        <PlusIcon />
        Add feed
      </Button>
    ) : (
      <Button variant="primary" aria-haspopup="dialog" onClick={() => setEditing("new")}>
        <PlusIcon />
        Add plan
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
              detail="A plan names the cattle it feeds, where, and what each feed goes in."
              action={
                <Button variant="primary" onClick={() => setEditing("new")}>
                  Add plan
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
                    membersLabel(plan, animals),
                    placeLabel(plan, zones) === undefined
                      ? undefined
                      : `at ${placeLabel(plan, zones)}`,
                    isTotal(plan) && "for all of them together",
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
                    Add feed
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
          <Fab onClick={() => setEditingFeed("new")}>Add feed</Fab>
        ) : (
          <Fab onClick={() => setEditing("new")}>Add plan</Fab>
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
          <FeedingPlanEditor
            key={editingPlan?.id ?? "new"}
            plan={editingPlan}
            species="cattle"
            lockSpecies
            animals={animals}
            zones={zones}
            feeds={feeds}
            propertyId={propertyId}
            actorId={actorId}
            onClose={() => setEditing(undefined)}
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
      title={editing ? `Edit ${feed.name}` : "Add feed"}
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
          options={categoryOptions((species) => SPECIES_LABELS[species].toLowerCase())}
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
