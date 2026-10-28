"use client";

import { useId, useMemo, useState } from "react";

import {
  Button,
  EmptyState,
  Modal,
  Section,
  Select,
  TextArea,
  TextInput,
  useConfirmDelete,
  useToast,
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
  type Ulid,
  type Zone,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";

import { AddAction, FilteredLine, LandRow, RowList, StatusLine } from "./land-kit";

/**
 * Pasture care — what has been put on the ground, when, and what it cost
 * (spec §5.1, §7).
 *
 * Three questions, in the order somebody asks them: what does the season
 * still want, what did we just do, and what has this pasture cost. The first
 * is derived rather than typed — "overseed rye every fall" is answerable only
 * against the date it was last overseeded, and a reminder that has to be
 * ticked off by hand is a reminder that stays ticked the year somebody forgets.
 *
 * Logging is a side panel opened from the history, not a form standing open
 * above it: the panel stays up between entries so a run of them goes in one
 * after another, and the list it adds to never moves while it does.
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
  /** Whether the log panel is open. The draft outlives it, on purpose — see `record`. */
  const [logging, setLogging] = useState(false);
  const formId = useId();

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

  /**
   * Open the log panel — on a pasture and a job, when it was opened from a
   * window that is due, so the entry that closes it is one tap from the row.
   */
  function startLog(zoneId?: Ulid, action?: PastureCareAction) {
    setErrors({});
    if (zoneId !== undefined) {
      setDraft({ ...draft, zoneId, ...(action === undefined ? {} : { action }) });
    }
    setLogging(true);
  }

  function closeLog() {
    setLogging(false);
    setErrors({});
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

  /** The one line under an entry: when, what went on, how much, what it cost. */
  function lineFor(log: PastureCareLog): string {
    const each = costPerAcre(log);
    return [
      formatDate(log.performedOn),
      log.product,
      log.ratePerAcre === undefined
        ? undefined
        : `${log.ratePerAcre.amount} ${log.ratePerAcre.unit.replace(/_/g, " ")}/acre`,
      log.acres === undefined ? undefined : `${log.acres} ac`,
      log.cost === undefined
        ? undefined
        : `${formatMoney(log.cost)}${each === undefined ? "" : ` (${formatMoney(each)}/acre)`}`,
    ]
      .filter((part) => part !== undefined && part !== "")
      .join(" · ");
  }

  if (loading) return <p className="text-muted">Loading care logs…</p>;

  const filterLabel =
    filter === "all" ? [] : [zones.find((zone) => zone.id === filter)?.name ?? "A zone"];

  return (
    <div className="flex flex-col gap-density pb-20 sm:pb-0">
      {/*
        What the season is asking for, by exception. The windows that are open
        are rows, because each is a job; the ones ahead or already done are a
        single count that opens into the list, because nobody acts on them
        today. Derived from what was last done, not from a list somebody keeps
        ticking.
      */}
      <Section title="This season">
        {seasonal.length === 0 ? (
          <p className="text-sm text-muted">
            No pastures to work yet — seasonal windows appear for zones of type pasture.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {due.length === 0 ? (
              <StatusLine tone="calm">Nothing is due today.</StatusLine>
            ) : (
              <RowList label="Seasonal work due now">
                {due.map((item) => (
                  <LandRow
                    key={`${item.zoneId}-${item.job.action}`}
                    title={`${item.job.label} · ${item.zoneName}`}
                    line={`Window closes ${formatDate(item.closesOn)} · ${
                      item.lastPerformed === undefined
                        ? "never recorded here"
                        : `last done ${formatDate(item.lastPerformed)}`
                    }`}
                    chip={{ tone: "danger", label: "Due" }}
                    onOpen={() => startLog(item.zoneId, item.job.action)}
                    openLabel={`Log ${item.job.label} for ${item.zoneName}`}
                  />
                ))}
              </RowList>
            )}

            {soon.length === 0 ? null : (
              <details className="group">
                <summary className="inline-flex min-h-target cursor-pointer list-none items-center gap-1 text-sm font-semibold text-action [&::-webkit-details-marker]:hidden">
                  {soon.length} window{soon.length === 1 ? "" : "s"} ahead or done
                  <span aria-hidden="true" className="transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <ul className="flex flex-col gap-1 pt-1">
                  {soon.map((item) => (
                    <li key={`${item.zoneId}-${item.job.action}`} className="text-sm text-muted">
                      <span className="font-medium text-ink">{item.zoneName}</span> ·{" "}
                      {item.job.label} ·{" "}
                      {item.status === "done" ? "done" : `from ${formatMonth(item.opensOn)}`} ·{" "}
                      {item.lastPerformed === undefined
                        ? "never recorded"
                        : `last ${formatDate(item.lastPerformed)}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Everything logged"
        actions={
          workable.length === 0 ? undefined : (
            <div className="flex items-center gap-2">
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
              <AddAction label="Log work" onClick={() => startLog()} />
            </div>
          )
        }
      >
        <FilteredLine
          shown={history.length}
          total={logs.length}
          labels={filterLabel}
          onClear={() => setFilter("all")}
        />
        {workable.length === 0 ? (
          <EmptyState title="No zones yet" detail="Add a zone before logging work against it." />
        ) : history.length === 0 ? (
          <EmptyState
            title="Nothing logged yet"
            detail="Seeding, fertiliser, spray, mowing and soil tests all land here, with what they cost."
            action={
              <Button variant="primary" onClick={() => startLog()}>
                Log the first job
              </Button>
            }
          />
        ) : (
          <RowList label="Pasture care history">
            {history.map((log) => (
              <LandRow
                key={log.id}
                title={`${ACTION_LABEL[log.action]} · ${zoneName(log.zoneId)}`}
                openLabel={`Edit ${ACTION_LABEL[log.action]} — ${zoneName(log.zoneId)}, ${formatDate(log.performedOn)}`}
                line={lineFor(log)}
                onOpen={() => startEdit(log)}
              />
            ))}
          </RowList>
        )}
      </Section>

      <Section title="Per pasture">
        {pastures.length === 0 ? (
          <p className="text-sm text-muted">Zones of type pasture show their history here.</p>
        ) : (
          // A pasture's row narrows the history above to it — the next thing
          // somebody looking at what one has cost wants to see is why.
          <RowList label="Spend per pasture">
            {pastures.map((zone) => {
              const spend = careSpendFor(logs, zone.id);
              const worked = careHistoryFor(logs, zone.id)[0];
              return (
                <LandRow
                  key={zone.id}
                  title={
                    <>
                      {zone.name}{" "}
                      <span className="gf-numeric font-normal text-muted">
                        {/* A trailing + where entries carry no cost, because
                            then the total is a floor, not a figure. */}
                        {formatMoney(spend.total)}
                        {spend.withoutCost === 0 ? "" : "+"}
                      </span>
                    </>
                  }
                  openLabel={`Show ${zone.name} in the history`}
                  line={[
                    `${spend.entries} entr${spend.entries === 1 ? "y" : "ies"}`,
                    spend.withoutCost === 0 ? undefined : `${spend.withoutCost} with no cost`,
                    `worked ${worked === undefined ? "never" : formatDate(worked.performedOn)}`,
                    `overseeded ${formatDate(lastPerformed(logs, zone.id, "overseed"))}`,
                    `fertilised ${formatDate(lastPerformed(logs, zone.id, "fertilize"))}`,
                  ]
                    .filter((part) => part !== undefined)
                    .join(" · ")}
                  onOpen={() => setFilter(zone.id)}
                />
              );
            })}
          </RowList>
        )}
      </Section>

      {!logging ? null : (
        <Modal
          placement="side"
          title="Log pasture work"
          description="Rate and acres are separate: half a pasture is a common thing to treat."
          onClose={closeLog}
          footer={
            <>
              <Button type="submit" form={formId} variant="primary" busy={busy}>
                Log it
              </Button>
              {/* Done, not Cancel: the panel stays open after each entry so
                  fall overseeding can go in as a run, and closing it
                  discards nothing that was logged. */}
              <Button onClick={closeLog}>Done</Button>
            </>
          }
        >
          <form
            id={formId}
            onSubmit={(event) => void record(event)}
            className="flex flex-col gap-density"
          >
            <CareFields
              draft={{ ...draft, zoneId: chosenZone }}
              errors={errors}
              zoneOptions={workable.map((zone) => ({ value: zone.id, label: zone.name }))}
              onChange={setDraft}
            />
          </form>
        </Modal>
      )}

      {editDraft === undefined || editing === undefined ? null : (
        <Modal
          key={editing.id}
          placement="side"
          title={`Editing ${ACTION_LABEL[editing.action]} — ${zoneName(editing.zoneId)}`}
          onClose={closeEdit}
          footer={
            <>
              <Button variant="primary" onClick={() => void saveEdit()}>
                Save changes
              </Button>
              <Button onClick={closeEdit}>Cancel</Button>
              <Button
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  const log = editing;
                  closeEdit();
                  void removeLog(log);
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-density">
            <CareFields
              draft={editDraft}
              errors={errors}
              zoneOptions={zones.map((zone) => ({ value: zone.id, label: zone.name }))}
              onChange={setEditDraft}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * The fields of one entry, shared by logging and editing so the two forms
 * cannot drift — a unit offered on one and not the other is an entry that can
 * be made and never corrected.
 */
function CareFields({
  draft,
  errors,
  zoneOptions,
  onChange,
}: {
  readonly draft: Draft;
  readonly errors: Record<string, string>;
  readonly zoneOptions: readonly { value: string; label: string }[];
  readonly onChange: (next: Draft) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-density sm:grid sm:grid-cols-2">
        <Select
          label="Zone"
          value={draft.zoneId}
          error={errors["zoneId"]}
          options={zoneOptions}
          onChange={(event) => onChange({ ...draft, zoneId: event.target.value })}
        />
        <Select
          label="Action"
          value={draft.action}
          options={ACTION_OPTIONS}
          onChange={(event) =>
            onChange({ ...draft, action: event.target.value as PastureCareAction })
          }
        />
        <TextInput
          label="Date"
          type="date"
          required
          value={draft.performedOn}
          error={errors["performedOn"]}
          onChange={(event) => onChange({ ...draft, performedOn: event.target.value })}
        />
        <TextInput
          label="Product"
          placeholder="Winter rye, 13-13-13"
          value={draft.product}
          error={errors["product"]}
          onChange={(event) => onChange({ ...draft, product: event.target.value })}
        />
        <TextInput
          label="Rate per acre"
          type="number"
          inputMode="decimal"
          step="any"
          value={draft.rateAmount}
          error={errors["ratePerAcre"]}
          onChange={(event) => onChange({ ...draft, rateAmount: event.target.value })}
        />
        <Select
          label="Rate unit"
          value={draft.rateUnit}
          options={PASTURE_RATE_UNITS.map((unit) => ({ value: unit, label: unit }))}
          onChange={(event) =>
            onChange({ ...draft, rateUnit: event.target.value as PastureRateUnit })
          }
        />
        <TextInput
          label="Acres treated"
          type="number"
          inputMode="decimal"
          step="any"
          hint="Blank if it was the whole place, unmeasured."
          value={draft.acres}
          error={errors["acres"]}
          onChange={(event) => onChange({ ...draft, acres: event.target.value })}
        />
        <TextInput
          label="Cost ($)"
          type="number"
          inputMode="decimal"
          step="0.01"
          value={draft.cost}
          error={errors["cost"]}
          onChange={(event) => onChange({ ...draft, cost: event.target.value })}
        />
      </div>
      <TextArea
        label="Notes"
        rows={2}
        value={draft.notes}
        error={errors["notes"]}
        onChange={(event) => onChange({ ...draft, notes: event.target.value })}
      />
    </>
  );
}
