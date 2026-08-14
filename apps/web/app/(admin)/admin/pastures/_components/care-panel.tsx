"use client";

import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  Card,
  CardGrid,
  DataTable,
  EmptyState,
  Modal,
  Pill,
  Section,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
  type Column,
} from "@galaxy-farm/ui";
import {
  careHistoryFor,
  careSpendFor,
  costPerAcre,
  formatMoney,
  fromDollars,
  lastPerformed,
  PASTURE_CARE_ACTIONS,
  PASTURE_RATE_UNITS,
  pastureCareLogSchema,
  seasonalCareDue,
  type CrudError,
  type PastureCareAction,
  type PastureCareLog,
  type PastureRateUnit,
  type SeasonalCareItem,
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";

/**
 * Pasture care — what has been put on the ground, when, and what it cost
 * (spec §5.1, §7).
 *
 * Three questions, in the order somebody asks them: what does the season
 * still want, what did we just do, and what has this pasture cost. The first
 * is derived rather than typed — "overseed rye every fall" is answerable only
 * against the date it was last overseeded, and a reminder that has to be
 * ticked off by hand is a reminder that stays ticked the year somebody forgets.
 */

function formatDate(value: Date | undefined): string {
  return value === undefined
    ? "—"
    : value.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatMonth(value: Date): string {
  return value.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const ACTION_LABEL: Readonly<Record<PastureCareAction, string>> = {
  seed: "Seed",
  overseed: "Overseed",
  fertilize: "Fertilise",
  spray: "Spray",
  mow: "Mow",
  drag: "Drag",
  soil_test: "Soil test",
};

const ACTION_OPTIONS = PASTURE_CARE_ACTIONS.map((action) => ({
  value: action,
  label: ACTION_LABEL[action],
}));

interface Draft {
  readonly zoneId: string;
  readonly action: PastureCareAction;
  readonly performedOn: string;
  readonly product: string;
  readonly rateAmount: string;
  readonly rateUnit: PastureRateUnit;
  readonly acres: string;
  readonly cost: string;
  readonly notes: string;
}

function blank(zoneId: string): Draft {
  return {
    zoneId,
    action: "overseed",
    performedOn: new Date().toISOString().slice(0, 10),
    product: "",
    rateAmount: "",
    rateUnit: "lb",
    acres: "",
    cost: "",
    notes: "",
  };
}

export function CarePanel({
  zones,
  logs,
  loading,
  propertyId,
  actorId,
}: {
  readonly zones: readonly Zone[];
  readonly logs: readonly PastureCareLog[];
  readonly loading: boolean;
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const mutations = useMutations<PastureCareLog>(
    "pastureCareLogs",
    "pastureCareLogs",
    pastureCareLogSchema,
    propertyId,
    actorId,
  );
  const confirmDelete = useConfirmDelete();
  const { show } = useToast();

  const workable = zones.filter((zone) => zone.active);
  const pastures = workable.filter((zone) => zone.type === "pasture");

  const [draft, setDraft] = useState<Draft>(() => blank(workable[0]?.id ?? ""));
  const [editing, setEditing] = useState<PastureCareLog | undefined>();
  const [editDraft, setEditDraft] = useState<Draft | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const zoneName = (id: Ulid) => zones.find((zone) => zone.id === id)?.name ?? "Unknown zone";

  /**
   * Which zone the form is actually on.
   *
   * The zones arrive from a live query, so the first render has none of them
   * and the draft starts empty. Left as state alone, the select would show the
   * first zone while the draft still held "" — and pressing Log it would
   * answer "choose a zone" about the zone visibly chosen.
   */
  const chosenZone = workable.some((zone) => zone.id === draft.zoneId)
    ? draft.zoneId
    : (workable[0]?.id ?? "");

  /**
   * What the season is asking for.
   *
   * Recomputed against today rather than stored, so a window that opened
   * overnight is open the next time somebody looks — nothing has to run for
   * the reminder to be right.
   */
  const seasonal = useMemo(
    () =>
      seasonalCareDue(
        zones.map((zone) => ({
          id: zone.id,
          name: zone.name,
          type: zone.type,
          active: zone.active,
        })),
        logs,
        new Date(),
      ),
    [zones, logs],
  );

  const due = seasonal.filter((item) => item.status === "due");
  const soon = seasonal.filter((item) => item.status !== "due");

  const shown = filter === "all" ? logs : logs.filter((log) => log.zoneId === filter);
  const history = [...shown].sort(
    (left, right) => right.performedOn.getTime() - left.performedOn.getTime(),
  );

  /**
   * The draft, as the schema wants it.
   *
   * An empty box means "not recorded", and it travels as an explicit
   * `undefined` rather than being left out — on an edit, a field the patch
   * never mentions keeps its old value, so a rate somebody cleared would come
   * straight back.
   */
  function fields(source: Draft) {
    const text = (value: string) => (value.trim() === "" ? undefined : value.trim());

    return {
      zoneId: source.zoneId as Ulid,
      action: source.action,
      performedOn: new Date(`${source.performedOn}T12:00:00`),
      product: text(source.product),
      ratePerAcre:
        source.rateAmount.trim() === ""
          ? undefined
          : { amount: Number(source.rateAmount), unit: source.rateUnit },
      acres: source.acres.trim() === "" ? undefined : Number(source.acres),
      cost: source.cost.trim() === "" ? undefined : fromDollars(Number(source.cost)),
      notes: text(source.notes),
    };
  }

  function reportErrors(error: CrudError) {
    // §4.5 clause 2: on the field, not in a banner.
    setErrors(
      error.kind === "validation"
        ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        : { zoneId: "Could not save. Check the fields and try again." },
    );
  }

  async function record(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});

    if (chosenZone === "") {
      setErrors({ zoneId: "Choose the zone this was done to" });
      return;
    }

    setBusy(true);
    try {
      const result = await mutations.create(fields({ ...draft, zoneId: chosenZone }) as never);
      if (!result.ok) {
        reportErrors(result.error);
        return;
      }

      show({
        message: `${ACTION_LABEL[draft.action]} logged for ${zoneName(chosenZone as Ulid)}`,
        tone: "success",
      });
      // The zone and the date stay: fall overseeding is a run of entries one
      // after another, and re-choosing the pasture each time is where a row
      // ends up against the wrong one.
      setDraft({ ...blank(chosenZone), performedOn: draft.performedOn, action: draft.action });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(log: PastureCareLog) {
    setEditing(log);
    setEditDraft({
      zoneId: log.zoneId,
      action: log.action,
      performedOn: log.performedOn.toISOString().slice(0, 10),
      product: log.product ?? "",
      rateAmount: log.ratePerAcre === undefined ? "" : String(log.ratePerAcre.amount),
      rateUnit: (log.ratePerAcre?.unit ?? "lb") as PastureRateUnit,
      acres: log.acres === undefined ? "" : String(log.acres),
      cost: log.cost === undefined ? "" : String(log.cost.cents / 100),
      notes: log.notes ?? "",
    });
    setErrors({});
  }

  async function saveEdit() {
    if (editing === undefined || editDraft === undefined) return;

    const result = await mutations.update(editing.id, fields(editDraft));

    if (!result.ok) {
      reportErrors(result.error);
      return;
    }

    show({ message: "Entry saved", tone: "success" });
    closeEdit();
  }

  /** The modal's complaints go with it, or they reappear under the form below. */
  function closeEdit() {
    setEditing(undefined);
    setEditDraft(undefined);
    setErrors({});
  }

  async function removeLog(log: PastureCareLog) {
    const confirmed = await confirmDelete({
      // Standard tier: one entry in a history, with nothing hanging off it.
      tier: "standard",
      recordName: `${ACTION_LABEL[log.action]} — ${zoneName(log.zoneId)}, ${formatDate(log.performedOn)}`,
      entity: "care log entry",
      dependents: [],
      consequence:
        "Its cost comes out of that pasture's history, and the seasonal reminder goes back to asking for the work.",
      action: "Delete",
    });
    if (!confirmed) return;

    const result = await mutations.remove(log.id);
    if (!result.ok) {
      show({ message: "Could not delete that entry", tone: "danger" });
      return;
    }

    show({
      message: "Entry deleted",
      action: { label: "Undo", onAct: () => void mutations.restoreRecord(log.id) },
    });
  }

  const columns: readonly Column<PastureCareLog>[] = [
    { key: "date", header: "Date", render: (log) => formatDate(log.performedOn) },
    { key: "zone", header: "Zone", render: (log) => zoneName(log.zoneId) },
    {
      key: "action",
      header: "Action",
      render: (log) => <Badge tone="neutral">{ACTION_LABEL[log.action]}</Badge>,
    },
    { key: "product", header: "Product", render: (log) => log.product ?? "—" },
    {
      key: "rate",
      header: "Rate / acre",
      render: (log) =>
        log.ratePerAcre === undefined
          ? "—"
          : `${log.ratePerAcre.amount} ${log.ratePerAcre.unit.replace(/_/g, " ")}`,
    },
    { key: "acres", header: "Acres", render: (log) => log.acres ?? "—" },
    {
      key: "cost",
      header: "Cost",
      render: (log) => {
        const each = costPerAcre(log);
        return (
          <span className="flex flex-col">
            <span>{log.cost === undefined ? "—" : formatMoney(log.cost)}</span>
            {each === undefined ? null : (
              <span className="text-sm text-muted">{formatMoney(each)}/acre</span>
            )}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (log) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => startEdit(log)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void removeLog(log)}>
            Delete
          </Button>
        </span>
      ),
    },
  ];

  if (loading) return <p className="text-muted">Loading care logs…</p>;

  return (
    <div className="flex flex-col gap-density">
      <Section
        title="This season"
        description="Derived from what was last done, not from a list somebody keeps ticking."
      >
        {seasonal.length === 0 ? (
          <EmptyState
            title="No pastures to work"
            detail="Seasonal work is asked of grazable ground. Add a zone of type pasture and its windows appear here."
          />
        ) : (
          <div className="flex flex-col gap-density">
            {due.length === 0 ? (
              <p className="text-density text-ink">
                Nothing is due today. {soon.length} window{soon.length === 1 ? "" : "s"} ahead.
              </p>
            ) : (
              <CardGrid columns={3}>
                {due.map((item) => (
                  <SeasonCard key={`${item.zoneId}-${item.job.action}`} item={item} />
                ))}
              </CardGrid>
            )}

            <ul className="flex flex-col gap-1">
              {soon.map((item) => (
                <li
                  key={`${item.zoneId}-${item.job.action}`}
                  className="flex flex-wrap items-center gap-2 text-sm text-muted"
                >
                  <Pill tone={item.status === "done" ? "calm" : "neutral"}>
                    {item.status === "done" ? "done" : "from " + formatMonth(item.opensOn)}
                  </Pill>
                  <span className="text-ink">{item.zoneName}</span>
                  <span>{item.job.label}</span>
                  {item.lastPerformed === undefined ? (
                    <span>never recorded</span>
                  ) : (
                    <span>last {formatDate(item.lastPerformed)}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section
        title="Record what was done"
        description="Rate and acres are separate on purpose — the rate is what next year gets compared against, and half a pasture is a common thing to treat."
      >
        {workable.length === 0 ? (
          <EmptyState title="No zones yet" detail="Add a zone before logging work against it." />
        ) : (
          <form onSubmit={(event) => void record(event)} className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Zone"
                value={chosenZone}
                error={errors["zoneId"]}
                options={workable.map((zone) => ({ value: zone.id, label: zone.name }))}
                onChange={(event) => setDraft({ ...draft, zoneId: event.target.value })}
              />
              <Select
                label="Action"
                value={draft.action}
                options={ACTION_OPTIONS}
                onChange={(event) =>
                  setDraft({ ...draft, action: event.target.value as PastureCareAction })
                }
              />
              <TextInput
                label="Date"
                type="date"
                required
                value={draft.performedOn}
                error={errors["performedOn"]}
                onChange={(event) => setDraft({ ...draft, performedOn: event.target.value })}
              />
              <TextInput
                label="Product"
                hint="Winter rye, 13-13-13, 2,4-D."
                value={draft.product}
                error={errors["product"]}
                onChange={(event) => setDraft({ ...draft, product: event.target.value })}
              />
              <TextInput
                label="Rate per acre"
                type="number"
                inputMode="decimal"
                step="any"
                value={draft.rateAmount}
                error={errors["ratePerAcre"]}
                onChange={(event) => setDraft({ ...draft, rateAmount: event.target.value })}
              />
              <Select
                label="Rate unit"
                value={draft.rateUnit}
                options={PASTURE_RATE_UNITS.map((unit) => ({ value: unit, label: unit }))}
                onChange={(event) =>
                  setDraft({ ...draft, rateUnit: event.target.value as PastureRateUnit })
                }
              />
              <TextInput
                label="Acres treated"
                type="number"
                inputMode="decimal"
                step="any"
                hint="Leave blank if it was the whole place and you have not measured it."
                value={draft.acres}
                error={errors["acres"]}
                onChange={(event) => setDraft({ ...draft, acres: event.target.value })}
              />
              <TextInput
                label="Cost ($)"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={draft.cost}
                error={errors["cost"]}
                onChange={(event) => setDraft({ ...draft, cost: event.target.value })}
              />
            </div>
            <TextArea
              label="Notes"
              rows={2}
              value={draft.notes}
              error={errors["notes"]}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
            <div>
              <Button type="submit" variant="primary" busy={busy}>
                Log it
              </Button>
            </div>
          </form>
        )}
      </Section>

      <Section
        title="Per pasture"
        description="What each one has cost, and when it was last worked."
      >
        {pastures.length === 0 ? (
          <EmptyState title="No pastures" detail="Zones of type pasture show their history here." />
        ) : (
          <CardGrid columns={3}>
            {pastures.map((zone) => {
              const spend = careSpendFor(logs, zone.id);
              const worked = careHistoryFor(logs, zone.id)[0];

              return (
                <Card key={zone.id} title={zone.name}>
                  <p className="gf-numeric text-[1.35em] font-semibold text-ink">
                    {formatMoney(spend.total)}
                  </p>
                  <p className="text-sm text-muted">
                    {spend.entries} entr{spend.entries === 1 ? "y" : "ies"}
                    {spend.withoutCost === 0
                      ? ""
                      : ` · ${spend.withoutCost} with no cost recorded, so this is a floor`}
                  </p>
                  <ul className="mt-density flex flex-col gap-1 text-sm text-muted">
                    <li>
                      Last worked: {worked === undefined ? "never" : formatDate(worked.performedOn)}
                    </li>
                    <li>Last overseeded: {formatDate(lastPerformed(logs, zone.id, "overseed"))}</li>
                    <li>
                      Last fertilised: {formatDate(lastPerformed(logs, zone.id, "fertilize"))}
                    </li>
                  </ul>
                </Card>
              );
            })}
          </CardGrid>
        )}
      </Section>

      <Section
        title="Everything logged"
        actions={
          <Select
            label="Zone"
            hideLabel
            value={filter}
            options={[
              { value: "all", label: "Every zone" },
              ...zones.map((zone) => ({ value: zone.id, label: zone.name })),
            ]}
            onChange={(event) => setFilter(event.target.value)}
          />
        }
      >
        <Card>
          <DataTable
            caption="Pasture care history"
            columns={columns}
            rows={history}
            rowKey={(log) => log.id}
            empty={
              <EmptyState
                title="Nothing logged yet"
                detail="Seeding, fertiliser, spray, mowing and soil tests all land here, with what they cost."
              />
            }
          />
        </Card>
      </Section>

      {editDraft === undefined || editing === undefined ? null : (
        <Modal
          key={editing.id}
          size="wide"
          title={`Editing ${ACTION_LABEL[editing.action]} — ${zoneName(editing.zoneId)}`}
          description="Correct what went on the ground, what it covered, and what it cost."
          onClose={closeEdit}
        >
          <div className="flex flex-col gap-density">
            <div className="grid grid-cols-1 gap-density sm:grid-cols-2">
              <Select
                label="Zone"
                value={editDraft.zoneId}
                error={errors["zoneId"]}
                options={zones.map((zone) => ({ value: zone.id, label: zone.name }))}
                onChange={(event) => setEditDraft({ ...editDraft, zoneId: event.target.value })}
              />
              <Select
                label="Action"
                value={editDraft.action}
                options={ACTION_OPTIONS}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, action: event.target.value as PastureCareAction })
                }
              />
              <TextInput
                label="Date"
                type="date"
                value={editDraft.performedOn}
                error={errors["performedOn"]}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, performedOn: event.target.value })
                }
              />
              <TextInput
                label="Product"
                value={editDraft.product}
                error={errors["product"]}
                onChange={(event) => setEditDraft({ ...editDraft, product: event.target.value })}
              />
              <TextInput
                label="Rate per acre"
                type="number"
                inputMode="decimal"
                step="any"
                value={editDraft.rateAmount}
                error={errors["ratePerAcre"]}
                onChange={(event) => setEditDraft({ ...editDraft, rateAmount: event.target.value })}
              />
              <Select
                label="Rate unit"
                value={editDraft.rateUnit}
                options={PASTURE_RATE_UNITS.map((unit) => ({ value: unit, label: unit }))}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, rateUnit: event.target.value as PastureRateUnit })
                }
              />
              <TextInput
                label="Acres treated"
                type="number"
                inputMode="decimal"
                step="any"
                value={editDraft.acres}
                error={errors["acres"]}
                onChange={(event) => setEditDraft({ ...editDraft, acres: event.target.value })}
              />
              <TextInput
                label="Cost ($)"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={editDraft.cost}
                error={errors["cost"]}
                onChange={(event) => setEditDraft({ ...editDraft, cost: event.target.value })}
              />
            </div>
            <TextArea
              label="Notes"
              rows={3}
              value={editDraft.notes}
              error={errors["notes"]}
              onChange={(event) => setEditDraft({ ...editDraft, notes: event.target.value })}
            />
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void saveEdit()}>
                Save changes
              </Button>
              <Button onClick={closeEdit}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** One pasture, one job, due now. */
function SeasonCard({ item }: { readonly item: SeasonalCareItem }) {
  const closes = formatDate(item.closesOn);

  return (
    <Card title={item.zoneName}>
      <p className="flex flex-wrap items-center gap-2">
        <Pill tone="danger" dot>
          due
        </Pill>
        <span className="text-density text-ink">{item.job.label}</span>
      </p>
      <p className="mt-density text-sm text-muted">
        Window closes {closes}.{" "}
        {item.lastPerformed === undefined
          ? "Never recorded here."
          : `Last done ${formatDate(item.lastPerformed)}.`}
      </p>
    </Card>
  );
}
