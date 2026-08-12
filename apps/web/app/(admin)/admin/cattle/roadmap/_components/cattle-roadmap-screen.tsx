"use client";

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
import { displayName, encodeUlid, type Animal, type Ulid } from "@galaxy-farm/core";
import {
  BREEDING_METHODS,
  breedingRecordSchema,
  GENETIC_DIRECTIONS,
  geneticGoalSchema,
  plannedMatingSchema,
  type BreedingMethod,
  type BreedingRecord,
  type GeneticDirection,
  type GeneticGoal,
  type PlannedMating,
  type SemenInventory,
} from "@galaxy-farm/module-cattle";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * What the herd is being bred toward (spec §5.2, issue #20).
 *
 * Two halves that only make sense together: the traits being selected for, and
 * the specific matings planned to move them. §5.9's planned-to-actual pattern
 * applies to the second — **marking a plan realised creates the breeding
 * record**, carrying the dam, method and sire across. The plan becomes the
 * fact in one tap and nothing is typed twice, which is the whole reason to
 * plan in the app rather than on a whiteboard.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function CattleRoadmapScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const query = { propertyId };
  const { records: animals } = useRecords<Animal>("animals", query);
  const { records: goals } = useRecords<GeneticGoal>("geneticGoals", query);
  const { records: plans } = useRecords<PlannedMating>("plannedMatings", query);
  const { records: straws } = useRecords<SemenInventory>("semenInventory", query);

  const goalsApi = useMutations<GeneticGoal>(
    "geneticGoals",
    "geneticGoals",
    geneticGoalSchema,
    propertyId,
    actorId,
  );
  const plansApi = useMutations<PlannedMating>(
    "plannedMatings",
    "plannedMatings",
    plannedMatingSchema,
    propertyId,
    actorId,
  );
  const breedingsApi = useMutations<BreedingRecord>(
    "breedingRecords",
    "breedingRecords",
    breedingRecordSchema,
    propertyId,
    actorId,
  );

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const dams = animals.filter(
    (a) => a.species === "cattle" && a.sex === "female" && a.status === "active",
  );

  const open = plans.filter((plan) => plan.planStatus === "open");
  const realised = plans.filter((plan) => plan.planStatus === "realised");

  /**
   * The plan becomes the fact (§5.9).
   *
   * Creates the breeding first and only marks the plan realised once it
   * exists — a plan pointing at a breeding that was never created is worse
   * than a plan still open, because nothing will prompt for it again.
   */
  async function realise(plan: PlannedMating) {
    if (plan.damId === undefined) {
      show({
        message: "This plan has no specific dam yet — choose one before recording it",
        tone: "warning",
      });
      return;
    }

    const at = new Date();
    const created = await breedingsApi.create({
      id: encodeUlid(at.getTime()) as Ulid,
      damId: plan.damId,
      method: plan.method,
      date: at,
      ...(plan.semenInventoryId === undefined ? {} : { semenInventoryId: plan.semenInventoryId }),
      ...(plan.bullId === undefined ? {} : { bullId: plan.bullId }),
      ...(plan.sireExternalId === undefined ? {} : { sireExternalId: plan.sireExternalId }),
      ...(plan.rationale === undefined ? {} : { notes: plan.rationale }),
    } as never);

    if (!created.ok) {
      show({ message: "Could not create the breeding record", tone: "danger" });
      return;
    }

    await plansApi.update(plan.id, {
      planStatus: "realised",
      realisedAs: created.value.id,
      realisedAt: at,
    } as Partial<PlannedMating>);

    show({ message: "Bred. The plan is now a breeding record.", tone: "success" });
  }

  async function abandon(plan: PlannedMating) {
    // Kept, with the reason. §5.9: what you turned down and why is worth as
    // much next year as what you did.
    await plansApi.update(plan.id, {
      planStatus: "abandoned",
      abandonedReason: "Abandoned from the roadmap",
    } as Partial<PlannedMating>);
    show({ message: "Plan set aside", tone: "warning" });
  }

  async function removeGoal(goal: GeneticGoal) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: goal.trait,
      entity: "genetic goal",
      dependents: [],
      action: "Delete",
    });
    if (!confirmed) return;

    await goalsApi.remove(goal.id, "Removed from the genetic plan");
    show({ message: "Goal deleted", tone: "danger" });
  }

  async function removePlan(plan: PlannedMating) {
    const dam = plan.damId === undefined ? undefined : byId.get(plan.damId);
    const confirmed = await confirmDelete({
      tier: plan.planStatus === "realised" ? "elevated" : "standard",
      recordName: `${dam === undefined ? (plan.damCriteria ?? "an unnamed dam") : displayName(dam)} · ${plan.method}`,
      entity: "planned mating",
      dependents:
        plan.planStatus === "realised"
          ? [
              {
                entity: "Breeding record",
                label: "created from this plan",
                effect: "detached" as const,
              },
            ]
          : [],
      consequence:
        plan.planStatus === "realised"
          ? "The breeding it became stays. Only the plan is deleted."
          : undefined,
      action: "Delete",
    });
    if (!confirmed) return;

    await plansApi.remove(plan.id, "Removed from the roadmap");
    show({ message: "Plan deleted", tone: "danger" });
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow="Cattle"
        title="Genetic roadmap"
        subtitle="What the herd is being bred toward, and the matings planned to get there. Recording a plan turns it into a breeding record."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Goals" value={goals.filter((g) => g.active).length} tone="identity" />
        <Tile
          label="Matings planned"
          value={open.length}
          tone="action"
          emphasis={open.length > 0}
        />
        <Tile label="Realised" value={realised.length} tone="calm" />
        <Tile
          label="Straws committed"
          value={open.filter((plan) => plan.semenInventoryId !== undefined).length}
        />
      </div>

      <Section
        title="What we are selecting for"
        description="Free text rather than a fixed list — every herd's traits are its own."
      >
        <AddGoal api={goalsApi} />
        {goals.length === 0 ? (
          <EmptyState
            title="No goals set"
            detail="Naming what you are breeding toward is what makes a mating plan arguable rather than a hunch."
          />
        ) : (
          <CardGrid columns={3}>
            {goals.map((goal) => (
              <RecordCard
                key={goal.id}
                tone={goal.active ? "identity" : "neutral"}
                title={goal.trait}
                subtitle={goal.rationale}
                actions={
                  <Pill tone={goal.direction === "increase" ? "calm" : "action"}>
                    {goal.direction}
                  </Pill>
                }
              >
                <Button variant="ghost" onClick={() => void removeGoal(goal)}>
                  Delete
                </Button>
              </RecordCard>
            ))}
          </CardGrid>
        )}
      </Section>

      <Section
        title="Planned matings"
        description="Recording one creates the breeding record with the dam, method and sire already filled in."
      >
        <AddPlan dams={dams} straws={straws} api={plansApi} />

        {plans.length === 0 ? (
          <EmptyState
            title="Nothing planned"
            detail="A plan carries the sire you chose and why. When you breed her, it becomes the record in one tap."
          />
        ) : (
          <CardGrid columns={2}>
            {[...plans]
              .sort(
                (left, right) =>
                  Number(left.planStatus !== "open") - Number(right.planStatus !== "open"),
              )
              .map((plan) => {
                const dam = plan.damId === undefined ? undefined : byId.get(plan.damId);
                const straw =
                  plan.semenInventoryId === undefined
                    ? undefined
                    : straws.find((entry) => entry.id === plan.semenInventoryId);

                return (
                  <RecordCard
                    key={plan.id}
                    tone={
                      plan.planStatus === "realised"
                        ? "calm"
                        : plan.planStatus === "abandoned"
                          ? "neutral"
                          : "action"
                    }
                    title={
                      dam === undefined
                        ? (plan.damCriteria ?? "A dam not yet chosen")
                        : displayName(dam)
                    }
                    subtitle={plan.rationale}
                    actions={<Pill tone="neutral">{plan.planStatus}</Pill>}
                    meta={
                      <>
                        <Pill tone="identity">{plan.method}</Pill>
                        {straw === undefined ? null : <Pill>{straw.sireName}</Pill>}
                        {plan.targetSeason === undefined ? null : (
                          <Pill tone="action">{plan.targetSeason}</Pill>
                        )}
                        {plan.realisedAt === undefined ? null : (
                          <Pill tone="calm">bred {formatDate(plan.realisedAt)}</Pill>
                        )}
                      </>
                    }
                  >
                    <div className="flex flex-wrap gap-2">
                      {plan.planStatus === "open" ? (
                        <>
                          <Button onClick={() => void realise(plan)}>Record as bred</Button>
                          <Button variant="ghost" onClick={() => void abandon(plan)}>
                            Set aside
                          </Button>
                        </>
                      ) : null}
                      <Button variant="ghost" onClick={() => void removePlan(plan)}>
                        Delete
                      </Button>
                    </div>
                  </RecordCard>
                );
              })}
          </CardGrid>
        )}
      </Section>
    </PageBody>
  );
}

