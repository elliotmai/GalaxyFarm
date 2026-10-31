"use client";

import { useId, useMemo, useState, type ReactNode } from "react";

import {
  Button,
  DetailList,
  EmptyState,
  Modal,
  PageBody,
  PageHeader,
  Pill,
  Section,
  Select,
  TextInput,
  useConfirmDelete,
  useToast,
  toOptions,
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
 *
 * The matings lead, because they are what gets acted on; the goals they serve
 * sit under them. Each is a row with one chip, and adding either is a side
 * panel rather than a form standing open above its list.
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

  const [planning, setPlanning] = useState(false);
  const [addingGoal, setAddingGoal] = useState(false);
  const [openId, setOpenId] = useState<Ulid | undefined>();
  const opened = plans.find((plan) => plan.id === openId);

  const activeGoals = goals.filter((g) => g.active).length;
  const committed = open.filter((plan) => plan.semenInventoryId !== undefined).length;

  const damName = (plan: PlannedMating) => {
    const dam = plan.damId === undefined ? undefined : byId.get(plan.damId);
    return dam === undefined ? (plan.damCriteria ?? "A dam not yet chosen") : displayName(dam);
  };
  const strawOf = (plan: PlannedMating) =>
    plan.semenInventoryId === undefined
      ? undefined
      : straws.find((entry) => entry.id === plan.semenInventoryId);

  return (
    <PageBody>
      {/* Bottom clearance on a phone, for the floating button and the tab bar. */}
      <div className="flex flex-col gap-density pb-20 sm:pb-0">
        <PageHeader
          eyebrow="Cattle"
          title="Genetic roadmap"
          subtitle={[
            `${open.length} planned`,
            `${realised.length} realised`,
            `${activeGoals} goal${activeGoals === 1 ? "" : "s"}`,
            ...(committed === 0
              ? []
              : [`${committed} straw${committed === 1 ? "" : "s"} committed`]),
          ].join(" · ")}
          actions={
            // A wrapper hides it on a phone: the button's own `inline-flex`
            // would win over a `hidden` passed to it.
            <span className="hidden sm:block">
              <Button variant="primary" onClick={() => setPlanning(true)}>
                <span aria-hidden="true">+</span> Plan a mating
              </Button>
            </span>
          }
        />

        <Section
          title="Planned matings"
          description="Recording one creates the breeding with dam, method and sire filled in."
        >
          {plans.length === 0 ? (
            <EmptyState
              title="Nothing planned"
              detail="When the breeding happens, the plan becomes the record in one tap."
              action={
                <Button variant="primary" onClick={() => setPlanning(true)}>
                  Plan a mating
                </Button>
              }
            />
          ) : (
            <ul aria-label="Planned matings" className={LIST}>
              {[...plans]
                .sort(
                  (left, right) =>
                    Number(left.planStatus !== "open") - Number(right.planStatus !== "open"),
                )
                .map((plan) => {
                  const name = damName(plan);
                  return (
                    <Row
                      key={plan.id}
                      title={name}
                      line={[
                        plan.method,
                        strawOf(plan)?.sireName,
                        plan.targetSeason,
                        plan.rationale,
                      ]}
                      chip={
                        plan.planStatus === "realised" ? (
                          <Pill tone="calm">
                            {plan.realisedAt === undefined
                              ? "Bred"
                              : `Bred ${formatDate(plan.realisedAt)}`}
                          </Pill>
                        ) : plan.planStatus === "abandoned" ? (
                          <Pill tone="neutral">Set aside</Pill>
                        ) : undefined
                      }
                    >
                      {/* The plan-to-fact step stays one tap on the row. */}
                      {plan.planStatus === "open" ? (
                        <Button onClick={() => void realise(plan)}>Record as bred</Button>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`More for ${name}`}
                        onClick={() => setOpenId(plan.id)}
                        className={ICON_BUTTON}
                      >
                        <MoreIcon />
                      </button>
                    </Row>
                  );
                })}
            </ul>
          )}
        </Section>

        <Section
          title="What we are selecting for"
          actions={<Button onClick={() => setAddingGoal(true)}>Add a goal</Button>}
        >
          {goals.length === 0 ? (
            <EmptyState
              title="No goals set"
              detail="Naming what you breed toward makes a mating plan arguable rather than a hunch."
            />
          ) : (
            <ul aria-label="Genetic goals" className={LIST}>
              {goals.map((goal) => (
                <Row
                  key={goal.id}
                  title={goal.trait}
                  line={[goal.direction, goal.active ? undefined : "inactive", goal.rationale]}
                >
                  <button
                    type="button"
                    aria-label={`Delete goal ${goal.trait}`}
                    onClick={() => void removeGoal(goal)}
                    className={ICON_BUTTON}
                  >
                    <TrashIcon />
                  </button>
                </Row>
              ))}
            </ul>
          )}
        </Section>

        <button
          type="button"
          onClick={() => setPlanning(true)}
          className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-full bg-action pl-4 pr-5 font-semibold text-action-ink shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action sm:hidden"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            +
          </span>
          Plan a mating
        </button>
      </div>

      {planning ? (
        <AddPlan dams={dams} straws={straws} api={plansApi} onClose={() => setPlanning(false)} />
      ) : null}
      {addingGoal ? <AddGoal api={goalsApi} onClose={() => setAddingGoal(false)} /> : null}

      {opened === undefined ? null : (
        <Modal
          title={damName(opened)}
          placement="side"
          onClose={() => setOpenId(undefined)}
          footer={
            <>
              {opened.planStatus === "open" ? (
                <Button
                  onClick={() => {
                    setOpenId(undefined);
                    void abandon(opened);
                  }}
                >
                  Set aside
                </Button>
              ) : (
                <Button onClick={() => setOpenId(undefined)}>Close</Button>
              )}
              {/* Closed first, so the confirmation is the only dialog showing. */}
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  setOpenId(undefined);
                  void removePlan(opened);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <DetailList
            items={[
              { label: "Status", value: opened.planStatus },
              { label: "Method", value: opened.method },
              { label: "Straw", value: strawOf(opened)?.sireName },
              { label: "Target season", value: opened.targetSeason },
              {
                label: "Bred",
                value: opened.realisedAt === undefined ? undefined : formatDate(opened.realisedAt),
              },
              { label: "Why this cross", value: opened.rationale, wide: true },
            ]}
          />
        </Modal>
      )}
    </PageBody>
  );
}

const LIST =
  "flex flex-col divide-y divide-rule overflow-hidden rounded-density border border-rule bg-panel";

const ICON_BUTTON =
  "inline-flex min-h-target min-w-target shrink-0 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-action";

/** One row: a bold name, one muted line, at most one chip, and its controls. */
function Row({
  title,
  line,
  chip,
  children,
}: {
  readonly title: string;
  readonly line: readonly (string | undefined)[];
  readonly chip?: ReactNode;
  readonly children?: ReactNode;
}) {
  const facts = line.filter((part): part is string => part !== undefined && part !== "");
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 pl-density pr-1">
      <span className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5 py-1">
        <span className="truncate font-semibold text-ink">{title}</span>
        {facts.length === 0 ? null : (
          <span className="text-sm text-muted">{facts.join(" · ")}</span>
        )}
      </span>
      {chip === undefined ? null : <span className="shrink-0">{chip}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-1">{children}</span>
    </li>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

function AddGoal({
  api,
  onClose,
}: {
  readonly api: ReturnType<typeof useMutations<GeneticGoal>>;
  readonly onClose: () => void;
}) {
  const { show } = useToast();
  const formId = useId();
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
      onClose();
      show({ message: "Goal added", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add a goal"
      description="Free text — every herd's traits are its own."
      placement="side"
      onClose={onClose}
      footer={
        <>
          <Button type="submit" form={formId} variant="primary" busy={busy}>
            Add goal
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
          label="Trait"
          placeholder="calving ease, rib shape, docility"
          value={trait}
          onChange={(event) => setTrait(event.target.value)}
          required
        />
        <Select
          label="Direction"
          value={direction}
          onChange={(event) => setDirection(event.target.value as GeneticDirection)}
          options={toOptions(GENETIC_DIRECTIONS)}
        />
        <TextInput
          label="Why"
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
      </form>
    </Modal>
  );
}

function AddPlan({
  dams,
  straws,
  api,
  onClose,
}: {
  readonly dams: readonly Animal[];
  readonly straws: readonly SemenInventory[];
  readonly api: ReturnType<typeof useMutations<PlannedMating>>;
  readonly onClose: () => void;
}) {
  const { show } = useToast();
  const formId = useId();
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
      onClose();
      show({ message: "Mating planned", tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Plan a mating"
      placement="side"
      onClose={onClose}
      footer={
        <>
          {/* Tied to the form by `form`, so it stays pinned while fields scroll. */}
          <Button type="submit" form={formId} variant="primary" busy={busy}>
            Plan this mating
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
        <Select
          label="Dam"
          value={damId}
          onChange={(event) => setDamId(event.target.value)}
          placeholder="Not decided yet"
          options={dams.map((animal) => ({ value: animal.id, label: displayName(animal) }))}
        />
        <TextInput
          label="…or what kind"
          placeholder="a good Chi-cross heifer"
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
        />
        <div className="grid grid-cols-2 gap-density">
          <Select
            label="Method"
            value={method}
            onChange={(event) => setMethod(event.target.value as BreedingMethod)}
            options={toOptions(BREEDING_METHODS)}
          />
          <TextInput
            label="Target season"
            placeholder="Spring 2027"
            value={season}
            onChange={(event) => setSeason(event.target.value)}
          />
        </div>
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
          label="Why this cross"
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />

        {error === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
