"use client";

import { useState } from "react";

import {
  Button,
  Callout,
  CardGrid,
  Checkbox,
  DataTable,
  EmptyState,
  Modal,
  Pill,
  RecordCard,
  Section,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import type { CrudError, Ulid } from "@galaxy-farm/core";
import {
  plannedPlantingSchema,
  plantingSchema,
  plantingToActual,
  plantingWindows,
  seasonPlanSchema,
  type Bed,
  type Crop,
  type PlannedPlanting,
  type Planting,
  type PlantingMethod,
  type SeasonPlan,
  type Variety,
} from "@galaxy-farm/module-garden";

import {
  METHOD_LABEL,
  METHOD_OPTIONS,
  dateFromInput,
  dateInputValue,
  formatDate,
} from "@/app/(admin)/admin/garden/_components/labels";
import { varietyLabel } from "@/lib/garden";
import { useMutations } from "@/lib/local/mutations";

/**
 * The season plan, and the one tap that makes it real (spec §5.5).
 *
 * This is the same planned→actual pattern as `PlannedMating → BreedingRecord`
 * and `PurchaseCandidate → Equipment`, and it is worth recognising as a pattern
 * rather than reinventing it: the plan carries the variety, the method, the
 * bed and the quantity across, and the plan itself survives as the record of
 * what was decided in January. `plantingToActual` in the domain owns the
 * carry-over; this screen owns the tap.
 *
 * The plan is also the only thing that raises a notification. §5.5 is explicit
 * that alerts fire for what is in the plan and not for the whole seed
 * catalogue — a seed box with forty varieties in it would otherwise produce
 * eighty emails a year about work nobody had decided to do.
 */

interface PlanDraft {
  readonly name: string;
  readonly year: string;
  readonly notes: string;
  readonly active: boolean;
}

interface EntryDraft {
  readonly seasonPlanId: string;
  readonly varietyId: string;
  readonly method: PlantingMethod;
  readonly bedId: string;
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly quantity: string;
  readonly notes: string;
}

export function SeasonPlanPanel({
  plans,
  planned,
  beds,
  varieties,
  crops,
  loading,
  propertyId,
  actorId,
  leadDays,
}: {
  readonly plans: readonly SeasonPlan[];
  readonly planned: readonly PlannedPlanting[];
  readonly beds: readonly Bed[];
  readonly varieties: readonly Variety[];
  readonly crops: readonly Crop[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
  readonly leadDays: number;
}) {
  const planApi = useMutations<SeasonPlan>(
    "seasonPlans",
    "seasonPlans",
    seasonPlanSchema,
    propertyId,
    actorId,
  );
  const entryApi = useMutations<PlannedPlanting>(
    "plannedPlantings",
    "plannedPlantings",
    plannedPlantingSchema,
    propertyId,
    actorId,
  );
  // The conversion writes a real planting, which is a different table.
  const plantingApi = useMutations<Planting>(
    "plantings",
    "plantings",
    plantingSchema,
    propertyId,
    actorId,
  );

  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const [editingPlan, setEditingPlan] = useState<SeasonPlan | undefined>();
  const [planDraft, setPlanDraft] = useState<PlanDraft | undefined>();
  const [editingEntry, setEditingEntry] = useState<PlannedPlanting | undefined>();
  const [entryDraft, setEntryDraft] = useState<EntryDraft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [converting, setConverting] = useState<PlannedPlanting | undefined>();
  const [convertBed, setConvertBed] = useState("");

  const now = new Date();
  const openBeds = beds.filter((bed) => bed.active);
  const nameOf = (varietyId: Ulid) =>
    varietyLabel(
      varieties.find((variety) => variety.id === varietyId),
      crops,
    );
  const bedName = (id: Ulid | undefined) =>
    id === undefined ? undefined : beds.find((bed) => bed.id === id)?.name;

  const windows = plantingWindows(planned, now, leadDays);

  function reportErrors(error: CrudError, fallback: string) {
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { [fallback]: "Could not save. Check the fields and try again." },
    );
  }

  async function savePlan() {
    if (planDraft === undefined) return;
    setErrors({});

    const fields = {
      name: planDraft.name.trim(),
      year: planDraft.year.trim() === "" ? Number.NaN : Number(planDraft.year.trim()),
      notes: planDraft.notes.trim() === "" ? undefined : planDraft.notes.trim(),
      active: planDraft.active,
    };

    const result =
      editingPlan === undefined
        ? await planApi.create(fields as never)
        : await planApi.update(editingPlan.id, fields as Partial<SeasonPlan>);

    if (!result.ok) {
      reportErrors(result.error, "name");
      return;
    }

    show({ message: editingPlan === undefined ? "Plan added" : "Plan saved", tone: "success" });
    setPlanDraft(undefined);
    setEditingPlan(undefined);
  }

  async function saveEntry() {
    if (entryDraft === undefined) return;
    setErrors({});

    const from = dateFromInput(entryDraft.windowFrom);
    const to = dateFromInput(entryDraft.windowTo);

    const fields = {
      seasonPlanId: entryDraft.seasonPlanId as Ulid,
      varietyId: entryDraft.varietyId as Ulid,
      method: entryDraft.method,
      bedId: entryDraft.bedId === "" ? undefined : (entryDraft.bedId as Ulid),
      windowFrom: from ?? new Date(Number.NaN),
      windowTo: to ?? new Date(Number.NaN),
      quantity: entryDraft.quantity.trim() === "" ? undefined : Number(entryDraft.quantity.trim()),
      planStatus: editingEntry?.planStatus ?? ("open" as const),
      notes: entryDraft.notes.trim() === "" ? undefined : entryDraft.notes.trim(),
    };

    const result =
      editingEntry === undefined
        ? await entryApi.create(fields as never)
        : await entryApi.update(editingEntry.id, fields as Partial<PlannedPlanting>);

    if (!result.ok) {
      reportErrors(result.error, "varietyId");
      return;
    }

    show({ message: editingEntry === undefined ? "Added to the plan" : "Plan entry saved" });
    setEntryDraft(undefined);
    setEditingEntry(undefined);
  }

  /**
   * The one tap (§5.5).
   *
   * Both writes or neither, in that order: the planting is created first, and
   * only a planting that actually saved gets recorded on the plan as what it
   * became. The other order would leave a plan pointing at an id nothing
   * answers to — and `realisedAs` is the thread that lets somebody ask, in
   * October, what the January plan actually turned into.
   *
   * The bed can be supplied here when the plan did not name one, which is the
   * ordinary case in January: you know you are starting tomatoes, not which
   * bed they end up in.
   */
  async function convert(entry: PlannedPlanting, bedId: Ulid | undefined) {
    const draft = plantingToActual(entry, new Date(), bedId);
    if (!draft.ok) {
      show({ message: draft.reason, tone: "warning" });
      return;
    }

    const created = await plantingApi.create(draft.draft as never);
    if (!created.ok) {
      show({ message: "Could not record that planting", tone: "danger" });
      return;
    }

    const closed = await entryApi.update(entry.id, {
      planStatus: "realised",
      realisedAs: created.value.id,
      realisedAt: created.value.plantedOn ?? new Date(),
    } as Partial<PlannedPlanting>);

    if (!closed.ok) {
      // The planting is real and the plan is not closed out. Say so plainly
      // rather than silently leaving the window still raising notifications.
      show({
        message: `${nameOf(entry.varietyId)} is planted, but the plan entry could not be closed out — it will keep raising its window until it is.`,
        tone: "warning",
      });
      return;
    }

    setConverting(undefined);
    setConvertBed("");
    show({
      message: `${nameOf(entry.varietyId)} planted in ${bedName(draft.draft.bedId) ?? "the bed"}`,
      tone: "success",
    });
  }

  /** Give up on a plan entry without pretending it happened. */
  async function abandon(entry: PlannedPlanting) {
    const result = await entryApi.update(entry.id, {
      planStatus: "abandoned",
      abandonedReason: "Not planted this season",
    } as Partial<PlannedPlanting>);

    if (!result.ok) {
      show({ message: "Could not close that out", tone: "danger" });
      return;
    }

    show({
      message: `${nameOf(entry.varietyId)} marked as not planted`,
      action: {
        label: "Undo",
        onAct: () =>
          void entryApi.update(entry.id, {
            planStatus: "open",
            abandonedReason: undefined,
          } as Partial<PlannedPlanting>),
      },
    });
  }

  /**
   * Deleting a plan is **cascade** over its entries, listed in the dialog.
   *
   * A planned planting is a line of that plan and means nothing outside it.
   * The plantings it already turned into are untouched — those are records of
   * ground, not of intentions, and they stop pointing back at a plan that no
   * longer exists without losing anything about what is growing.
   */
  async function removePlan(plan: SeasonPlan) {
    const entries = planned.filter((entry) => entry.seasonPlanId === plan.id);
    const realised = entries.filter((entry) => entry.planStatus === "realised").length;

    const confirmed = await confirmDelete({
      tier: "typed",
      recordName: plan.name,
      entity: "season plan",
      dependents: entries.map((entry) => ({
        entity: "Planned planting",
        label: `${METHOD_LABEL[entry.method]} ${nameOf(entry.varietyId)}`,
        effect: "deleted" as const,
      })),
      consequence:
        realised === 0
          ? "The plan and every line of it go. Nothing that is in the ground is touched."
          : `The plan and every line of it go. The ${realised} planting${realised === 1 ? "" : "s"} already made from it stay exactly as they are.`,
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await planApi.remove(plan.id, "Season plan removed");
    if (!result.ok) {
      show({ message: `Could not delete ${plan.name}`, tone: "danger" });
      return;
    }

    for (const entry of entries) await entryApi.remove(entry.id, `Plan ${plan.name} deleted`);

    show({
      message: `${plan.name} deleted`,
      action: {
        label: "Undo",
        onAct: () => {
          void (async () => {
            await planApi.restoreRecord(plan.id);
            for (const entry of entries) await entryApi.restoreRecord(entry.id);
          })();
        },
      },
    });
  }

  /** One line of a plan. Standard tier — nothing hangs off it. */
  async function removeEntry(entry: PlannedPlanting) {
    const confirmed = await confirmDelete({
      tier: "standard",
      recordName: `${METHOD_LABEL[entry.method]} ${nameOf(entry.varietyId)}`,
      entity: "plan entry",
      dependents: [],
      consequence:
        entry.planStatus === "realised"
          ? "The planting it became stays where it is; only the plan line goes."
          : "Nothing else points at it.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await entryApi.remove(entry.id, "Removed from the plan");
    if (!result.ok) {
      show({ message: "Could not delete that line", tone: "danger" });
      return;
    }

    show({
      message: "Removed from the plan",
      action: { label: "Undo", onAct: () => void entryApi.restoreRecord(entry.id) },
    });
  }

  if (loading) return <p className="text-muted">Loading the season plan…</p>;

  const entryColumns: readonly Column<PlannedPlanting>[] = [
    {
      key: "variety",
      header: "What",
      primary: true,
      render: (row) => nameOf(row.varietyId),
    },
    {
      key: "method",
      header: "How",
      render: (row) => <Pill tone="action">{METHOD_LABEL[row.method]}</Pill>,
    },
    {
      key: "window",
      header: "Window",
      render: (row) => `${formatDate(row.windowFrom)} – ${formatDate(row.windowTo)}`,
    },
    {
      key: "bed",
      header: "Bed",
      render: (row) => bedName(row.bedId) ?? <span className="text-muted">not decided</span>,
    },
    {
      key: "status",
      header: "",
      render: (row) =>
        row.planStatus === "realised" ? (
          <Pill tone="calm">planted</Pill>
        ) : row.planStatus === "abandoned" ? (
          <Pill tone="neutral" dot>
            not planted
          </Pill>
        ) : (
          <Pill tone="identity">open</Pill>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <span className="flex flex-wrap gap-2">
          {row.planStatus !== "open" ? null : (
            <Button
              variant="ghost"
              onClick={() => {
                setConverting(row);
                setConvertBed(row.bedId ?? openBeds[0]?.id ?? "");
              }}
            >
              Plant it
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setEditingEntry(row);
              setEntryDraft({
                seasonPlanId: row.seasonPlanId,
                varietyId: row.varietyId,
                method: row.method,
                bedId: row.bedId ?? "",
                windowFrom: dateInputValue(row.windowFrom),
                windowTo: dateInputValue(row.windowTo),
                quantity: row.quantity === undefined ? "" : String(row.quantity),
                notes: row.notes ?? "",
              });
              setErrors({});
            }}
          >
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void removeEntry(row)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-density">
      {windows.length === 0 ? null : (
        <Section
          title="Windows opening"
          description={`What the plan says is due inside ${leadDays} days. These are the only things the garden emails about — the seed catalogue stays quiet.`}
        >
          <CardGrid columns={3}>
            {windows.map((window) => {
              const entry = window.planned;
              return (
                <RecordCard
                  key={entry.id}
                  tone={window.closingSoon ? "danger" : window.open ? "action" : "identity"}
                  title={`${METHOD_LABEL[entry.method]} ${nameOf(entry.varietyId)}`}
                  subtitle={
                    window.open
                      ? `Open now, through ${formatDate(entry.windowTo)}`
                      : `Opens ${formatDate(window.opensOn)}`
                  }
                  meta={
                    <>
                      {bedName(entry.bedId) === undefined ? (
                        <Pill tone="neutral">no bed picked</Pill>
                      ) : (
                        <Pill tone="neutral">{bedName(entry.bedId)}</Pill>
                      )}
                      {window.closingSoon ? <Pill tone="danger">closing</Pill> : null}
                      {entry.quantity === undefined ? null : (
                        <Pill tone="neutral">{entry.quantity} planned</Pill>
                      )}
                    </>
                  }
                >
                  {entry.notes === undefined ? null : (
                    <p className="text-sm text-muted">{entry.notes}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      onClick={() => {
                        setConverting(entry);
                        setConvertBed(entry.bedId ?? openBeds[0]?.id ?? "");
                      }}
                    >
                      Plant it
                    </Button>
                    <Button variant="ghost" onClick={() => void abandon(entry)}>
                      Not this year
                    </Button>
                  </div>
                </RecordCard>
              );
            })}
          </CardGrid>
        </Section>
      )}

      <Section
        title="Season plans"
        description="One per season. What goes in, how, and the fortnight it wants to go in during."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditingPlan(undefined);
              setPlanDraft({
                name: `${new Date().getFullYear()} garden`,
                year: String(new Date().getFullYear()),
                notes: "",
                active: true,
              });
              setErrors({});
            }}
          >
            Add a plan
          </Button>
        }
      >
        {plans.length === 0 ? (
          <EmptyState
            title="No season plan yet"
            detail="A plan is what turns the seed box into a set of dates. It is also the only thing the garden will email you about."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setEditingPlan(undefined);
                  setPlanDraft({
                    name: `${new Date().getFullYear()} garden`,
                    year: String(new Date().getFullYear()),
                    notes: "",
                    active: true,
                  });
                  setErrors({});
                }}
              >
                Start one
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-density">
            {[...plans]
              .sort((left, right) => right.year - left.year || left.name.localeCompare(right.name))
              .map((plan) => {
                const entries = planned.filter((entry) => entry.seasonPlanId === plan.id);
                const open = entries.filter((entry) => entry.planStatus === "open").length;

                return (
                  <Section
                    key={plan.id}
                    title={`${plan.name} · ${plan.year}`}
                    description={plan.notes}
                    actions={
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={plan.active ? "calm" : "neutral"} dot={!plan.active}>
                          {plan.active ? `${open} still to plant` : "switched off"}
                        </Pill>
                        <Button
                          variant="primary"
                          disabled={varieties.length === 0}
                          onClick={() => {
                            setEditingEntry(undefined);
                            setEntryDraft({
                              seasonPlanId: plan.id,
                              varietyId: "",
                              method: "direct_sow",
                              bedId: "",
                              windowFrom: dateInputValue(new Date()),
                              windowTo: "",
                              quantity: "",
                              notes: "",
                            });
                            setErrors({});
                          }}
                        >
                          Add to this plan
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEditingPlan(plan);
                            setPlanDraft({
                              name: plan.name,
                              year: String(plan.year),
                              notes: plan.notes ?? "",
                              active: plan.active,
                            });
                            setErrors({});
                          }}
                        >
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => void removePlan(plan)}>
                          Delete
                        </Button>
                      </div>
                    }
                  >
                    <DataTable
                      rows={[...entries].sort(
                        (left, right) => left.windowFrom.getTime() - right.windowFrom.getTime(),
                      )}
                      columns={entryColumns}
                      rowKey={(row) => row.id}
                      caption={`${plan.name} — planned plantings`}
                      empty="Nothing planned under this yet."
                    />
                  </Section>
                );
              })}
          </div>
        )}
      </Section>

      {converting === undefined ? null : (
        <Modal
          title={`Plant ${nameOf(converting.varietyId)}`}
          description="The plan's variety, method and quantity come across, and the plan keeps the record of having been made."
          onClose={() => setConverting(undefined)}
        >
          <div className="flex flex-col gap-density">
            {openBeds.length === 0 ? (
              <Callout tone="danger" title="No beds to plant in">
                Add a bed first — a planting has to name the ground it is in.
              </Callout>
            ) : (
              <Select
                label="Bed"
                required
                hint={
                  converting.bedId === undefined
                    ? "The plan did not name one, which is the usual case in January."
                    : "The plan's bed, unless it has changed."
                }
                options={openBeds.map((bed) => ({ value: bed.id, label: bed.name }))}
                value={convertBed}
                onChange={(event) => setConvertBed(event.target.value)}
              />
            )}

            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={convertBed === ""}
                onClick={() => void convert(converting, convertBed as Ulid)}
              >
                Record it as planted
              </Button>
              <Button onClick={() => setConverting(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}

      {planDraft === undefined ? null : (
        <Modal
          key={editingPlan?.id ?? "new-plan"}
          title={editingPlan === undefined ? "New season plan" : `Editing ${editingPlan.name}`}
          description="A season's worth of intentions, kept alongside what actually happened."
          onClose={() => setPlanDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <TextInput
                label="Name"
                required
                hint="&ldquo;2026 garden&rdquo;, &ldquo;fall brassicas&rdquo;."
                value={planDraft.name}
                error={errors["name"]}
                onChange={(event) => setPlanDraft({ ...planDraft, name: event.target.value })}
              />
              <TextInput
                label="Year"
                type="number"
                inputMode="numeric"
                min={1900}
                max={2100}
                step={1}
                numeric
                required
                value={planDraft.year}
                error={errors["year"]}
                onChange={(event) => setPlanDraft({ ...planDraft, year: event.target.value })}
              />
            </div>
            <Checkbox
              label="Still current"
              hint="Untick last year's. It keeps every line and stops being the one you are working from."
              checked={planDraft.active}
              onChange={(event) => setPlanDraft({ ...planDraft, active: event.target.checked })}
            />
            <TextArea
              label="Notes"
              rows={3}
              value={planDraft.notes}
              error={errors["notes"]}
              onChange={(event) => setPlanDraft({ ...planDraft, notes: event.target.value })}
            />
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void savePlan()}>
                {editingPlan === undefined ? "Add plan" : "Save changes"}
              </Button>
              <Button onClick={() => setPlanDraft(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}

      {entryDraft === undefined ? null : (
        <Modal
          key={editingEntry?.id ?? "new-entry"}
          size="wide"
          title={editingEntry === undefined ? "Add to the plan" : "Editing a plan entry"}
          description="The window is a fortnight, not a date — that is what a planting window is, and it is what the notification speaks from."
          onClose={() => setEntryDraft(undefined)}
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <Select
                label="Variety"
                required
                options={[
                  { value: "", label: "Pick one" },
                  ...[...varieties]
                    .map((variety) => ({
                      value: variety.id,
                      label: varietyLabel(variety, crops),
                    }))
                    .sort((left, right) => left.label.localeCompare(right.label)),
                ]}
                value={entryDraft.varietyId}
                error={errors["varietyId"]}
                onChange={(event) =>
                  setEntryDraft({ ...entryDraft, varietyId: event.target.value })
                }
              />
              <Select
                label="Method"
                options={METHOD_OPTIONS}
                value={entryDraft.method}
                error={errors["method"]}
                onChange={(event) =>
                  setEntryDraft({ ...entryDraft, method: event.target.value as PlantingMethod })
                }
              />
              <TextInput
                label="Window opens"
                type="date"
                required
                value={entryDraft.windowFrom}
                error={errors["windowFrom"]}
                onChange={(event) =>
                  setEntryDraft({ ...entryDraft, windowFrom: event.target.value })
                }
              />
              <TextInput
                label="Window closes"
                type="date"
                required
                value={entryDraft.windowTo}
                error={errors["windowTo"]}
                onChange={(event) => setEntryDraft({ ...entryDraft, windowTo: event.target.value })}
              />
              <Select
                label="Bed"
                hint="Optional. Leave it open if you have not decided — it can be chosen when you plant."
                options={[
                  { value: "", label: "Not decided" },
                  ...openBeds.map((bed) => ({ value: bed.id, label: bed.name })),
                ]}
                value={entryDraft.bedId}
                error={errors["bedId"]}
                onChange={(event) => setEntryDraft({ ...entryDraft, bedId: event.target.value })}
              />
              <TextInput
                label="How many"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                numeric
                value={entryDraft.quantity}
                error={errors["quantity"]}
                onChange={(event) => setEntryDraft({ ...entryDraft, quantity: event.target.value })}
              />
            </div>

            <TextArea
              label="Notes"
              rows={3}
              hint="Why this one, what it is following, what it is for."
              value={entryDraft.notes}
              error={errors["notes"]}
              onChange={(event) => setEntryDraft({ ...entryDraft, notes: event.target.value })}
            />

            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void saveEntry()}>
                {editingEntry === undefined ? "Add to plan" : "Save changes"}
              </Button>
              <Button onClick={() => setEntryDraft(undefined)}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