function AddGoal({ api }: { readonly api: ReturnType<typeof useMutations<GeneticGoal>> }) {
  const { show } = useToast();
  const [trait, setTrait] = useState("");
  const [direction, setDirection] = useState<GeneticDirection>("increase");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.create({
        trait: trait.trim(),
        direction,
        active: true,
        ...(rationale.trim() === "" ? {} : { rationale: rationale.trim() }),
      } as never);
      if (!result.ok) return;
      setTrait("");
      setRationale("");
      show({ message: "Goal added", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <TextInput
          label="Trait"
          hint="&ldquo;calving ease&rdquo;, &ldquo;rib shape&rdquo;, &ldquo;docility&rdquo;"
          value={trait}
          onChange={(event) => setTrait(event.target.value)}
          required
        />
      </div>
      <Select
        label="Direction"
        value={direction}
        onChange={(event) => setDirection(event.target.value as GeneticDirection)}
        options={GENETIC_DIRECTIONS.map((value) => ({ value, label: value }))}
      />
      <div className="min-w-0 flex-1">
        <TextInput
          label="Why"
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
      </div>
      <Button type="submit" busy={busy}>
        Add goal
      </Button>
    </form>
  );
}

function AddPlan({
  dams,
  straws,
  api,
}: {
  readonly dams: readonly Animal[];
  readonly straws: readonly SemenInventory[];
  readonly api: ReturnType<typeof useMutations<PlannedMating>>;
}) {
  const { show } = useToast();
  const [damId, setDamId] = useState("");
  const [criteria, setCriteria] = useState("");
  const [method, setMethod] = useState<BreedingMethod>("AI");
  const [strawId, setStrawId] = useState("");
  const [season, setSeason] = useState("");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (damId === "" && criteria.trim() === "") {
      // §5.2 allows a plan with criteria instead of a cow — "a good Chi-cross
      // heifer" is a real plan. What it does not allow is neither.
      setError("Name the cow, or say what kind of cow this plan is for");
      return;
    }

    setBusy(true);
    try {
      const result = await api.create({
        ...(damId === "" ? {} : { damId: damId as Ulid }),
        ...(criteria.trim() === "" ? {} : { damCriteria: criteria.trim() }),
        method,
        ...(strawId === "" ? {} : { semenInventoryId: strawId as Ulid }),
        ...(season.trim() === "" ? {} : { targetSeason: season.trim() }),
        ...(rationale.trim() === "" ? {} : { rationale: rationale.trim() }),
        planStatus: "open",
      } as never);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not valid")
            : "Could not save that",
        );
        return;
      }
      setCriteria("");
      setRationale("");
      show({ message: "Mating planned", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-density">
      <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-3">
        <Select
          label="Dam"
          value={damId}
          onChange={(event) => setDamId(event.target.value)}
          placeholder="Not decided yet"
          options={dams.map((animal) => ({ value: animal.id, label: displayName(animal) }))}
        />
        <TextInput
          label="…or what kind"
          hint="&ldquo;a good Chi-cross heifer&rdquo; is a real plan."
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
        />
        <Select
          label="Method"
          value={method}
          onChange={(event) => setMethod(event.target.value as BreedingMethod)}
          options={BREEDING_METHODS.map((value) => ({ value, label: value }))}
        />
        <Select
          label="Straw"
          value={strawId}
          onChange={(event) => setStrawId(event.target.value)}
          placeholder="Not chosen"
          options={straws.map((entry) => ({
            value: entry.id,
            label: `${entry.sireName} · ${entry.strawsOnHand} left`,
          }))}
        />
        <TextInput
          label="Target season"
          hint="&ldquo;Spring 2027&rdquo; — how breeding is actually planned."
          value={season}
          onChange={(event) => setSeason(event.target.value)}
        />
        <TextInput
          label="Why this cross"
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
      </div>

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Button type="submit" busy={busy}>
        Plan this mating
      </Button>
    </form>
  );
}
